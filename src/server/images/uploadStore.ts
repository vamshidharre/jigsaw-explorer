/**
 * Stores user-uploaded puzzle images for multiplayer rooms.
 *
 * Every upload is decoded and re-encoded with sharp, which validates that the
 * bytes really are an image, strips metadata (EXIF/GPS), normalises
 * orientation and caps the resolution. Only the re-encoded WebP is kept.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata, type OutputInfo, type Sharp } from 'sharp';
import { UPLOAD_ID_PATTERN } from '../../shared/protocol';
import { newUploadId } from '../util/ids';
import { log } from '../logger';

export const MAX_UPLOAD_DIMENSION = 2400;
const MIN_DIMENSION = 200;
const MAX_INPUT_PIXELS = 80_000_000;
const MAX_ASPECT = 4;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface UploadMeta {
  id: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export class UploadStore {
  private readonly dir: string;
  private readonly meta = new Map<string, UploadMeta>();

  /** `maxTotalBytes` caps the disk space all stored photos may use together. */
  constructor(
    dataDir: string,
    private readonly maxTotalBytes = Infinity,
  ) {
    this.dir = path.join(dataDir, 'uploads');
  }

  get totalBytes(): number {
    let total = 0;
    for (const m of this.meta.values()) total += m.bytes;
    return total;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const m = JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as UploadMeta;
        if (UPLOAD_ID_PATTERN.test(m.id)) this.meta.set(m.id, m);
      } catch {
        // Ignore corrupt metadata; the cleanup pass removes orphans.
      }
    }
  }

  async save(input: Buffer): Promise<UploadMeta> {
    let pipeline: Sharp;
    let info: Metadata;
    try {
      pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
      info = await pipeline.metadata();
    } catch {
      throw new UploadError('That file is not a supported image.');
    }
    const allowed = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);
    if (!info.format || !allowed.has(info.format)) throw new UploadError('Unsupported image format. Use JPG, PNG, WebP, GIF or AVIF.');
    if (!info.width || !info.height) throw new UploadError('Could not read the image dimensions.');

    let output: { data: Buffer; info: OutputInfo };
    try {
      output = await pipeline
        .rotate()
        .resize({ width: MAX_UPLOAD_DIMENSION, height: MAX_UPLOAD_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .webp({ quality: 86, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new UploadError('The image could not be processed. It may be corrupt.');
    }
    const { width, height } = output.info;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new UploadError(`Images must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`);
    }
    if (Math.max(width / height, height / width) > MAX_ASPECT) {
      throw new UploadError('That image is too narrow. Use an image with an aspect ratio up to 4:1.');
    }

    if (this.totalBytes + output.data.length > this.maxTotalBytes) {
      log.warn('upload storage full', { totalBytes: this.totalBytes });
      throw new UploadError('Photo storage is full right now. Please try again later or pick a picture from the gallery.', 503);
    }

    const meta: UploadMeta = { id: newUploadId(), width, height, bytes: output.data.length, createdAt: Date.now() };
    await writeFile(this.filePath(meta.id), output.data);
    await writeFile(path.join(this.dir, `${meta.id}.json`), JSON.stringify(meta));
    this.meta.set(meta.id, meta);
    log.info('upload stored', { id: meta.id, width, height, bytes: meta.bytes });
    return meta;
  }

  get(id: string): UploadMeta | undefined {
    return UPLOAD_ID_PATTERN.test(id) ? this.meta.get(id) : undefined;
  }

  filePath(id: string): string {
    if (!UPLOAD_ID_PATTERN.test(id)) throw new Error('Invalid upload id');
    return path.join(this.dir, `${id}.webp`);
  }

  /** Deletes uploads older than `ttlMs` that no live room references. */
  async cleanup(ttlMs: number, inUse: ReadonlySet<string>): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const m of this.meta.values()) {
      if (now - m.createdAt < ttlMs || inUse.has(m.id)) continue;
      await rm(this.filePath(m.id), { force: true });
      await rm(path.join(this.dir, `${m.id}.json`), { force: true });
      this.meta.delete(m.id);
      removed++;
    }
    // Remove image files whose metadata is missing.
    for (const file of await readdir(this.dir)) {
      const id = file.replace(/\.(webp|json)$/, '');
      if (!this.meta.has(id)) {
        const full = path.join(this.dir, file);
        const s = await stat(full).catch(() => null);
        if (s && now - s.mtimeMs > 60_000) await rm(full, { force: true });
      }
    }
    return removed;
  }
}
