/**
 * Single-player games are saved in IndexedDB so refreshing the page or coming
 * back later continues exactly where the player left off. Custom images are
 * stored alongside as blobs and never uploaded anywhere.
 */
import { createStore, del, get, set, values, type UseStore } from 'idb-keyval';
import { fromWire, toWire, type ShareChallenge, type WireGroup } from '../../shared/protocol';
import type { GroupState } from '../../shared/puzzle/model';
import type { PuzzleSpec } from '../../shared/puzzle/spec';

export type SavedImage =
  | { kind: 'catalog'; id: string }
  | { kind: 'local'; key: string; thumbnail: string };

export interface SavedGame {
  version: 1;
  id: string;
  title: string;
  image: SavedImage;
  spec: PuzzleSpec;
  groups: WireGroup[];
  elapsedMs: number;
  moves: number;
  connected: number;
  total: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** Set for the daily puzzle: its date key. */
  daily?: string;
  /** Set when the puzzle came from a share link. */
  share?: { id: string; from: string | null; challenge: ShareChallenge | null };
}

const MAX_SAVED = 24;

let gamesStore: UseStore | null = null;
let imagesStore: UseStore | null = null;
let available: boolean | null = null;

function stores(): { games: UseStore; images: UseStore } | null {
  if (available === false) return null;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    gamesStore ??= createStore('jigsaw-games', 'games');
    imagesStore ??= createStore('jigsaw-images', 'images');
    available = true;
    return { games: gamesStore, images: imagesStore };
  } catch {
    available = false;
    return null;
  }
}

// In-memory fallback when IndexedDB is unavailable, so the current session still works.
const memoryGames = new Map<string, SavedGame>();
const memoryImages = new Map<string, Blob>();

export function newGameId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveGame(game: SavedGame): Promise<void> {
  const s = stores();
  memoryGames.set(game.id, game);
  if (!s) return;
  try {
    await set(game.id, game, s.games);
  } catch {
    available = false;
  }
}

export async function loadGame(id: string): Promise<SavedGame | null> {
  const s = stores();
  if (s) {
    try {
      const g = await get<SavedGame>(id, s.games);
      if (g && g.version === 1) return g;
    } catch {
      // fall through to memory
    }
  }
  return memoryGames.get(id) ?? null;
}

export async function listGames(): Promise<SavedGame[]> {
  const s = stores();
  let all: SavedGame[] = Array.from(memoryGames.values());
  if (s) {
    try {
      all = (await values<SavedGame>(s.games)).filter((g) => g && g.version === 1);
    } catch {
      // keep memory list
    }
  }
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteGame(id: string): Promise<void> {
  const s = stores();
  const game = await loadGame(id);
  memoryGames.delete(id);
  if (s) {
    try {
      await del(id, s.games);
    } catch {
      // ignore
    }
  }
  if (game?.image.kind === 'local') await releaseImage(game.image.key);
}

/** Removes the oldest games beyond the limit (completed ones first). */
export async function pruneGames(): Promise<void> {
  const all = await listGames();
  if (all.length <= MAX_SAVED) return;
  const victims = [...all]
    .sort((a, b) => Number(b.completedAt !== null) - Number(a.completedAt !== null) || a.updatedAt - b.updatedAt)
    .slice(0, all.length - MAX_SAVED);
  for (const g of victims) await deleteGame(g.id);
}

export async function saveImage(key: string, blob: Blob): Promise<void> {
  memoryImages.set(key, blob);
  const s = stores();
  if (!s) return;
  try {
    await set(key, blob, s.images);
  } catch {
    // Quota exceeded or blocked: the memory copy still works for this session.
  }
}

export async function loadImageBlob(key: string): Promise<Blob | null> {
  const s = stores();
  if (s) {
    try {
      const b = await get<Blob>(key, s.images);
      if (b) return b;
    } catch {
      // fall through
    }
  }
  return memoryImages.get(key) ?? null;
}

async function releaseImage(key: string): Promise<void> {
  const stillUsed = (await listGames()).some((g) => g.image.kind === 'local' && g.image.key === key);
  if (stillUsed) return;
  memoryImages.delete(key);
  const s = stores();
  if (s) await del(key, s.images).catch(() => undefined);
}

export function groupsToWire(groups: GroupState[]): WireGroup[] {
  return groups.map(toWire);
}

export function groupsFromWire(groups: WireGroup[]): GroupState[] {
  return groups.map(fromWire);
}

// ---------------------------------------------------------------------------
// Personal best times

const BESTS_KEY = 'jigsaw.bests.v1';

function bestKey(image: SavedImage, pieces: number, rotation: boolean): string | null {
  // Local photos have no stable identity across devices; only catalogue puzzles keep records.
  if (image.kind !== 'catalog') return null;
  return `${image.id}|${pieces}|${rotation ? 1 : 0}`;
}

export function getBestTime(image: SavedImage, pieces: number, rotation: boolean): number | null {
  const key = bestKey(image, pieces, rotation);
  if (!key) return null;
  try {
    const all = JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}') as Record<string, number>;
    return typeof all[key] === 'number' ? all[key] : null;
  } catch {
    return null;
  }
}

/** Records a completion time and returns the previous best (null if none). */
export function recordTime(image: SavedImage, pieces: number, rotation: boolean, ms: number): { previous: number | null; isBest: boolean } {
  const key = bestKey(image, pieces, rotation);
  if (!key) return { previous: null, isBest: false };
  try {
    const all = JSON.parse(localStorage.getItem(BESTS_KEY) ?? '{}') as Record<string, number>;
    const previous = typeof all[key] === 'number' ? all[key] : null;
    const isBest = previous === null || ms < previous;
    if (isBest) {
      all[key] = ms;
      localStorage.setItem(BESTS_KEY, JSON.stringify(all));
    }
    return { previous, isBest };
  } catch {
    return { previous: null, isBest: false };
  }
}
