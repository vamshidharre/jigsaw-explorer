/**
 * Pre-renders every piece into texture atlas pages once, so drawing a frame
 * is just a series of cheap drawImage calls. Each piece gets:
 *  - a sprite: the image clipped to the piece outline, with optional bevel
 *    shading and outline baked in;
 *  - a soft, low-resolution shadow sprite in the piece's shape.
 */
import type { PuzzleSpec } from '../../shared/puzzle/spec';
import type { PieceOutline, PuzzleShapes } from '../../shared/puzzle/shapes';

export type OutlineStyle = 'none' | 'subtle' | 'bold';

export interface PieceStyle {
  outline: OutlineStyle;
  bevel: boolean;
}

export interface Sprite {
  page: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Placement in solved (world) space. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAGE_SIZE = 2048;
const PAD = 3;

type Canvas = HTMLCanvasElement;
/** Atlas pages start as canvases and are frozen into ImageBitmaps, which draw several times faster. */
export type Texture = HTMLCanvasElement | ImageBitmap;

async function freeze(textures: Texture[]): Promise<Texture[]> {
  if (typeof createImageBitmap !== 'function') return textures;
  return Promise.all(
    textures.map(async (t) => {
      if (!(t instanceof HTMLCanvasElement)) return t;
      try {
        const bmp = await createImageBitmap(t);
        t.width = 0;
        t.height = 0;
        return bmp;
      } catch {
        return t;
      }
    }),
  );
}

function release(t: Texture): void {
  if (t instanceof HTMLCanvasElement) {
    // Shrinking canvases releases their backing memory promptly on all browsers.
    t.width = 0;
    t.height = 0;
  } else {
    t.close();
  }
}

function createCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function outlineToPath2D(o: PieceOutline): Path2D {
  const p = new Path2D();
  p.moveTo(o.start.x, o.start.y);
  const k = o.cubics;
  for (let i = 0; i < k.length; i += 6) p.bezierCurveTo(k[i]!, k[i + 1]!, k[i + 2]!, k[i + 3]!, k[i + 4]!, k[i + 5]!);
  p.closePath();
  return p;
}

interface Slot {
  page: number;
  x: number;
  y: number;
}

/** Simple shelf packer over fixed-size pages. */
class ShelfPacker {
  page = 0;
  x = 0;
  y = 0;
  shelfH = 0;
  pages = 0;

  add(w: number, h: number): Slot {
    if (this.pages === 0) this.pages = 1;
    if (this.x + w > PAGE_SIZE) {
      this.x = 0;
      this.y += this.shelfH;
      this.shelfH = 0;
    }
    if (this.y + h > PAGE_SIZE) {
      this.page++;
      this.pages++;
      this.x = 0;
      this.y = 0;
      this.shelfH = 0;
    }
    const slot = { page: this.page, x: this.x, y: this.y };
    this.x += w;
    this.shelfH = Math.max(this.shelfH, h);
    return slot;
  }
}

export interface AtlasBuildOptions {
  image: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  spec: PuzzleSpec;
  shapes: PuzzleShapes;
  style: PieceStyle;
  /** Upper bound on total sprite pixels, to respect device memory. */
  pixelBudget: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class PieceAtlas {
  readonly paths: Path2D[];
  readonly sprites: Sprite[] = [];
  readonly shadows: Sprite[] = [];
  pages: Texture[] = [];
  shadowPages: Texture[] = [];
  /** Atlas pixels per world unit. */
  scale = 1;
  /** Shadow atlas pixels per world unit. */
  shadowScale = 0.5;
  private readonly glowCache = new Map<string, Canvas>();

  private constructor(
    private readonly opts: AtlasBuildOptions,
    readonly style: PieceStyle,
  ) {
    this.paths = opts.shapes.outlines.map(outlineToPath2D);
  }

  static async build(opts: AtlasBuildOptions): Promise<PieceAtlas> {
    const atlas = new PieceAtlas(opts, opts.style);
    await atlas.render(opts.style, true);
    return atlas;
  }

  /** Re-renders sprites with a new style, reusing the existing shadows. */
  async restyle(style: PieceStyle): Promise<PieceAtlas> {
    const next = new PieceAtlas({ ...this.opts, style }, style);
    next.shadows.push(...this.shadows);
    next.shadowPages = this.shadowPages;
    next.shadowScale = this.shadowScale;
    await next.render(style, false);
    return next;
  }

  private async render(style: PieceStyle, withShadows: boolean): Promise<void> {
    const { spec, shapes, image, imageWidth, imageHeight, onProgress, signal } = this.opts;
    const pw = shapes.pieceWidth;
    const ph = shapes.pieceHeight;
    const n = shapes.outlines.length;

    // Choose a resolution: never above the source image, and within budget.
    const imageScale = imageWidth / spec.width;
    let area = 0;
    for (const o of shapes.outlines) area += (o.bounds.maxX - o.bounds.minX) * (o.bounds.maxY - o.bounds.minY);
    const budgetScale = Math.sqrt(this.opts.pixelBudget / Math.max(1, area));
    this.scale = Math.max(0.05, Math.min(imageScale, budgetScale));
    const scale = this.scale;
    const pieceSize = Math.min(pw, ph);
    const imgRatioX = imageWidth / spec.width;
    const imgRatioY = imageHeight / spec.height;

    const packer = new ShelfPacker();
    const slots: Slot[] = [];
    const sizes: Array<[number, number]> = [];
    for (const o of shapes.outlines) {
      const w = Math.ceil((o.bounds.maxX - o.bounds.minX) * scale) + PAD * 2;
      const h = Math.ceil((o.bounds.maxY - o.bounds.minY) * scale) + PAD * 2;
      sizes.push([w, h]);
      slots.push(packer.add(w, h));
    }
    const lastPageH = packer.y + packer.shelfH;
    this.pages = Array.from({ length: packer.pages }, (_, i) =>
      createCanvas(PAGE_SIZE, i === packer.pages - 1 ? Math.max(1, lastPageH) : PAGE_SIZE),
    );
    const ctxs = (this.pages as Canvas[]).map((p) => p.getContext('2d')!);

    // Shadow atlas at lower resolution; blur hides the lower detail.
    this.shadowScale = withShadows ? Math.max(0.05, Math.min(scale * 0.5, 96 / pieceSize)) : this.shadowScale;
    const sScale = this.shadowScale;
    const blurPx = Math.max(2, pieceSize * 0.07 * sScale);
    const sPad = Math.ceil(blurPx * 2.2) + 2;
    const shadowPacker = new ShelfPacker();
    const shadowSlots: Slot[] = [];
    const shadowSizes: Array<[number, number]> = [];
    let shadowCtxs: CanvasRenderingContext2D[] = [];
    if (withShadows) {
      for (const o of shapes.outlines) {
        const w = Math.ceil((o.bounds.maxX - o.bounds.minX) * sScale) + sPad * 2;
        const h = Math.ceil((o.bounds.maxY - o.bounds.minY) * sScale) + sPad * 2;
        shadowSizes.push([w, h]);
        shadowSlots.push(shadowPacker.add(w, h));
      }
      const lastH = shadowPacker.y + shadowPacker.shelfH;
      this.shadowPages = Array.from({ length: shadowPacker.pages }, (_, i) =>
        createCanvas(PAGE_SIZE, i === shadowPacker.pages - 1 ? Math.max(1, lastH) : PAGE_SIZE),
      );
      shadowCtxs = (this.shadowPages as Canvas[]).map((p) => p.getContext('2d')!);
    }

    const bevelWidth = Math.max(1.2, pieceSize * scale * 0.028);
    const outlineAlpha = style.outline === 'bold' ? 0.75 : 0.32;
    const outlineWidth = style.outline === 'bold' ? Math.max(1.4, pieceSize * scale * 0.018) : Math.max(0.8, pieceSize * scale * 0.008);

    let lastYield = performance.now();
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const o = shapes.outlines[i]!;
      const b = o.bounds;
      const c = i % spec.cols;
      const r = Math.floor(i / spec.cols);
      const slot = slots[i]!;
      const [w, h] = sizes[i]!;
      const ctx = ctxs[slot.page]!;
      const path = this.paths[i]!;

      ctx.save();
      ctx.translate(slot.x + PAD, slot.y + PAD);
      ctx.scale(scale, scale);
      ctx.translate(-b.minX, -b.minY);
      ctx.save();
      ctx.clip(path);
      // Source rectangle (image pixels) covering the sprite bounds, clamped to the image.
      const wx0 = Math.max(0, c * pw + b.minX);
      const wy0 = Math.max(0, r * ph + b.minY);
      const wx1 = Math.min(spec.width, c * pw + b.maxX);
      const wy1 = Math.min(spec.height, r * ph + b.maxY);
      if (wx1 > wx0 && wy1 > wy0) {
        ctx.drawImage(
          image,
          wx0 * imgRatioX,
          wy0 * imgRatioY,
          (wx1 - wx0) * imgRatioX,
          (wy1 - wy0) * imgRatioY,
          wx0 - c * pw,
          wy0 - r * ph,
          wx1 - wx0,
          wy1 - wy0,
        );
      }
      if (style.bevel) {
        // Emboss inside the clip: a stroke shifted down-right leaves a light band only along the
        // top-left edges; one shifted up-left leaves a dark band only along the bottom-right edges.
        const d = bevelWidth / scale / 2;
        ctx.lineWidth = d * 2;
        ctx.lineJoin = 'round';
        ctx.translate(d, d);
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.stroke(path);
        ctx.translate(-2 * d, -2 * d);
        ctx.strokeStyle = 'rgba(0,0,0,0.26)';
        ctx.stroke(path);
      }
      ctx.restore();
      if (style.outline !== 'none') {
        ctx.lineWidth = outlineWidth / scale;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = `rgba(0,0,0,${outlineAlpha})`;
        ctx.stroke(path);
      }
      ctx.restore();

      this.sprites[i] = {
        page: slot.page,
        sx: slot.x,
        sy: slot.y,
        sw: w,
        sh: h,
        x: c * pw + b.minX - PAD / scale,
        y: r * ph + b.minY - PAD / scale,
        w: w / scale,
        h: h / scale,
      };

      if (withShadows) {
        const ss = shadowSlots[i]!;
        const [sw, sh] = shadowSizes[i]!;
        const sctx = shadowCtxs[ss.page]!;
        // Draw the silhouette far off-canvas and let only its blurred shadow land in the slot.
        const OFF = 20000;
        sctx.save();
        sctx.beginPath();
        sctx.rect(ss.x, ss.y, sw, sh);
        sctx.clip();
        sctx.shadowColor = 'rgba(0,0,0,1)';
        sctx.shadowBlur = blurPx;
        sctx.shadowOffsetX = OFF;
        sctx.translate(ss.x + sPad - OFF, ss.y + sPad);
        sctx.scale(sScale, sScale);
        sctx.translate(-b.minX, -b.minY);
        sctx.fillStyle = '#000';
        sctx.fill(path);
        sctx.restore();
        this.shadows[i] = {
          page: ss.page,
          sx: ss.x,
          sy: ss.y,
          sw,
          sh,
          x: c * pw + b.minX - sPad / sScale,
          y: r * ph + b.minY - sPad / sScale,
          w: sw / sScale,
          h: sh / sScale,
        };
      }

      const now = performance.now();
      if (now - lastYield > 14) {
        onProgress?.((i + 1) / n);
        await new Promise((res) => setTimeout(res, 0));
        lastYield = performance.now();
      }
    }
    this.pages = await freeze(this.pages);
    if (withShadows) this.shadowPages = await freeze(this.shadowPages);
    onProgress?.(1);
  }

  /** A coloured glow in the shape of a piece, used to highlight selections. */
  glow(piece: number, color: string): { canvas: Canvas; sprite: Sprite } | null {
    const sprite = this.shadows[piece];
    if (!sprite) return null;
    const key = `${piece}|${color}`;
    let canvas = this.glowCache.get(key);
    if (!canvas) {
      if (this.glowCache.size > 3000) this.glowCache.clear();
      canvas = createCanvas(sprite.sw, sprite.sh);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(this.shadowPages[sprite.page]!, sprite.sx, sprite.sy, sprite.sw, sprite.sh, 0, 0, sprite.sw, sprite.sh);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, sprite.sw, sprite.sh);
      this.glowCache.set(key, canvas);
    }
    return { canvas, sprite: { ...sprite, page: -1, sx: 0, sy: 0 } };
  }

  dispose(): void {
    for (const p of this.pages) release(p);
    this.pages = [];
    this.glowCache.clear();
  }

  disposeShadows(): void {
    for (const p of this.shadowPages) release(p);
    this.shadowPages = [];
  }
}
