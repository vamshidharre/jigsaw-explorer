import {
  isValidRoomCode,
  type CreateRoomRequest,
  type NewPuzzleRequest,
  type PuzzleInfo,
  type RoomSummary,
} from '../../shared/protocol';
import { PuzzleModel } from '../../shared/puzzle/model';
import { gridForPieceCount, maxPiecesForImage, MIN_PIECES, type PuzzleSpec } from '../../shared/puzzle/spec';
import { randomSeed } from '../../shared/rng';
import { resolveImage } from '../images/resolveImage';
import type { UploadStore } from '../images/uploadStore';
import type { RoomStore } from '../persistence/roomStore';
import { log } from '../logger';
import { newRoomCode } from '../util/ids';
import { Room, type RoomTimings } from './Room';

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface RoomManagerOptions {
  maxRooms: number;
  roomEmptyTtlMs: number;
  timings?: Partial<RoomTimings>;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly persisting = new Set<string>();

  constructor(
    private readonly uploads: UploadStore,
    private readonly store: RoomStore | null,
    private readonly options: RoomManagerOptions,
  ) {}

  async init(): Promise<void> {
    if (!this.store) return;
    const now = Date.now();
    for (const snap of await this.store.loadAll()) {
      if (now - snap.lastActiveAt > this.options.roomEmptyTtlMs) {
        await this.store.remove(snap.code);
        continue;
      }
      try {
        this.rooms.set(snap.code, Room.fromSnapshot(snap, this.options.timings));
      } catch (err) {
        log.warn('discarding invalid room snapshot', { code: snap.code, err: String(err) });
        await this.store.remove(snap.code);
      }
    }
    if (this.rooms.size) log.info('restored rooms', { count: this.rooms.size });
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return isValidRoomCode(code) ? this.rooms.get(code) : undefined;
  }

  create(req: CreateRoomRequest): Room {
    if (this.rooms.size >= this.options.maxRooms) {
      throw new RoomError('The server is at capacity right now. Please try again in a few minutes.', 503);
    }
    const { puzzle, model } = this.buildPuzzle(req);
    let code = newRoomCode();
    while (this.rooms.has(code)) code = newRoomCode();
    const room = new Room({ code, puzzle, model, capacity: req.capacity, timings: this.options.timings });
    this.rooms.set(code, room);
    log.info('room created', { code, pieces: model.pieceCount, image: puzzle.image.id });
    return room;
  }

  /** Validates a puzzle request and builds a fresh puzzle for it. */
  buildPuzzle(req: NewPuzzleRequest): { puzzle: PuzzleInfo; model: PuzzleModel } {
    const resolved = resolveImage(req.image, this.uploads);
    if (!resolved) {
      throw new RoomError(req.image.kind === 'catalog' ? 'Unknown puzzle image.' : 'That uploaded image has expired. Please upload it again.', 400);
    }
    const { width, height } = resolved;
    const title = resolved.title ?? 'Custom puzzle';
    const pieces = Math.max(MIN_PIECES, Math.min(maxPiecesForImage(width, height), req.pieces));
    const grid = gridForPieceCount(pieces, width, height);
    const spec: PuzzleSpec = { seed: randomSeed(), cols: grid.cols, rows: grid.rows, width, height, rotation: req.rotation };
    const aspect = Math.min(3, Math.max(0.4, req.aspect));
    return { puzzle: { spec, image: req.image, title }, model: PuzzleModel.createInitial(spec, aspect) };
  }

  summary(room: Room): RoomSummary {
    return {
      code: room.code,
      title: room.puzzle.title,
      image: room.puzzle.image,
      pieces: room.model.pieceCount,
      rotation: room.model.spec.rotation,
      players: room.playerCount,
      online: room.onlineCount,
      capacity: room.capacity,
      full: room.playerCount >= room.capacity,
      completed: room.completion !== null,
      progress: room.model.connectedCount() / room.model.pieceCount,
    };
  }

  uploadsInUse(): Set<string> {
    const ids = new Set<string>();
    for (const room of this.rooms.values()) if (room.puzzle.image.kind === 'upload') ids.add(room.puzzle.image.id);
    return ids;
  }

  /** Flushes batched drag/cursor updates for every room. */
  tick(): void {
    for (const room of this.rooms.values()) room.flush();
  }

  /** Runs housekeeping, expires empty rooms and persists changed ones. */
  async sweep(now = Date.now()): Promise<void> {
    for (const room of Array.from(this.rooms.values())) {
      room.sweep(now);
      if (room.onlineCount === 0 && room.emptySince !== null && now - room.emptySince > this.options.roomEmptyTtlMs) {
        this.rooms.delete(room.code);
        await this.store?.remove(room.code);
        log.info('room expired', { code: room.code });
        continue;
      }
      if (room.dirty) await this.persist(room);
    }
  }

  async persist(room: Room): Promise<void> {
    if (!this.store || this.persisting.has(room.code)) return;
    this.persisting.add(room.code);
    room.dirty = false;
    try {
      await this.store.save(room.toSnapshot());
    } catch (err) {
      room.dirty = true;
      log.error('failed to persist room', { code: room.code, err: String(err) });
    } finally {
      this.persisting.delete(room.code);
    }
  }

  async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) {
      room.flush();
      await this.persist(room);
      // 1012 = service restart: clients reconnect automatically.
      room.closeAll(1012, 'server restarting');
    }
  }
}

