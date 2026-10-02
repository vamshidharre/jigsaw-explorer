/**
 * Canvas renderer. Draws on demand (never in a busy loop): callers mark the
 * scene dirty and the next animation frame redraws it.
 *
 * Draw order: board → guide image → placed pieces (cached in one bitmap) →
 * loose groups by z-order. Each loose group draws all its shadows first and
 * then its pieces, so joined pieces never shadow each other.
 */
import type { GroupState, PuzzleModel } from '../../shared/puzzle/model';
import type { Camera } from './Camera';
import type { PieceAtlas, Sprite } from './PieceAtlas';

export interface BoardTheme {
  boardFill: string;
  boardEdge: string;
  shadowAlpha: number;
}

export interface RenderOptions {
  guide: boolean;
  guideOpacity: number;
  shadows: boolean;
  edgesOnly: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private boardLayer: HTMLCanvasElement | null = null;
  private boardLayerScale = 1;
  private readonly boardDrawn = new Set<number>();
  private order: GroupState[] = [];
  orderDirty = true;
  /** Ids of groups that are highlighted (e.g. held by other players) and their colour. */
  readonly highlights = new Map<number, string>();
  /** Visual offsets per piece used to animate snaps. */
  readonly offsets = new Map<number, { dx: number; dy: number; start: number; duration: number }>();
  liftedGroup: number | null = null;
  selectedGroup: number | null = null;
  selectionColor = '#14b8a6';
  completedAt: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private model: PuzzleModel,
    private atlas: PieceAtlas,
    private image: CanvasImageSource,
    private readonly camera: Camera,
    public theme: BoardTheme,
    public options: RenderOptions,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.ctx = ctx;
  }

  setModel(model: PuzzleModel): void {
    this.model = model;
    this.orderDirty = true;
    this.resetBoardLayer();
  }

  setAtlas(atlas: PieceAtlas): void {
    this.atlas = atlas;
    this.resetBoardLayer();
  }

  setImage(image: CanvasImageSource): void {
    this.image = image;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  resetBoardLayer(): void {
    this.boardDrawn.clear();
    if (this.boardLayer) {
      this.boardLayer.width = 0;
      this.boardLayer.height = 0;
    }
    this.boardLayer = null;
  }

  /** Starts a snap animation: the piece appears to slide from its old position. */
  animateOffset(piece: number, dx: number, dy: number, duration: number): void {
    if (duration <= 0 || (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01)) {
      this.offsets.delete(piece);
      return;
    }
    this.offsets.set(piece, { dx, dy, start: performance.now(), duration });
  }

  get animating(): boolean {
    return this.offsets.size > 0;
  }

  private ensureBoardLayer(): void {
    const spec = this.model.spec;
    if (!this.boardLayer) {
      // Cap the cached layer to a sensible size; it never needs more detail than the atlas.
      this.boardLayerScale = Math.min(this.atlas.scale, 4096 / Math.max(spec.width, spec.height));
      this.boardLayer = document.createElement('canvas');
      this.boardLayer.width = Math.ceil(spec.width * this.boardLayerScale);
      this.boardLayer.height = Math.ceil(spec.height * this.boardLayerScale);
    }
    let board: GroupState | undefined;
    for (const g of this.model.groups.values()) {
      if (g.locked) {
        board = g;
        break;
      }
    }
    if (!board || board.pieces.length === this.boardDrawn.size) return;
    const ctx = this.boardLayer.getContext('2d')!;
    ctx.setTransform(this.boardLayerScale, 0, 0, this.boardLayerScale, 0, 0);
    for (const p of board.pieces) {
      if (this.boardDrawn.has(p)) continue;
      this.boardDrawn.add(p);
      const s = this.atlas.sprites[p]!;
      ctx.drawImage(this.atlas.pages[s.page]!, s.sx, s.sy, s.sw, s.sh, s.x, s.y, s.w, s.h);
    }
  }

  private sortedGroups(): GroupState[] {
    if (this.orderDirty) {
      this.order = Array.from(this.model.groups.values())
        .filter((g) => !g.locked)
        .sort((a, b) => a.z - b.z);
      this.orderDirty = false;
    }
    return this.order;
  }

  /** Draws one frame. Returns true if animations still need more frames. */
  draw(now: number): boolean {
    const { ctx, camera, model, atlas, options } = this;
    const spec = model.spec;
    const dpr = this.dpr;

    // Expire finished snap animations.
    for (const [p, o] of this.offsets) if (now - o.start >= o.duration) this.offsets.delete(p);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const z = camera.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, camera.panX * dpr, camera.panY * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = camera.zoom < atlas.scale * 0.6 ? 'high' : 'medium';

    // Board.
    const radius = Math.min(spec.width, spec.height) * 0.006;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${this.theme.shadowAlpha * 0.6})`;
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = this.theme.boardFill;
    roundRect(ctx, 0, 0, spec.width, spec.height, radius);
    ctx.fill();
    ctx.restore();
    if (options.guide && options.guideOpacity > 0) {
      ctx.globalAlpha = options.guideOpacity;
      ctx.drawImage(this.image, 0, 0, spec.width, spec.height);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.strokeStyle = this.theme.boardEdge;
    roundRect(ctx, 0, 0, spec.width, spec.height, radius);
    ctx.stroke();

    // Placed pieces.
    this.ensureBoardLayer();
    if (this.boardDrawn.size > 0 && this.boardLayer) {
      ctx.drawImage(this.boardLayer, 0, 0, spec.width, spec.height);
    }

    // Loose groups.
    const view = camera.visibleWorld(0);
    const margin = Math.max(model.pieceWidth, model.pieceHeight) * 0.9;
    const groups = this.sortedGroups();
    for (const g of groups) {
      if (g.locked) continue;
      if (options.edgesOnly && g.pieces.length === 1 && !model.isEdgePiece(g.pieces[0]!) && g.id !== this.liftedGroup) continue;
      const lifted = g.id === this.liftedGroup;
      const highlight = this.highlights.get(g.id) ?? (g.id === this.selectedGroup ? this.selectionColor : null);

      // Group transform: world = R(rot)·solved + (x, y)
      const cos = g.rot === 0 ? 1 : g.rot === 2 ? -1 : 0;
      const sin = g.rot === 1 ? 1 : g.rot === 3 ? -1 : 0;
      const inView = (p: number) => {
        const [cx, cy] = model.pieceCenter(p, g);
        return cx > view.minX - margin && cx < view.maxX + margin && cy > view.minY - margin && cy < view.maxY + margin;
      };
      const visible = g.pieces.length > 40 ? g.pieces.filter(inView) : g.pieces.some(inView) ? g.pieces : [];
      if (visible.length === 0) continue;

      ctx.setTransform(z * cos, z * sin, -z * sin, z * cos, (camera.panX + g.x * camera.zoom) * dpr, (camera.panY + g.y * camera.zoom) * dpr);

      if (highlight) {
        const grow = Math.min(model.pieceWidth, model.pieceHeight) * 0.035;
        for (const p of visible) {
          const glow = atlas.glow(p, highlight);
          if (!glow) continue;
          const [ox, oy] = this.offsetFor(p, now, g.rot);
          const s = glow.sprite;
          ctx.globalAlpha = 0.95;
          ctx.drawImage(glow.canvas, s.x - grow + ox, s.y - grow + oy, s.w + grow * 2, s.h + grow * 2);
        }
        ctx.globalAlpha = 1;
      }
      if (options.shadows) {
        const lift = lifted ? 0.045 : 0.014;
        const size = Math.min(model.pieceWidth, model.pieceHeight);
        // Shadows fall down-right on screen regardless of the group's rotation.
        const [sdx, sdy] = unrotate(size * lift, size * lift * 1.6, g.rot);
        ctx.globalAlpha = this.theme.shadowAlpha * (lifted ? 0.75 : 0.55);
        const grow = lifted ? size * 0.04 : 0;
        for (const p of visible) {
          const s = atlas.shadows[p];
          if (!s) continue;
          const [ox, oy] = this.offsetFor(p, now, g.rot);
          ctx.drawImage(atlas.shadowPages[s.page]!, s.sx, s.sy, s.sw, s.sh, s.x + sdx + ox - grow, s.y + sdy + oy - grow, s.w + grow * 2, s.h + grow * 2);
        }
        ctx.globalAlpha = 1;
      }
      for (const p of visible) {
        const s: Sprite = atlas.sprites[p]!;
        const [ox, oy] = this.offsetFor(p, now, g.rot);
        ctx.drawImage(atlas.pages[s.page]!, s.sx, s.sy, s.sw, s.sh, s.x + ox, s.y + oy, s.w, s.h);
      }
    }

    // Completion sheen: a soft light band sweeping across the finished picture.
    let sweeping = false;
    if (this.completedAt !== null) {
      const t = (now - this.completedAt) / 1400;
      if (t >= 0 && t <= 1) {
        sweeping = true;
        ctx.setTransform(z, 0, 0, z, camera.panX * dpr, camera.panY * dpr);
        const x = -spec.width * 0.4 + t * spec.width * 1.8;
        const grad = ctx.createLinearGradient(x - spec.width * 0.25, 0, x + spec.width * 0.05, spec.height * 0.3);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        roundRect(ctx, 0, 0, spec.width, spec.height, radius);
        ctx.clip();
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, spec.width, spec.height);
        ctx.restore();
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return this.offsets.size > 0 || sweeping;
  }

  /** Current snap-animation offset for a piece, expressed in the group's solved space. */
  private offsetFor(piece: number, now: number, rot: number): [number, number] {
    const o = this.offsets.get(piece);
    if (!o) return [0, 0];
    const t = Math.min(1, (now - o.start) / o.duration);
    const k = Math.pow(1 - t, 3);
    return unrotate(o.dx * k, o.dy * k, rot);
  }
}

/** Converts a world-space vector into a group's solved space (inverse rotation). */
function unrotate(x: number, y: number, rot: number): [number, number] {
  switch (rot) {
    case 1:
      return [y, -x];
    case 2:
      return [-x, -y];
    case 3:
      return [-y, x];
    default:
      return [x, y];
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

