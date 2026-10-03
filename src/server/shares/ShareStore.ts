/**
 * Share links: a picture, cut and settings that someone sends to a friend.
 *
 * Each share is a small JSON file (written atomically) and kept in memory.
 * Shares expire after a fixed time; while a share is alive the uploaded photo
 * it points to is kept too.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SHARE_ID_PATTERN, type ShareInfo } from '../../shared/protocol';
import { log } from '../logger';
import { newShareId } from '../util/ids';

export interface ShareRecord extends ShareInfo {
  version: 1;
}

export interface ShareStoreOptions {
  ttlMs: number;
  maxShares: number;
}

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ShareStore {
  private readonly dir: string;
  private readonly shares = new Map<string, ShareRecord>();

  constructor(
    dataDir: string,
    private readonly options: ShareStoreOptions,
  ) {
    this.dir = path.join(dataDir, 'shares');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const now = Date.now();
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (!SHARE_ID_PATTERN.test(id)) continue;
      try {
        const record = JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as ShareRecord;
        if (record.version !== 1 || record.id !== id) continue;
        if (record.expiresAt <= now) await this.removeFile(id);
        else this.shares.set(id, record);
      } catch (err) {
        log.warn('skipping unreadable share', { file, err: String(err) });
      }
    }
  }

  get size(): number {
    return this.shares.size;
  }

  get(id: string, now = Date.now()): ShareRecord | undefined {
    if (!SHARE_ID_PATTERN.test(id)) return undefined;
    const record = this.shares.get(id);
    return record && record.expiresAt > now ? record : undefined;
  }

  async create(input: Omit<ShareInfo, 'id' | 'createdAt' | 'expiresAt'>, now = Date.now()): Promise<ShareRecord> {
    if (this.shares.size >= this.options.maxShares) await this.sweep(now);
    if (this.shares.size >= this.options.maxShares) {
      throw new ShareError('Too many puzzles are being shared right now. Please try again later.', 503);
    }
    let id = newShareId();
    while (this.shares.has(id)) id = newShareId();
    const record: ShareRecord = { version: 1, ...input, id, createdAt: now, expiresAt: now + this.options.ttlMs };
    const file = path.join(this.dir, `${id}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(record));
    await rename(`${file}.tmp`, file);
    this.shares.set(id, record);
    log.info('share created', { id, image: record.image.id, challenge: record.challenge !== null });
    return record;
  }

  /** Deletes expired shares; returns how many were removed. */
  async sweep(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const record of Array.from(this.shares.values())) {
      if (record.expiresAt > now) continue;
      this.shares.delete(record.id);
      await this.removeFile(record.id);
      removed++;
    }
    return removed;
  }

  uploadsInUse(now = Date.now()): Set<string> {
    const ids = new Set<string>();
    for (const record of this.shares.values()) {
      if (record.image.kind === 'upload' && record.expiresAt > now) ids.add(record.image.id);
    }
    return ids;
  }

  private async removeFile(id: string): Promise<void> {
    await rm(path.join(this.dir, `${id}.json`), { force: true });
  }
}
