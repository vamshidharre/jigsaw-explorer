/**
 * The puzzle engine: owns the model, renderer, camera and input for one puzzle
 * and exposes a small imperative API to the React UI. It runs outside React's
 * render cycle so dragging never triggers component re-renders.
 *
 * In single-player mode drops are resolved locally. In multiplayer mode the
 * engine sends intents through a NetworkLink and applies the authoritative
 * results the server broadcasts.
 */
import { toWire, type ClientMessage, type PlayerInfo, type ServerMessage, type WireGroup } from '../../shared/protocol';
import { fromWire } from '../../shared/protocol';
import { PuzzleModel, type GroupState, type Rot, type SnapStrength } from '../../shared/puzzle/model';
import { generateShapes } from '../../shared/puzzle/shapes';
import type { PuzzleSpec } from '../../shared/puzzle/spec';
import { Camera, type Rect } from './Camera';
import { InputController, type InputTarget } from './InputController';
import { PieceAtlas, type OutlineStyle } from './PieceAtlas';
import { Renderer, type BoardTheme } from './Renderer';

export interface EngineSettings {
  snapStrength: SnapStrength;
  guide: boolean;
  guideOpacity: number;
  shadows: boolean;
  outline: OutlineStyle;
  bevel: boolean;
  reducedMotion: boolean;
  autoPan: boolean;
  edgesOnly: boolean;
  theme: BoardTheme;
  selectionColor: string;
}

export interface SnapInfo {
  kind: 'board' | 'piece';
  joined: number;
  mine: boolean;
  connected: number;
  total: number;
}

export interface EngineEvents {
  progress(connected: number, total: number): void;
  snap(info: SnapInfo): void;
  pickup(): void;
  complete(local: boolean): void;
  firstInteraction(): void;
  changed(): void;
  zoom(percent: number): void;
  announce(message: string): void;
  notice(message: string): void;
}

export interface NetworkLink {
  selfId: string;
  send(msg: ClientMessage): void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  spec: PuzzleSpec;
  groups: GroupState[] | null;
  image: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  settings: EngineSettings;
  events: Partial<EngineEvents>;
  network?: NetworkLink;
  completed?: boolean;
  insets?: { top: number; bottom: number };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

interface DragState {
  groupId: number;
  offX: number;
  offY: number;
  origin: { x: number; y: number; rot: Rot };
  keyboard: boolean;
}

interface CursorView {
  el: HTMLDivElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  visible: boolean;
  lastSeen: number;
}

const MOVE_INTERVAL_MS = 33;
const CURSOR_INTERVAL_MS = 50;
const EDGE_ZONE = 40;

function pixelBudget(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (mem <= 2) return 6e6;
  if (mem <= 4 || coarse) return 12e6;
  return 24e6;
}

export class GameEngine implements InputTarget {
  readonly model: PuzzleModel;
  readonly camera = new Camera();
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private atlas: PieceAtlas;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLElement;
  private readonly hitCtx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private settings: EngineSettings;
  private readonly events: Partial<EngineEvents>;
  private readonly net: NetworkLink | null;
  private insets: { top: number; bottom: number };

  private frameRequested = 0;
  private drag: DragState | null = null;
  private selected: number | null = null;
  private selectedPiece: number | null = null;
  private interacted = false;
  private completed: boolean;
  private interactive = true;
  private destroyed = false;
  private restyleToken = 0;
  private lastLayoutAspect = 1.6;
  private tableFitZoom = 1;

  // Multiplayer state.
  private readonly heldByOthers = new Map<number, string>();
  private readonly remoteTargets = new Map<number, { x: number; y: number; rot: Rot }>();
  private readonly players = new Map<string, { name: string; color: string; online: boolean }>();
  private readonly cursors = new Map<string, CursorView>();
  private lastMoveSent = 0;
  private moveTimer = 0;
  private lastCursorSent = 0;
  private opCounter = 1;
  private lastFrameTime = performance.now();

  private constructor(opts: EngineOptions, atlas: PieceAtlas, model: PuzzleModel) {
    this.canvas = opts.canvas;
    this.overlay = opts.overlay;
    this.settings = opts.settings;
    this.events = opts.events;
    this.net = opts.network ?? null;
    this.atlas = atlas;
    this.model = model;
    this.completed = opts.completed ?? model.isComplete();
    this.insets = opts.insets ?? { top: 0, bottom: 0 };
    const hit = document.createElement('canvas').getContext('2d');
    if (!hit) throw new Error('Canvas 2D is not supported in this browser.');
    this.hitCtx = hit;
    this.renderer = new Renderer(this.canvas, model, atlas, opts.image, this.camera, opts.settings.theme, {
      guide: opts.settings.guide,
      guideOpacity: opts.settings.guideOpacity,
      shadows: opts.settings.shadows,
      edgesOnly: opts.settings.edgesOnly,
    });
    this.renderer.selectionColor = opts.settings.selectionColor;
    this.input = new InputController(this.canvas, this);
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.handleResize(true);
  }

  static async create(opts: EngineOptions): Promise<GameEngine> {
    const shapes = generateShapes(opts.spec);
    const atlas = await PieceAtlas.build({
      image: opts.image,
      imageWidth: opts.imageWidth,
      imageHeight: opts.imageHeight,
      spec: opts.spec,
      shapes,
      style: { outline: opts.settings.outline, bevel: opts.settings.bevel },
      pixelBudget: pixelBudget(),
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
    const parent = opts.canvas.parentElement;
    const aspect = parent && parent.clientHeight > 0 ? parent.clientWidth / parent.clientHeight : 1.6;
    const model = opts.groups ? new PuzzleModel(opts.spec, opts.groups) : PuzzleModel.createInitial(opts.spec, aspect);
    const engine = new GameEngine(opts, atlas, model);
    engine.lastLayoutAspect = aspect;
    engine.events.progress?.(model.connectedCount(), model.pieceCount);
    return engine;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameRequested);
    clearTimeout(this.moveTimer);
    this.input.destroy();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    for (const c of this.cursors.values()) c.el.remove();
    this.cursors.clear();
    this.atlas.dispose();
    this.atlas.disposeShadows();
    this.renderer.resetBoardLayer();
  }

  // ---------------------------------------------------------------------------
  // Rendering loop

  requestRender(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.frameRequested = 0;
    const dt = Math.min(100, now - this.lastFrameTime);
    this.lastFrameTime = now;
    let more = this.camera.step(now);
    if (this.camera.animating || more) this.emitZoom();
    more = this.stepRemote(dt) || more;
    more = this.renderer.draw(now) || more;
    this.positionCursors(dt);
    if (more || this.cursorsAnimating()) this.requestRender();
  };

  private handleResize(initial = false): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.setViewport(w, h);
    this.renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2.5));
    this.updateZoomLimits();
    if (initial) this.fitView(false);
    this.requestRender();
  }

  private updateZoomLimits(): void {
    const table = this.model.tableBounds();
    const pad = Math.min(40, this.camera.viewWidth * 0.04);
    // Same maths as fitView(), so "fit everything" always reads as 100%.
    const availH = Math.max(1, this.camera.viewHeight - this.insets.top - this.insets.bottom);
    const w = Math.max(1, table.maxX - table.minX);
    const h = Math.max(1, table.maxY - table.minY);
    this.tableFitZoom = Math.min((this.camera.viewWidth - pad * 2) / w, (availH - pad * 2) / h);
    const piece = Math.max(this.model.pieceWidth, this.model.pieceHeight);
    this.camera.minZoom = this.tableFitZoom * 0.4;
    this.camera.maxZoom = Math.max(this.tableFitZoom * 3, (Math.min(this.camera.viewWidth, this.camera.viewHeight) * 0.7) / piece);
  }

  private emitZoom(): void {
    this.events.zoom?.(Math.round((this.camera.zoom / this.tableFitZoom) * 100));
  }

  // ---------------------------------------------------------------------------
  // View controls

  fitView(animate = true): void {
    this.updateZoomLimits();
    const table = this.model.tableBounds();
    const pad = Math.min(40, this.camera.viewWidth * 0.04);
    this.camera.fit(table, pad, animate && !this.settings.reducedMotion ? 380 : 0, this.insets);
    this.emitZoom();
    this.requestRender();
  }

  fitBoard(animate = true): void {
    const s = this.model.spec;
    this.camera.fit({ minX: 0, minY: 0, maxX: s.width, maxY: s.height }, 32, animate && !this.settings.reducedMotion ? 380 : 0, this.insets);
    this.emitZoom();
    this.requestRender();
  }

  zoomBy(factor: number): void {
    this.camera.zoomCentered(factor, this.settings.reducedMotion ? 0 : 180);
    this.emitZoom();
    this.requestRender();
  }

  setInsets(insets: { top: number; bottom: number }): void {
    if (insets.top === this.insets.top && insets.bottom === this.insets.bottom) return;
    this.insets = insets;
    this.updateZoomLimits();
    this.emitZoom();
  }

  panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy);
    this.emitZoom();
    this.requestRender();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.camera.zoomAt(sx, sy, factor);
    this.emitZoom();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Settings

  updateSettings(next: EngineSettings): void {
    const prev = this.settings;
    this.settings = next;
    Object.assign(this.renderer.options, {
      guide: next.guide,
      guideOpacity: next.guideOpacity,
      shadows: next.shadows,
      edgesOnly: next.edgesOnly,
    });
    this.renderer.theme = next.theme;
    this.renderer.selectionColor = next.selectionColor;
    if (prev.outline !== next.outline || prev.bevel !== next.bevel) void this.restyle();
    if (prev.edgesOnly !== next.edgesOnly && next.edgesOnly && this.selected !== null) {
      const g = this.model.groups.get(this.selected);
      if (g && g.pieces.length === 1 && !this.model.isEdgePiece(g.pieces[0]!)) this.select(null);
    }
    this.requestRender();
  }

  private async restyle(): Promise<void> {
    const token = ++this.restyleToken;
    const next = await this.atlas.restyle({ outline: this.settings.outline, bevel: this.settings.bevel });
    if (token !== this.restyleToken || this.destroyed) {
      next.dispose();
      return;
    }
    const old = this.atlas;
    this.atlas = next;
    this.renderer.setAtlas(next);
    old.dispose();
    this.requestRender();
  }

  /** Disables piece interaction (pause, disconnected, completed). */
  setInteractive(interactive: boolean): void {
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    if (!interactive) {
      if (this.drag) this.cancelDrag();
      this.input.reset();
    }
  }

  canInteract(): boolean {
    return this.interactive && !this.completed;
  }

  // ---------------------------------------------------------------------------
  // Hit testing and dragging (InputTarget)

  hitTest(sx: number, sy: number, pointerType: string): number | null {
    const [wx, wy] = this.camera.toWorld(sx, sy);
    const groups = Array.from(this.model.groups.values())
      .filter((g) => !g.locked && this.isGroupVisible(g))
      .sort((a, b) => b.z - a.z);
    for (const g of groups) {
      for (const p of g.pieces) if (this.pieceContains(p, g, wx, wy)) return g.id;
    }
    if (pointerType === 'touch' || pointerType === 'pen') {
      // Fingers are imprecise: accept the closest piece centre within a small radius.
      const radius = 22 / this.camera.zoom;
      let best: number | null = null;
      let bestD = radius;
      for (const g of groups) {
        for (const p of g.pieces) {
          const [cx, cy] = this.model.pieceCenter(p, g);
          const d = Math.hypot(cx - wx, cy - wy) - Math.min(this.model.pieceWidth, this.model.pieceHeight) / 2;
          if (d < bestD) {
            bestD = d;
            best = g.id;
          }
        }
        if (best !== null) return best;
      }
    }
    return null;
  }

  private isGroupVisible(g: GroupState): boolean {
    if (!this.settings.edgesOnly || g.pieces.length > 1) return true;
    return this.model.isEdgePiece(g.pieces[0]!);
  }

  private pieceContains(p: number, g: GroupState, wx: number, wy: number): boolean {
    // Into solved space: inverse of world = R(rot)·solved + t.
    const dx = wx - g.x;
    const dy = wy - g.y;
    let sx: number;
    let sy: number;
    switch (g.rot) {
      case 1:
        [sx, sy] = [dy, -dx];
        break;
      case 2:
        [sx, sy] = [-dx, -dy];
        break;
      case 3:
        [sx, sy] = [-dy, dx];
        break;
      default:
        [sx, sy] = [dx, dy];
    }
    const cols = this.model.spec.cols;
    const lx = sx - (p % cols) * this.model.pieceWidth;
    const ly = sy - Math.floor(p / cols) * this.model.pieceHeight;
    const s = this.atlas.sprites[p]!;
    const ox = s.x - (p % cols) * this.model.pieceWidth;
    const oy = s.y - Math.floor(p / cols) * this.model.pieceHeight;
    if (lx < ox || ly < oy || lx > ox + s.w || ly > oy + s.h) return false;
    return this.hitCtx.isPointInPath(this.atlas.paths[p]!, lx, ly);
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  draggedGroup(): number | null {
    return this.drag?.groupId ?? null;
  }

  beginDrag(groupId: number, sx: number, sy: number, keyboard = false): boolean {
    const g = this.model.groups.get(groupId);
    if (!g || g.locked || !this.canInteract()) return false;
    if (this.heldByOthers.has(groupId)) {
      const by = this.players.get(this.heldByOthers.get(groupId)!);
      this.events.notice?.(by ? `${by.name} is moving that piece` : 'Someone else is moving that piece');
      return false;
    }
    const [wx, wy] = this.camera.toWorld(sx, sy);
    this.drag = { groupId, offX: wx - g.x, offY: wy - g.y, origin: { x: g.x, y: g.y, rot: g.rot }, keyboard };
    this.remoteTargets.delete(groupId);
    this.model.bringToFront(groupId);
    this.renderer.orderDirty = true;
    this.renderer.liftedGroup = groupId;
    if (!keyboard && this.selected !== groupId) this.select(null);
    this.net?.send({ t: 'grab', g: groupId });
    this.events.pickup?.();
    if (!this.interacted) {
      this.interacted = true;
      this.events.firstInteraction?.();
    }
    this.requestRender();
    return true;
  }

  dragTo(sx: number, sy: number): void {
    if (!this.drag) return;
    const g = this.model.groups.get(this.drag.groupId);
    if (!g) {
      this.drag = null;
      return;
    }
    const [wx, wy] = this.camera.toWorld(sx, sy);
    g.x = wx - this.drag.offX;
    g.y = wy - this.drag.offY;
    this.sendMove();
    this.requestRender();
  }

  private sendMove(): void {
    if (!this.net) return;
    const now = performance.now();
    const send = () => {
      this.lastMoveSent = performance.now();
      const cur = this.drag && this.model.groups.get(this.drag.groupId);
      if (cur) this.net!.send({ t: 'move', g: cur.id, x: round2(cur.x), y: round2(cur.y), r: cur.rot });
    };
    clearTimeout(this.moveTimer);
    if (now - this.lastMoveSent >= MOVE_INTERVAL_MS) send();
    else this.moveTimer = window.setTimeout(send, MOVE_INTERVAL_MS - (now - this.lastMoveSent));
  }

  endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.renderer.liftedGroup = null;
    clearTimeout(this.moveTimer);
    const g = this.model.groups.get(drag.groupId);
    if (!g) {
      this.requestRender();
      return;
    }
    if (this.net) {
      this.net.send({ t: 'drop', g: g.id, x: round2(g.x), y: round2(g.y), r: g.rot, snap: this.settings.snapStrength, op: this.opCounter++ });
    } else {
      this.resolveLocalDrop(g);
    }
    this.requestRender();
  }

  /** Puts the dragged group back where it was picked up. */
  cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.renderer.liftedGroup = null;
    clearTimeout(this.moveTimer);
    const g = this.model.groups.get(drag.groupId);
    if (g) {
      const before = this.pieceCenters(g);
      g.x = drag.origin.x;
      g.y = drag.origin.y;
      g.rot = drag.origin.rot;
      this.animateFrom(before, g);
      if (this.net) this.net.send({ t: 'drop', g: g.id, x: round2(g.x), y: round2(g.y), r: g.rot, snap: this.settings.snapStrength, op: this.opCounter++ });
    }
    this.requestRender();
  }

  private resolveLocalDrop(g: GroupState): void {
    const before = this.pieceCenters(g);
    const result = this.model.drop(g.id, this.model.snapTolerance(this.settings.snapStrength));
    this.renderer.orderDirty = true;
    const merged = this.model.groups.get(result.groupId);
    if (merged) this.animateFrom(before, merged);
    this.refreshSelection();
    if (result.kind) this.onSnapped(result.kind, result.joined, true, this.model.connectedCount());
    this.events.changed?.();
    if (result.completed) this.finish(true);
  }

  private onSnapped(kind: 'board' | 'piece', joined: number, mine: boolean, connected: number): void {
    const total = this.model.pieceCount;
    this.events.snap?.({ kind, joined, mine, connected, total });
    this.events.progress?.(connected, total);
  }

  private finish(local: boolean): void {
    if (this.completed) return;
    this.completed = true;
    this.select(null);
    this.renderer.highlights.clear();
    if (!this.settings.reducedMotion) this.renderer.completedAt = performance.now() + 250;
    this.events.complete?.(local);
    // Frame the finished picture.
    window.setTimeout(() => !this.destroyed && this.fitBoard(true), 200);
    this.requestRender();
  }

  rotateAt(groupId: number | null, sx: number, sy: number): void {
    if (groupId === null || !this.model.spec.rotation || !this.canInteract()) return;
    const g = this.model.groups.get(groupId);
    if (!g || g.locked) return;
    if (this.heldByOthers.has(groupId)) return;
    const [px, py] = this.camera.toWorld(sx, sy);
    const dragging = this.drag?.groupId === groupId;
    if (dragging) {
      this.rotateGroupVisual(g, px, py);
      this.drag!.offX = px - g.x;
      this.drag!.offY = py - g.y;
      this.sendMove();
    } else {
      // Rotating a resting group is a quick pick-up, turn and put-down.
      if (!this.beginDrag(groupId, sx, sy, true)) return;
      this.rotateGroupVisual(g, px, py);
      this.endDrag();
    }
    this.events.announce?.('Piece rotated');
    this.requestRender();
  }

  private rotateGroupVisual(g: GroupState, px: number, py: number): void {
    const before = this.pieceCenters(g);
    this.model.rotateGroup(g.id, px, py, 1);
    if (!this.settings.reducedMotion) {
      // Slide each piece from where it was; rotation itself snaps in 90° steps.
      this.animateFrom(before, g, 120);
    }
  }

  pointerMoved(sx: number, sy: number): void {
    if (!this.net) return;
    const now = performance.now();
    if (now - this.lastCursorSent < CURSOR_INTERVAL_MS) return;
    this.lastCursorSent = now;
    const [wx, wy] = this.camera.toWorld(sx, sy);
    this.net.send({ t: 'cursor', x: round1(wx), y: round1(wy) });
  }

  pointerLeft(): void {
    this.net?.send({ t: 'cursorHide' });
  }

  autoPanTick(sx: number, sy: number): boolean {
    if (!this.settings.autoPan || !this.drag) return false;
    const w = this.camera.viewWidth;
    const h = this.camera.viewHeight;
    if (w < 320 || h < 320) return false;
    const speed = (d: number) => (d < EDGE_ZONE ? ((EDGE_ZONE - Math.max(0, d)) / EDGE_ZONE) * 12 : 0);
    const dx = speed(sx) - speed(w - sx);
    const dy = speed(sy - this.insets.top) - speed(h - this.insets.bottom - sy);
    if (dx === 0 && dy === 0) return false;
    this.camera.panBy(dx, dy);
    this.requestRender();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Keyboard control (canvas focused)

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const step = (e.shiftKey ? 40 : 8) / this.camera.zoom;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (e.key in arrows) {
      e.preventDefault();
      const [ax, ay] = arrows[e.key]!;
      if (this.drag?.keyboard) {
        const g = this.model.groups.get(this.drag.groupId);
        if (g) {
          g.x += ax * step;
          g.y += ay * step;
          this.sendMove();
          this.requestRender();
        }
      } else {
        this.panBy(-ax * (e.shiftKey ? 160 : 48), -ay * (e.shiftKey ? 160 : 48));
      }
      return;
    }
    switch (e.key) {
      case 'n':
      case 'N':
        e.preventDefault();
        if (this.drag?.keyboard) this.endDrag();
        this.selectNext(e.shiftKey ? -1 : 1);
        return;
      case 'Enter':
        e.preventDefault();
        this.toggleKeyboardHold();
        return;
      case 'Escape':
        if (this.drag) {
          e.preventDefault();
          this.cancelDrag();
          this.events.announce?.('Move cancelled');
        } else if (this.selected !== null) {
          e.preventDefault();
          this.select(null);
        }
        return;
      case 'r':
      case 'R': {
        const id = this.drag?.groupId ?? this.selected;
        if (id === null || !this.model.spec.rotation) return;
        e.preventDefault();
        const g = this.model.groups.get(id);
        if (!g) return;
        const [cx, cy] = this.model.groupCenter(g);
        const [sx, sy] = this.camera.toScreen(cx, cy);
        this.rotateAt(id, sx, sy);
        return;
      }
      default:
        return;
    }
  };

  private toggleKeyboardHold(): void {
    if (this.drag) {
      const piece = this.model.groups.get(this.drag.groupId)?.pieces[0];
      this.endDrag();
      if (piece !== undefined && !this.completed) {
        const g = this.model.groupOf(piece);
        this.select(g && !g.locked ? g.id : null);
      }
      this.events.announce?.('Piece dropped');
      return;
    }
    if (this.selected === null) {
      this.selectNext(1);
      return;
    }
    const g = this.model.groups.get(this.selected);
    if (!g) return;
    const [cx, cy] = this.model.groupCenter(g);
    const [sx, sy] = this.camera.toScreen(cx, cy);
    if (this.beginDrag(g.id, sx, sy, true)) {
      this.events.announce?.('Piece picked up. Move it with the arrow keys, press Enter to drop or Escape to cancel.');
    }
  }

  private selectNext(dir: 1 | -1): void {
    const loose = Array.from(this.model.groups.values())
      .filter((g) => !g.locked && this.isGroupVisible(g) && !this.heldByOthers.has(g.id))
      .map((g) => ({ g, c: this.model.groupCenter(g) }))
      .sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0]);
    if (loose.length === 0) return;
    const idx = loose.findIndex((l) => l.g.id === this.selected);
    const ni = idx === -1 ? (dir === 1 ? 0 : loose.length - 1) : (idx + dir + loose.length) % loose.length;
    const next = loose[ni]!;
    this.select(next.g.id);
    this.camera.centerOn(next.c[0], next.c[1], this.settings.reducedMotion ? 0 : 260);
    const pieces = next.g.pieces.length;
    const edge = pieces === 1 && this.model.isEdgePiece(next.g.pieces[0]!);
    const what = pieces === 1 ? (edge ? 'Edge piece' : 'Piece') : `Group of ${pieces} pieces`;
    this.events.announce?.(`${what} selected, ${ni + 1} of ${loose.length}. Press Enter to pick it up.`);
    this.requestRender();
  }

  private select(groupId: number | null): void {
    this.selected = groupId;
    this.selectedPiece = groupId === null ? null : (this.model.groups.get(groupId)?.pieces[0] ?? null);
    this.renderer.selectedGroup = groupId;
    this.requestRender();
  }

  /** Keeps the keyboard selection on the same pieces after their group merged. */
  private refreshSelection(): void {
    if (this.selected === null || this.model.groups.has(this.selected)) return;
    const g = this.selectedPiece !== null ? this.model.groupOf(this.selectedPiece) : undefined;
    this.select(g && !g.locked ? g.id : null);
  }

  // ---------------------------------------------------------------------------
  // Tools

  /** Re-scatters loose single pieces around the board. */
  scatter(): void {
    if (!this.canInteract()) return;
    const parent = this.canvas.parentElement;
    const aspect = parent && parent.clientHeight ? parent.clientWidth / parent.clientHeight : this.lastLayoutAspect;
    if (this.net) {
      this.net.send({ t: 'scatter', aspect });
      return;
    }
    const exclude = new Set<number>(this.drag ? [this.drag.groupId] : []);
    const before = new Map<number, [number, number]>();
    for (const g of this.model.groups.values()) if (!g.locked && g.pieces.length === 1) before.set(g.pieces[0]!, this.model.pieceCenter(g.pieces[0]!, g));
    const changed = this.model.scatterLoose((Math.random() * 0xffffffff) >>> 0, aspect, exclude);
    this.renderer.orderDirty = true;
    for (const c of changed) this.animatePieces(before, c, 320);
    this.events.changed?.();
    this.updateZoomLimits();
    this.requestRender();
  }

  snapshot(): GroupState[] {
    return this.model.snapshot();
  }

  connectedCount(): number {
    return this.model.connectedCount();
  }

  isCompleted(): boolean {
    return this.completed;
  }

  focus(): void {
    this.canvas.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Multiplayer: applying server messages

  setPlayers(players: PlayerInfo[]): void {
    this.players.clear();
    for (const p of players) this.players.set(p.id, { name: p.name, color: p.color, online: p.online });
    for (const [g, by] of this.heldByOthers) this.renderer.highlights.set(g, this.players.get(by)?.color ?? '#888');
    for (const [id, c] of this.cursors) {
      const p = this.players.get(id);
      if (!p || !p.online) {
        c.el.remove();
        this.cursors.delete(id);
      } else {
        this.styleCursor(c.el, p.name, p.color);
      }
    }
    this.requestRender();
  }

  /** Full state from the server (initial join or after reconnecting). */
  applySnapshot(groups: WireGroup[], held: Array<[number, string]>): void {
    if (this.drag) {
      this.drag = null;
      this.renderer.liftedGroup = null;
      this.input.reset();
    }
    this.model.replaceAll(groups.map(fromWire));
    this.heldByOthers.clear();
    this.renderer.highlights.clear();
    this.remoteTargets.clear();
    for (const [g, by] of held) {
      if (by === this.net?.selfId) continue;
      this.heldByOthers.set(g, by);
      this.renderer.highlights.set(g, this.players.get(by)?.color ?? '#888');
    }
    if (this.selected !== null && !this.model.groups.has(this.selected)) this.select(null);
    this.renderer.setModel(this.model);
    this.events.progress?.(this.model.connectedCount(), this.model.pieceCount);
    this.requestRender();
  }

  handleServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'held': {
        if (msg.by === this.net?.selfId) return;
        this.heldByOthers.set(msg.g, msg.by);
        this.renderer.highlights.set(msg.g, this.players.get(msg.by)?.color ?? '#888');
        this.model.bringToFront(msg.g);
        this.renderer.orderDirty = true;
        if (this.drag?.groupId === msg.g) {
          // Someone else got there first.
          this.drag = null;
          this.renderer.liftedGroup = null;
          this.input.reset();
        }
        if (this.selected === msg.g) this.select(null);
        this.requestRender();
        return;
      }
      case 'denied': {
        if (this.drag?.groupId === msg.g) {
          this.drag = null;
          this.renderer.liftedGroup = null;
          this.input.reset();
        }
        if (msg.group) this.applyGroupChanges([msg.group], [], true);
        else if (this.model.groups.has(msg.g)) this.requestRender();
        this.events.notice?.('Someone else is moving that piece');
        return;
      }
      case 'tick': {
        if (msg.m) {
          for (const [g, x, y, rot] of msg.m) {
            if (this.drag?.groupId === g) continue;
            const group = this.model.groups.get(g);
            if (!group) continue;
            if (group.rot !== rot) {
              const before = this.pieceCenters(group);
              group.x = x;
              group.y = y;
              group.rot = rot;
              this.animateFrom(before, group, 120);
              this.remoteTargets.delete(g);
            } else {
              this.remoteTargets.set(g, { x, y, rot });
            }
          }
        }
        if (msg.c) for (const [id, x, y] of msg.c) if (id !== this.net?.selfId) this.updateCursor(id, x, y);
        if (msg.ch) for (const id of msg.ch) this.hideCursor(id);
        this.requestRender();
        return;
      }
      case 'update': {
        for (const w of msg.groups) {
          if (msg.reason !== 'scatter') {
            this.heldByOthers.delete(w.i);
            this.renderer.highlights.delete(w.i);
          }
          this.remoteTargets.delete(w.i);
        }
        for (const id of msg.removed) {
          this.heldByOthers.delete(id);
          this.renderer.highlights.delete(id);
          this.remoteTargets.delete(id);
        }
        this.applyGroupChanges(msg.groups, msg.removed, true);
        const mine = msg.by === this.net?.selfId;
        if (msg.kind) this.onSnapped(msg.kind, msg.joined, mine, msg.connected);
        else this.events.progress?.(msg.connected, this.model.pieceCount);
        if (msg.reason === 'scatter') this.updateZoomLimits();
        return;
      }
      case 'complete':
        this.finish(false);
        return;
      default:
        return;
    }
  }

  /** Applies authoritative group changes, animating pieces from where they were drawn. */
  private applyGroupChanges(groups: WireGroup[], removed: number[], animate: boolean): void {
    const before = new Map<number, [number, number]>();
    const dragging = this.drag ? this.model.groups.get(this.drag.groupId) : undefined;
    for (const w of groups) {
      for (const p of w.p) {
        const g = this.model.groupOf(p);
        if (g) before.set(p, this.model.pieceCenter(p, g));
      }
    }
    if (this.drag && removed.includes(this.drag.groupId)) {
      this.drag = null;
      this.renderer.liftedGroup = null;
      this.input.reset();
    }
    const changed = groups.map(fromWire);
    // Keep the locally dragged group under the pointer; the server only lags behind.
    if (dragging && this.drag) {
      for (const c of changed) {
        if (c.id === dragging.id) {
          c.x = dragging.x;
          c.y = dragging.y;
          c.rot = dragging.rot;
        }
      }
    }
    this.model.applyChanges(changed, removed);
    this.renderer.orderDirty = true;
    if (animate) for (const c of changed) this.animatePieces(before, c, 160);
    this.refreshSelection();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Animation helpers

  private pieceCenters(g: GroupState): Map<number, [number, number]> {
    const m = new Map<number, [number, number]>();
    for (const p of g.pieces) m.set(p, this.model.pieceCenter(p, g));
    return m;
  }

  private animateFrom(before: Map<number, [number, number]>, g: GroupState, duration = 150): void {
    this.animatePieces(before, g, duration);
  }

  private animatePieces(before: Map<number, [number, number]>, g: GroupState, duration: number): void {
    const d = this.settings.reducedMotion ? 0 : duration;
    for (const p of g.pieces) {
      const old = before.get(p);
      if (!old) continue;
      const [nx, ny] = this.model.pieceCenter(p, g);
      const existing = this.renderer.offsets.get(p);
      let dx = old[0] - nx;
      let dy = old[1] - ny;
      if (existing) {
        // Chain onto a running animation so pieces never jump.
        const t = Math.min(1, (performance.now() - existing.start) / existing.duration);
        const k = Math.pow(1 - t, 3);
        dx += existing.dx * k;
        dy += existing.dy * k;
      }
      if (Math.hypot(dx, dy) > Math.max(this.model.pieceWidth, this.model.pieceHeight) * 12) continue;
      this.renderer.animateOffset(p, dx, dy, d);
    }
    this.requestRender();
  }

  /** Smoothly moves groups held by other players towards their latest reported position. */
  private stepRemote(dt: number): boolean {
    if (this.remoteTargets.size === 0) return false;
    const k = 1 - Math.exp(-dt / 55);
    for (const [id, t] of this.remoteTargets) {
      const g = this.model.groups.get(id);
      if (!g) {
        this.remoteTargets.delete(id);
        continue;
      }
      g.x += (t.x - g.x) * k;
      g.y += (t.y - g.y) * k;
      if (Math.abs(t.x - g.x) < 0.05 && Math.abs(t.y - g.y) < 0.05) {
        g.x = t.x;
        g.y = t.y;
        this.remoteTargets.delete(id);
      }
    }
    return this.remoteTargets.size > 0;
  }

  // ---------------------------------------------------------------------------
  // Remote cursors (DOM overlay: crisp text, no canvas redraws needed)

  private updateCursor(id: string, x: number, y: number): void {
    const player = this.players.get(id);
    if (!player) return;
    let c = this.cursors.get(id);
    if (!c) {
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML =
        '<svg width="18" height="20" viewBox="0 0 18 20"><path d="M1.5 1.5l14 7.2-6.3 1.6-2.9 6.2z" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
      this.overlay.appendChild(el);
      c = { el, x, y, tx: x, ty: y, visible: true, lastSeen: performance.now() };
      this.cursors.set(id, c);
      this.styleCursor(el, player.name, player.color);
    }
    c.tx = x;
    c.ty = y;
    c.lastSeen = performance.now();
    if (!c.visible) {
      c.visible = true;
      c.x = x;
      c.y = y;
      c.el.style.opacity = '1';
    }
  }

  private styleCursor(el: HTMLElement, name: string, color: string): void {
    const path = el.querySelector('path');
    if (path) path.setAttribute('fill', color);
    const label = el.querySelector('span');
    if (label) {
      label.textContent = name;
      label.style.background = color;
    }
  }

  private hideCursor(id: string): void {
    const c = this.cursors.get(id);
    if (!c) return;
    c.visible = false;
    c.el.style.opacity = '0';
  }

  private cursorsAnimating(): boolean {
    for (const c of this.cursors.values()) if (c.visible && (Math.abs(c.tx - c.x) > 0.5 || Math.abs(c.ty - c.y) > 0.5)) return true;
    return false;
  }

  private positionCursors(dt: number): void {
    if (this.cursors.size === 0) return;
    const k = 1 - Math.exp(-dt / 60);
    const now = performance.now();
    for (const c of this.cursors.values()) {
      if (c.visible && now - c.lastSeen > 15_000) {
        c.visible = false;
        c.el.style.opacity = '0';
      }
      c.x += (c.tx - c.x) * k;
      c.y += (c.ty - c.y) * k;
      const [sx, sy] = this.camera.toScreen(c.x, c.y);
      c.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
    }
  }

  // ---------------------------------------------------------------------------

  /** Visible world rectangle, useful for tests and debugging tools. */
  debugInfo(): { zoom: number; view: Rect; groups: number } {
    return { zoom: this.camera.zoom, view: this.camera.visibleWorld(), groups: this.model.groups.size };
  }

  /** Screen position of a piece centre and of its solved position (for automated tests). */
  debugPiece(piece: number): { screen: [number, number]; home: [number, number]; group: number; locked: boolean } {
    const g = this.model.groupOf(piece);
    const [cx, cy] = this.model.pieceCenter(piece, g);
    const [hx, hy] = this.model.homeCenter(piece);
    return { screen: this.camera.toScreen(cx, cy), home: this.camera.toScreen(hx, hy), group: g.id, locked: g.locked };
  }

  /**
   * A screen point where pressing would pick up this piece (not covered by
   * another piece), or null if none is visible. Used by automated tests.
   */
  debugGrabPoint(piece: number): [number, number] | null {
    const g = this.model.groupOf(piece);
    const [cx, cy] = this.model.pieceCenter(piece, g);
    const size = Math.min(this.model.pieceWidth, this.model.pieceHeight);
    const offsets = [0, 0.15, -0.15, 0.25, -0.25];
    for (const ox of offsets) {
      for (const oy of offsets) {
        const [sx, sy] = this.camera.toScreen(cx + ox * size, cy + oy * size);
        if (sx < 0 || sy < this.insets.top || sx > this.camera.viewWidth || sy > this.camera.viewHeight - this.insets.bottom) continue;
        if (this.hitTest(sx, sy, 'mouse') === g.id) return [sx, sy];
      }
    }
    return null;
  }

  wire(): WireGroup[] {
    return this.model.snapshot().map(toWire);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

