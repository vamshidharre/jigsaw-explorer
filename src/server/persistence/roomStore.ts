/**
 * Persists room snapshots to disk so rooms survive a server restart or deploy.
 * Writes go to a temp file first and are renamed into place atomically.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidRoomCode } from '../../shared/protocol';
import type { RoomSnapshot } from '../rooms/Room';
import { log } from '../logger';

export class RoomStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'rooms');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async loadAll(): Promise<RoomSnapshot[]> {
    const out: RoomSnapshot[] = [];
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const code = file.slice(0, -5);
      if (!isValidRoomCode(code)) continue;
      try {
        const snap = JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as RoomSnapshot;
        if (snap.version === 1 && snap.code === code) out.push(snap);
      } catch (err) {
        log.warn('skipping unreadable room snapshot', { file, err: String(err) });
      }
    }
    return out;
  }

  async save(snapshot: RoomSnapshot): Promise<void> {
    const file = path.join(this.dir, `${snapshot.code}.json`);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot));
    await rename(tmp, file);
  }

  async remove(code: string): Promise<void> {
    if (!isValidRoomCode(code)) return;
    await rm(path.join(this.dir, `${code}.json`), { force: true });
  }
}
