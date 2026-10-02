/**
 * Canvas renderer. Draws on demand (never in a busy loop): callers mark the
 * scene dirty and the next animation frame redraws it.
 *
 * Draw order: board → guide image → placed pieces (cached in one bitmap) →
 * loose groups by z-order. Each loose group draws all its shadows first and
 * then its pieces, so joined pieces never shadow each other.
 *
 * Performance:
 *  - Every texture has a lazily built mip chain, so zoomed-out views sample
 *    from pre-shrunk copies with cheap bilinear filtering.
 *  - While something moves on a still camera (a drag, another player's drag,
 *    a snap animation), everything else is rendered once into a cached layer
 *    and each frame only blits that layer and redraws the moving groups.
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

type Source = HTMLCanvasElement | ImageBitmap | HTMLImageElement | CanvasImageSource;

const MAX_MIP = 4;

/** Halving chain of a texture, built on first use and frozen into ImageBitmaps when possible. */
class MipChain {
  private levels: Array<{ image: Source; sx: number; sy: number } | undefined> = [];
  private disposed = false;

  constructor(
    private src: Source,
    private readonly w: number,
    private readonly h: number,
  ) {}

  /** Returns the texture for a level and the factor to apply to level-0 source coordinates. */
  get(level: number): { image: Source; sx: number; sy: number } {
    if (level <= 0) return { image: this.src, sx: 1, sy: 1 };
    let entry = this.levels[level];
    if (!entry) {
      const prev = this.get(level - 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(this.w / 2 ** level));
      canvas.height = Math.max(1, Math.ceil(this.h / 2 ** level));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const pw = Math.max(1, Math.ceil(this.w / 2 ** (level - 1)));
      const ph = Math.max(1, Math.ceil(this.h / 2 ** (level - 1)));
      ctx.drawImage(prev.image, 0, 0, Math.min(pw, sourceWidth(prev.image)), Math.min(ph, sourceHeight(prev.image)), 0, 0, canvas.width, canvas.height);
      const created = { image: canvas as Source, sx: canvas.width / this.w, sy: canvas.height / this.h };
      entry = created;
      this.levels[level] = created;
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(canvas)
          .then((bmp) => {
            if (this.disposed || this.levels[level] !== created) return bmp.close();
            created.image = bmp;
            canvas.width = 0;
            canvas.height = 0;
          })
          .catch(() => undefined);
      }
    }
    return { image: entry.image, sx: entry.sx, sy: entry.sy };
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.levels) {
      if (!l) continue;
      if (l.image instanceof HTMLCanvasElement) {
        l.image.width = 0;
        l.image.height = 0;
      } else if (l.image instanceof ImageBitmap) {
        l.image.close();
      }
    }
    this.levels = [];
  }
}

function sourceWidth(s: Source): number {
  return (s as HTMLImageElement).naturalWidth || (s as { width: number }).width;
}

function sourceHeight(s: Source): number {
  return (s as HTMLImageElement).naturalHeight || (s as { height: number }).height;
}

/**
 * Mip level for a given magnification. Sampling a texture close to its native
 * size is far cheaper than shrinking a large one (especially in software
 * rendering), so we switch to the smaller level a little early and accept a
 * slight upscale. `bias` > 0 favours smaller levels (fine for blurry shadows).
 */
function mipLevel(devicePxPerTexel: number, bias = 0.35): number {
  if (devicePxPerTexel >= 1) return 0;
  return Math.max(0, Math.min(MAX_MIP, Math.floor(Math.log2(1 / devicePxPerTexel) + bias)));
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private boardLayer: HTMLCanvasElement | null = null;
  private boardLayerScale = 1;
  private boardMips: MipChain | null = null;
  private readonly boardDrawn = new Set<number>();
  private pageMips: MipChain[] = [];
  private shadowMips: MipChain[] = [];
  private imageMips: MipChain;
  private boardShadow: HTMLCanvasElement | null = null;
  private order: GroupState[] = [];
  orderDirty = true;

  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private version = 0;
  private lastCameraKey = '';

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
    this.imageMips = new MipChain(image, sourceWidth(image as Source), sourceHeight(image as Source));
    this.buildAtlasMips();
  }

  /** Marks the cached static layer as stale (call after any change to resting pieces). */
  invalidate(): void {
    this.version++;
  }

  setModel(model: PuzzleModel): void {
    this.model = model;
    this.orderDirty = true;
    this.resetBoardLayer();
    this.invalidate();
  }

  setAtlas(atlas: PieceAtlas): void {
    this.atlas = atlas;
    this.buildAtlasMips();
    this.resetBoardLayer();
    this.invalidate();
  }

  setImage(image: CanvasImageSource): void {
    this.image = image;
    this.imageMips.dispose();
    this.imageMips = new MipChain(image, sourceWidth(image as Source), sourceHeight(image as Source));
    this.invalidate();
  }

  private buildAtlasMips(): void {
    for (const m of this.pageMips) m.dispose();
    for (const m of this.shadowMips) m.dispose();
    this.pageMips = this.atlas.pages.map((p) => new MipChain(p, p.width, p.height));
    this.shadowMips = this.atlas.shadowPages.map((p) => new MipChain(p, p.width, p.height));
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.invalidate();
    }
  }

  resetBoardLayer(): void {
    this.boardDrawn.clear();
    this.boardMips?.dispose();
    this.boardMips = null;
    if (this.boardLayer) {
      this.boardLayer.width = 0;
      this.boardLayer.height = 0;
    }
    this.boardLayer = null;
    this.invalidate();
  }

  dispose(): void {
    this.resetBoardLayer();
    for (const m of this.pageMips) m.dispose();
    for (const m of this.shadowMips) m.dispose();
    this.imageMips.dispose();
    if (this.staticLayer) {
      this.staticLayer.width = 0;
      this.staticLayer.height = 0;
    }
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
    // Mips are rebuilt lazily from the updated layer.
    this.boardMips?.dispose();
    this.boardMips = new MipChain(this.boardLayer, this.boardLayer.width, this.boardLayer.height);
    this.invalidate();
  }

  private sortedGroups(): GroupState[] {
    if (this.orderDirty) {
      this.order = Array.from(this.model.groups.values())
        .filter((g) => !g.locked)
        .sort((a, b) => a.z - b.z);
      this.orderDirty = false;
      this.invalidate();
    }
    return this.order;
  }

  /** Groups that change from frame to frame and are therefore never cached. */
  private dynamicGroups(): Set<number> {
    const dyn = new Set<number>();
    if (this.liftedGroup !== null) dyn.add(this.liftedGroup);
    for (const id of this.highlights.keys()) dyn.add(id);
    for (const p of this.offsets.keys()) {
      const id = this.model.pieceToGroup[p];
      if (id !== undefined && id >= 0) dyn.add(id);
    }
    return dyn;
  }

  /** Draws one frame. Returns true if animations still need more frames. */
  draw(now: number): boolean {
    const { ctx, camera } = this;
    for (const [p, o] of this.offsets) if (now - o.start >= o.duration) this.offsets.delete(p);
    this.ensureBoardLayer();
    const groups = this.sortedGroups();

    const cameraKey = `${camera.zoom}|${camera.panX}|${camera.panY}|${this.canvas.width}|${this.canvas.height}`;
    const cameraStill = cameraKey === this.lastCameraKey;
    this.lastCameraKey = cameraKey;
    const dynamic = this.dynamicGroups();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (dynamic.size > 0 && cameraStill) {
      // Cached path: everything that is not moving lives in the static layer.
      const key = `${cameraKey}|${this.version}|${[...dynamic].sort((a, b) => a - b).join(',')}|${this.selectedGroup}|${this.options.guide}|${this.options.guideOpacity}|${this.options.shadows}|${this.options.edgesOnly}`;
      if (key !== this.staticKey || !this.staticLayer) {
        if (!this.staticLayer) this.staticLayer = document.createElement('canvas');
        if (this.staticLayer.width !== this.canvas.width || this.staticLayer.height !== this.canvas.height) {
          this.staticLayer.width = this.canvas.width;
          this.staticLayer.height = this.canvas.height;
        }
        const sctx = this.staticLayer.getContext('2d')!;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, this.staticLayer.width, this.staticLayer.height);
        this.drawScene(sctx, groups, now, (g) => !dynamic.has(g.id));
        this.staticKey = key;
      }
      ctx.drawImage(this.staticLayer, 0, 0);
      this.drawGroups(ctx, groups, now, (g) => dynamic.has(g.id));
    } else {
      this.staticKey = '';
      this.drawScene(ctx, groups, now, () => true);
    }

    const sweeping = this.drawSweep(ctx, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return this.offsets.size > 0 || sweeping;
  }

  private worldTransform(ctx: CanvasRenderingContext2D): void {
    const z = this.camera.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, this.camera.panX * this.dpr, this.camera.panY * this.dpr);
  }

  private drawScene(ctx: CanvasRenderingContext2D, groups: GroupState[], now: number, include: (g: GroupState) => boolean): void {
    this.drawBoard(ctx);
    this.drawGroups(ctx, groups, now, include);
  }

  private drawBoard(ctx: CanvasRenderingContext2D): void {
    const { camera, options } = this;
    const spec = this.model.spec;
    const devicePerWorld = camera.zoom * this.dpr;
    const radius = Math.min(spec.width, spec.height) * 0.006;
    this.worldTransform(ctx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    // Soft shadow under the board, pre-rendered once at low resolution.
    const shadow = this.getBoardShadow();
    const pad = Math.max(spec.width, spec.height) * 0.06;
    ctx.globalAlpha = this.theme.shadowAlpha * 0.6;
    ctx.drawImage(shadow, -pad, -pad + pad * 0.18, spec.width + pad * 2, spec.height + pad * 2);
    ctx.globalAlpha = 1;

    ctx.fillStyle = this.theme.boardFill;
    roundRect(ctx, 0, 0, spec.width, spec.height, radius);
    ctx.fill();
    if (options.guide && options.guideOpacity > 0) {
      const iw = sourceWidth(this.image as Source);
      const level = mipLevel(devicePerWorld * (spec.width / iw));
      const mip = this.imageMips.get(level);
      ctx.globalAlpha = options.guideOpacity;
      ctx.drawImage(mip.image as CanvasImageSource, 0, 0, iw * mip.sx, sourceHeight(this.image as Source) * mip.sy, 0, 0, spec.width, spec.height);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.strokeStyle = this.theme.boardEdge;
    roundRect(ctx, 0, 0, spec.width, spec.height, radius);
    ctx.stroke();

    if (this.boardDrawn.size > 0 && this.boardLayer && this.boardMips) {
      const level = mipLevel(devicePerWorld / this.boardLayerScale);
      const mip = this.boardMips.get(level);
      ctx.drawImage(mip.image as CanvasImageSource, 0, 0, this.boardLayer.width * mip.sx, this.boardLayer.height * mip.sy, 0, 0, spec.width, spec.height);
    }
  }

  private getBoardShadow(): HTMLCanvasElement {
    if (this.boardShadow) return this.boardShadow;
    const spec = this.model.spec;
    const scale = 160 / Math.max(spec.width, spec.height);
    const pad = Math.max(spec.width, spec.height) * 0.06 * scale;
    const c = document.createElement('canvas');
    c.width = Math.ceil(spec.width * scale + pad * 2);
    c.height = Math.ceil(spec.height * scale + pad * 2);
    const ctx = c.getContext('2d')!;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = pad * 0.55;
    ctx.shadowOffsetX = 10000;
    ctx.fillStyle = '#000';
    ctx.fillRect(pad - 10000, pad, spec.width * scale, spec.height * scale);
    this.boardShadow = c;
    return c;
  }

  private drawGroups(ctx: CanvasRenderingContext2D, groups: GroupState[], now: number, include: (g: GroupState) => boolean): void {
    const { camera, model, atlas, options } = this;
    const dpr = this.dpr;
    const z = camera.zoom * dpr;
    const view = camera.visibleWorld(0);
    const margin = Math.max(model.pieceWidth, model.pieceHeight) * 0.9;
    const pieceLevel = mipLevel(z / atlas.scale);
    const pieceMips = this.pageMips.map((m) => m.get(pieceLevel));
    const shadowScale = atlas.shadowScale;
    const shadowMips = options.shadows ? this.shadowMips.map((m) => m.get(mipLevel(z / shadowScale, 0.8))) : [];
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    const size = Math.min(model.pieceWidth, model.pieceHeight);

    for (const g of groups) {
      if (g.locked || !include(g)) continue;
      if (options.edgesOnly && g.pieces.length === 1 && !model.isEdgePiece(g.pieces[0]!) && g.id !== this.liftedGroup) continue;
      const lifted = g.id === this.liftedGroup;
      const highlight = this.highlights.get(g.id) ?? (g.id === this.selectedGroup ? this.selectionColor : null);

      const inView = (p: number) => {
        const [cx, cy] = model.pieceCenter(p, g);
        return cx > view.minX - margin && cx < view.maxX + margin && cy > view.minY - margin && cy < view.maxY + margin;
      };
      const visible = g.pieces.length > 40 ? g.pieces.filter(inView) : g.pieces.some(inView) ? g.pieces : [];
      if (visible.length === 0) continue;

      // Group transform: world = R(rot)·solved + (x, y)
      const cos = g.rot === 0 ? 1 : g.rot === 2 ? -1 : 0;
      const sin = g.rot === 1 ? 1 : g.rot === 3 ? -1 : 0;
      ctx.setTransform(z * cos, z * sin, -z * sin, z * cos, (camera.panX + g.x * camera.zoom) * dpr, (camera.panY + g.y * camera.zoom) * dpr);

      if (highlight) {
        const grow = size * 0.035;
        ctx.globalAlpha = 0.95;
        for (const p of visible) {
          const glow = atlas.glow(p, highlight);
          if (!glow) continue;
          const [ox, oy] = this.offsetFor(p, now, g.rot);
          const s = glow.sprite;
          ctx.drawImage(glow.canvas, s.x - grow + ox, s.y - grow + oy, s.w + grow * 2, s.h + grow * 2);
        }
        ctx.globalAlpha = 1;
      }
      if (options.shadows && shadowMips.length) {
        const lift = lifted ? 0.045 : 0.014;
        // Shadows fall down-right on screen regardless of the group's rotation.
        const [sdx, sdy] = unrotate(size * lift, size * lift * 1.6, g.rot);
        ctx.globalAlpha = this.theme.shadowAlpha * (lifted ? 0.75 : 0.55);
        const grow = lifted ? size * 0.04 : 0;
        for (const p of visible) {
          const s = atlas.shadows[p];
          if (!s) continue;
          const mip = shadowMips[s.page]!;
          const [ox, oy] = this.offsetFor(p, now, g.rot);
          ctx.drawImage(
            mip.image as CanvasImageSource,
            s.sx * mip.sx,
            s.sy * mip.sy,
            s.sw * mip.sx,
            s.sh * mip.sy,
            s.x + sdx + ox - grow,
            s.y + sdy + oy - grow,
            s.w + grow * 2,
            s.h + grow * 2,
          );
        }
        ctx.globalAlpha = 1;
      }
      for (const p of visible) {
        const s: Sprite = atlas.sprites[p]!;
        const mip = pieceMips[s.page]!;
        const [ox, oy] = this.offsetFor(p, now, g.rot);
        ctx.drawImage(mip.image as CanvasImageSource, s.sx * mip.sx, s.sy * mip.sy, s.sw * mip.sx, s.sh * mip.sy, s.x + ox, s.y + oy, s.w, s.h);
      }
    }
  }

  /** Completion sheen: a soft light band sweeping across the finished picture. */
  private drawSweep(ctx: CanvasRenderingContext2D, now: number): boolean {
    if (this.completedAt === null) return false;
    const t = (now - this.completedAt) / 1400;
    if (t < 0) return true;
    if (t > 1) return false;
    const spec = this.model.spec;
    const radius = Math.min(spec.width, spec.height) * 0.006;
    this.worldTransform(ctx);
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
    return true;
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
