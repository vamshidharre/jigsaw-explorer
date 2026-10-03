/**
 * Link-preview images (1200×630 JPEG): the puzzle picture with jigsaw cuts
 * drawn over it, one piece lifted out, and the logo. No text, so nothing
 * depends on fonts being installed on the server.
 */
import sharp from 'sharp';
import { generateShapes, outlineToSvgPath } from '../../shared/puzzle/shapes';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLS = 8;
const ROWS = 4;
const LIFTED = { col: 5, row: 1 };
const LOGO_PATH =
  'M18 16h10.5c-.9-1.2-1.4-2.4-1.4-3.8 0-3.2 2.4-5.2 5-5.2s5 2 5 5.2c0 1.4-.5 2.6-1.4 3.8H46v10.5c1.2-.9 2.4-1.4 3.8-1.4 3.2 0 5.2 2.4 5.2 5s-2 5-5.2 5c-1.4 0-2.6-.5-3.8-1.4V48H18z';

export interface OgImageOptions {
  /** Blur the picture (gift links keep the photo a surprise). */
  veiled?: boolean;
}

export async function renderOgImage(source: string | Buffer, options: OgImageOptions = {}): Promise<Buffer> {
  let base = sharp(source, { limitInputPixels: 80_000_000 })
    .rotate()
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: sharp.strategy.attention });
  if (options.veiled) base = base.blur(28).modulate({ saturation: 1.15 });
  const photo = await base.jpeg({ quality: 88 }).toBuffer();
  const href = `data:image/jpeg;base64,${photo.toString('base64')}`;

  const shapes = generateShapes({ seed: 20261003, cols: COLS, rows: ROWS, width: OG_WIDTH, height: OG_HEIGHT });
  const pw = shapes.pieceWidth;
  const ph = shapes.pieceHeight;
  const cuts = shapes.outlines.map((o, i) => outlineToSvgPath(o, (i % COLS) * pw, Math.floor(i / COLS) * ph, 1)).join('');
  const liftedIndex = LIFTED.row * COLS + LIFTED.col;
  const lifted = outlineToSvgPath(shapes.outlines[liftedIndex]!, LIFTED.col * pw, LIFTED.row * ph, 1);
  const cx = (LIFTED.col + 0.5) * pw;
  const cy = (LIFTED.row + 0.5) * ph;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <clipPath id="piece"><path d="${lifted}"/></clipPath>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dx="10" dy="18" result="blur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
      <feOffset dy="4"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <image width="${OG_WIDTH}" height="${OG_HEIGHT}" href="${href}" xlink:href="${href}"/>
  <g fill="none" stroke-linejoin="round">
    <path d="${cuts}" stroke="#000" stroke-opacity="0.22" stroke-width="3" transform="translate(0 1.5)"/>
    <path d="${cuts}" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/>
  </g>
  <path d="${lifted}" fill="#0b0c0e" fill-opacity="0.62"/>
  <g transform="translate(46 -58) rotate(8 ${cx} ${cy})" filter="url(#shadow)">
    <g clip-path="url(#piece)"><image width="${OG_WIDTH}" height="${OG_HEIGHT}" href="${href}" xlink:href="${href}"/></g>
    <path d="${lifted}" fill="none" stroke="#fff" stroke-opacity="0.7" stroke-width="2.5"/>
  </g>
  <g transform="translate(40 ${OG_HEIGHT - 40 - 84})" filter="url(#soft)">
    <rect width="84" height="84" rx="20" fill="#0e7a6d"/>
    <g transform="translate(42 42) scale(1.02) translate(-36.5 -27.5)"><path d="${LOGO_PATH}" fill="#fff"/></g>
  </g>
</svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

/** Small LRU cache with in-flight de-duplication, so a burst of crawler hits renders an image once. */
export class OgImageCache {
  private readonly entries = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();

  constructor(private readonly max = 64) {}

  async get(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    let job = this.pending.get(key);
    if (!job) {
      job = render().finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    const buf = await job;
    this.entries.set(key, buf);
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return buf;
  }
}
