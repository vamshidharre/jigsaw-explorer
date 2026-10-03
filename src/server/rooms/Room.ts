/**
 * A multiplayer room. Owns the authoritative puzzle state and arbitrates
 * every change to it:
 *
 *  - A group can only be held (dragged) by one player at a time.
 *  - Only the holder may move or drop a group; drops are resolved on the
 *    server with the shared snapping logic, so every client converges on the
 *    same result.
 *  - Transient data (live drag positions, cursors) is batched into ticks;
 *    authoritative changes are broadcast immediately and in order.
 */
import {
  DEFAULT_ROOM_CAPACITY,
  MAX_ROOM_CAPACITY,
  MIN_ROOM_CAPACITY,
  PROTOCOL_VERSION,
  sanitizeName,
  toWire,
  type ClientMessage,
  type ClockInfo,
  type CompletionInfo,
  type ErrorCode,
  type PlayerInfo,
  type PuzzleInfo,
  type RoomEvent,
  type RoomInfo,
  type ServerMessage,
} from '../../shared/protocol';
import { PuzzleModel, type GroupState, type Rot } from '../../shared/puzzle/model';
import { newPlayerId, newSecret, safeEqual } from '../util/ids';

export interface Connection {
  readonly id: number;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
}

interface PlayerRecord {
  id: string;
  token: string;
  name: string;
  color: string;
  joinedAt: number;
  lastInputAt: number;
  disconnectedAt: number | null;
  placed: number;
  conn: Connection | null;
  idle: boolean;
}

interface Hold {
  playerId: string;
  since: number;
  lastMoveAt: number;
}

export interface RoomSnapshot {
  version: 1;
  code: string;
  createdAt: number;
  lastActiveAt: number;
  capacity: number;
  hostId: string | null;
  hostKey: string;
  puzzle: PuzzleInfo;
  groups: GroupState[];
  players: Array<Omit<PlayerRecord, 'conn' | 'idle'>>;
  elapsedMs: number;
  completion: CompletionInfo | null;
}

export interface RoomTimings {
  reconnectGraceMs: number;
  idleAfterMs: number;
  holdTimeoutMs: number;
}

export const PLAYER_COLORS = [
  '#e5484d',
  '#0091ff',
  '#30a46c',
  '#f76b15',
  '#8e4ec6',
  '#d6409f',
  '#12a594',
  '#d99a00',
  '#3e63dd',
  '#a07553',
  '#5bb98b',
  '#e54666',
];

const DEFAULT_TIMINGS: RoomTimings = { reconnectGraceMs: 60_000, idleAfterMs: 90_000, holdTimeoutMs: 30_000 };

export type JoinResult = { ok: true; playerId: string; resumed: boolean } | { ok: false; code: ErrorCode; message: string };

export type HelloMessage = Extract<ClientMessage, { t: 'hello' }>;

export type PuzzleFactory = (request: Extract<ClientMessage, { t: 'newPuzzle' }>['puzzle']) => {
  puzzle: PuzzleInfo;
  model: PuzzleModel;
};

export class Room {
  readonly code: string;
  readonly createdAt: number;
  readonly hostKey: string;
  capacity: number;
  hostId: string | null = null;
  puzzle: PuzzleInfo;
  model: PuzzleModel;
  completion: CompletionInfo | null = null;
  lastActiveAt: number;
  /** Set when the last connected player left; used for expiry. */
  emptySince: number | null;
  dirty = true;

  private readonly players = new Map<string, PlayerRecord>();
  private readonly held = new Map<number, Hold>();
  private readonly pendingMoves = new Map<number, [number, number, number, Rot]>();
  private readonly pendingCursors = new Map<string, [number, number] | null>();
  private clockAccumulated = 0;
  private clockSince: number | null = null;
  private lastScatterAt = 0;
  private readonly timings: RoomTimings;

  constructor(opts: {
    code: string;
    puzzle: PuzzleInfo;
    model: PuzzleModel;
    capacity?: number;
    timings?: Partial<RoomTimings>;
    now?: number;
  }) {
    const now = opts.now ?? Date.now();
    this.code = opts.code;
    this.createdAt = now;
    this.lastActiveAt = now;
    this.emptySince = now;
    this.hostKey = newSecret();
    this.capacity = clampCapacity(opts.capacity ?? DEFAULT_ROOM_CAPACITY);
    this.puzzle = opts.puzzle;
    this.model = opts.model;
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
  }

  static fromSnapshot(s: RoomSnapshot, timings?: Partial<RoomTimings>): Room {
    const model = new PuzzleModel(s.puzzle.spec, s.groups);
    const room = new Room({ code: s.code, puzzle: s.puzzle, model, capacity: s.capacity, timings, now: s.createdAt });
    Object.assign(room, { createdAt: s.createdAt, hostKey: s.hostKey });
    room.lastActiveAt = s.lastActiveAt;
    room.emptySince = Date.now();
    room.hostId = s.hostId;
    room.clockAccumulated = s.elapsedMs;
    room.completion = s.completion;
    const now = Date.now();
    for (const p of s.players) {
      // Everyone starts disconnected after a restart and gets the usual grace period.
      room.players.set(p.id, { ...p, conn: null, idle: false, disconnectedAt: now });
    }
    room.dirty = false;
    return room;
  }

  toSnapshot(): RoomSnapshot {
    return {
      version: 1,
      code: this.code,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      capacity: this.capacity,
      hostId: this.hostId,
      hostKey: this.hostKey,
      puzzle: this.puzzle,
      groups: this.model.snapshot(),
      players: Array.from(this.players.values(), ({ conn: _conn, idle: _idle, ...rest }) => rest),
      elapsedMs: this.elapsedMs(),
      completion: this.completion,
    };
  }

  // -------------------------------------------------------------------------
  // Queries

  get playerCount(): number {
    return this.players.size;
  }

  get onlineCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }

  roomInfo(): RoomInfo {
    return { code: this.code, hostId: this.hostId, capacity: this.capacity, createdAt: this.createdAt };
  }

  clockInfo(): ClockInfo {
    return { elapsedMs: this.elapsedMs(), running: this.clockSince !== null };
  }

  elapsedMs(now = Date.now()): number {
    return this.clockAccumulated + (this.clockSince !== null ? now - this.clockSince : 0);
  }

  playerList(): PlayerInfo[] {
    return Array.from(this.players.values())
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.id === this.hostId,
        online: p.conn !== null,
        idle: p.idle,
        joinedAt: p.joinedAt,
        placed: p.placed,
      }));
  }

  hasPlayerConnection(conn: Connection): boolean {
    for (const p of this.players.values()) if (p.conn === conn) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  join(conn: Connection, hello: HelloMessage, now = Date.now()): JoinResult {
    const name = sanitizeName(hello.name) || 'Guest';
    let player: PlayerRecord | undefined;
    let resumed = false;

    if (hello.resume) {
      const existing = this.players.get(hello.resume.playerId);
      if (existing && safeEqual(existing.token, hello.resume.token)) {
        player = existing;
        resumed = true;
        if (existing.conn && existing.conn !== conn) {
          existing.conn.send({ t: 'error', code: 'REPLACED', message: 'This seat was opened in another tab.', fatal: true });
          existing.conn.close(4001, 'replaced');
        }
      }
    }

    if (!player) {
      if (this.players.size >= this.capacity) {
        return { ok: false, code: 'ROOM_FULL', message: `This room is full (${this.capacity} players).` };
      }
      player = {
        id: newPlayerId(),
        token: newSecret(),
        name,
        color: this.pickColor(),
        joinedAt: now,
        lastInputAt: now,
        disconnectedAt: null,
        placed: 0,
        conn: null,
        idle: false,
      };
      this.players.set(player.id, player);
    }

    const wasOffline = resumed && player.conn === null;
    player.conn = conn;
    player.disconnectedAt = null;
    player.lastInputAt = now;
    player.idle = false;
    if (resumed && sanitizeName(hello.name)) player.name = name;

    let hostChanged = false;
    if (hello.hostKey && safeEqual(hello.hostKey, this.hostKey) && this.hostId !== player.id) {
      this.hostId = player.id;
      hostChanged = true;
    } else if (!this.hostId || !this.players.has(this.hostId)) {
      this.hostId = player.id;
      hostChanged = true;
    }

    this.emptySince = null;
    this.touch(now);
    // The joining player learns the clock from the welcome; everyone else gets a clock update.
    this.updateClock(now, player.id);

    conn.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: { id: player.id, token: player.token, color: player.color },
      room: this.roomInfo(),
      puzzle: this.puzzle,
      groups: this.model.snapshot().map(toWire),
      held: Array.from(this.held, ([g, h]) => [g, h.playerId] as [number, string]),
      players: this.playerList(),
      clock: this.clockInfo(),
      completion: this.completion,
    });

    const event: RoomEvent = resumed
      ? { kind: 'rejoined', playerId: player.id, name: player.name }
      : { kind: 'joined', playerId: player.id, name: player.name };
    if (!resumed || wasOffline) this.broadcast({ t: 'event', event }, player.id);
    this.broadcastPlayers();
    if (hostChanged) this.broadcast({ t: 'room', room: this.roomInfo() });
    return { ok: true, playerId: player.id, resumed };
  }

  /** Called when a player's socket closes without an explicit leave. */
  disconnect(conn: Connection, now = Date.now()): void {
    const player = this.findByConn(conn);
    if (!player) return;
    player.conn = null;
    player.disconnectedAt = now;
    this.releaseAllHolds(player.id);
    this.pendingCursors.set(player.id, null);
    this.broadcast({ t: 'event', event: { kind: 'disconnected', playerId: player.id, name: player.name } });
    this.broadcastPlayers();
    if (this.onlineCount === 0) this.emptySince = now;
    this.updateClock(now);
    this.dirty = true;
  }

  removePlayer(playerId: string, now = Date.now()): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.releaseAllHolds(playerId);
    this.players.delete(playerId);
    this.pendingCursors.set(playerId, null);
    this.broadcast({ t: 'event', event: { kind: 'left', playerId, name: player.name } });
    if (this.hostId === playerId) this.migrateHost();
    this.broadcastPlayers();
    if (this.onlineCount === 0 && this.emptySince === null) this.emptySince = now;
    this.updateClock(now);
    this.dirty = true;
  }

  /** Periodic housekeeping: reconnect grace, stale holds and idle status. */
  sweep(now = Date.now()): void {
    let playersChanged = false;
    for (const p of Array.from(this.players.values())) {
      if (!p.conn && p.disconnectedAt !== null && now - p.disconnectedAt > this.timings.reconnectGraceMs) {
        this.removePlayer(p.id, now);
        continue;
      }
      const idle = p.conn !== null && now - p.lastInputAt > this.timings.idleAfterMs;
      if (idle !== p.idle) {
        p.idle = idle;
        playersChanged = true;
      }
    }
    for (const [g, hold] of Array.from(this.held)) {
      if (now - hold.lastMoveAt > this.timings.holdTimeoutMs) this.releaseHold(g, hold.playerId);
    }
    if (playersChanged) this.broadcastPlayers();
  }

  /** Closes every connection, e.g. on server shutdown. */
  closeAll(code: number, reason: string): void {
    for (const p of this.players.values()) {
      p.conn?.close(code, reason);
      p.conn = null;
    }
  }

  // -------------------------------------------------------------------------
  // Messages

  handle(conn: Connection, msg: ClientMessage, makePuzzle: PuzzleFactory, now = Date.now()): void {
    const player = this.findByConn(conn);
    if (!player) return;
    if (msg.t !== 'ping' && msg.t !== 'cursor' && msg.t !== 'cursorHide') {
      player.lastInputAt = now;
      if (player.idle) {
        player.idle = false;
        this.broadcastPlayers();
      }
    }

    switch (msg.t) {
      case 'grab':
        return this.onGrab(player, msg.g, now);
      case 'move':
        return this.onMove(player, msg, now);
      case 'drop':
        return this.onDrop(player, msg, now);
      case 'release':
        return this.onRelease(player, msg.g);
      case 'cursor':
        if (this.inWorld(msg.x, msg.y)) this.pendingCursors.set(player.id, [round1(msg.x), round1(msg.y)]);
        return;
      case 'cursorHide':
        this.pendingCursors.set(player.id, null);
        return;
      case 'name': {
        const name = sanitizeName(msg.name);
        if (!name) return this.sendError(conn, 'BAD_REQUEST', 'Names cannot be empty.');
        player.name = name;
        this.broadcastPlayers();
        this.dirty = true;
        return;
      }
      case 'scatter':
        return this.onScatter(player, msg.aspect, now);
      case 'newPuzzle':
        if (player.id !== this.hostId) return this.sendError(conn, 'NOT_HOST', 'Only the host can start a new puzzle.');
        return this.onNewPuzzle(player, makePuzzle(msg.puzzle), now);
      case 'capacity':
        if (player.id !== this.hostId) return this.sendError(conn, 'NOT_HOST', 'Only the host can change the room size.');
        this.capacity = clampCapacity(msg.max);
        this.broadcast({ t: 'room', room: this.roomInfo() });
        this.dirty = true;
        return;
      case 'ping':
        conn.send({ t: 'pong', ts: msg.ts });
        return;
      case 'leave':
        this.removePlayer(player.id, now);
        conn.close(1000, 'left');
        return;
      case 'hello':
        return this.sendError(conn, 'BAD_REQUEST', 'Already joined.');
    }
  }

  private onGrab(player: PlayerRecord, g: number, now: number): void {
    const group = this.model.groups.get(g);
    const hold = this.held.get(g);
    if (!group || group.locked || this.completion || (hold && hold.playerId !== player.id)) {
      player.conn?.send({ t: 'denied', g, group: group ? toWire(group) : null });
      return;
    }
    // A player drags one group at a time; drop any stale hold first.
    for (const [other, h] of this.held) if (h.playerId === player.id && other !== g) this.releaseHold(other, player.id);
    this.held.set(g, { playerId: player.id, since: now, lastMoveAt: now });
    this.model.bringToFront(g);
    this.broadcast({ t: 'held', g, by: player.id });
  }

  private onMove(player: PlayerRecord, msg: Extract<ClientMessage, { t: 'move' }>, now: number): void {
    const hold = this.held.get(msg.g);
    if (!hold || hold.playerId !== player.id) return;
    const group = this.model.groups.get(msg.g);
    if (!group || !this.inWorld(msg.x, msg.y)) return;
    const rot = this.model.spec.rotation ? msg.r : 0;
    group.x = msg.x;
    group.y = msg.y;
    group.rot = rot;
    hold.lastMoveAt = now;
    this.pendingMoves.set(msg.g, [msg.g, round2(msg.x), round2(msg.y), rot]);
  }

  private onDrop(player: PlayerRecord, msg: Extract<ClientMessage, { t: 'drop' }>, now: number): void {
    const hold = this.held.get(msg.g);
    const group = this.model.groups.get(msg.g);
    if (!group || !hold || hold.playerId !== player.id || !this.inWorld(msg.x, msg.y)) {
      // Tell the sender the real state so it can roll back its prediction.
      player.conn?.send({
        t: 'update',
        by: player.id,
        op: msg.op,
        reason: 'release',
        kind: null,
        groups: group ? [toWire(group)] : [],
        removed: group ? [] : [msg.g],
        joined: 0,
        connected: this.model.connectedCount(),
      });
      return;
    }
    group.x = msg.x;
    group.y = msg.y;
    group.rot = this.model.spec.rotation ? msg.r : 0;
    this.held.delete(msg.g);
    this.pendingMoves.delete(msg.g);

    const result = this.model.drop(msg.g, this.model.snapTolerance(msg.snap), (other) => !this.held.has(other.id));
    player.placed += result.joined;
    this.dirty = true;
    this.touch(now);
    this.broadcast({
      t: 'update',
      by: player.id,
      op: msg.op,
      reason: 'drop',
      kind: result.kind,
      groups: result.changed.map(toWire),
      removed: result.removed,
      joined: result.joined,
      connected: this.model.connectedCount(),
    });
    if (result.joined > 0) this.broadcastPlayers();
    if (result.completed) this.complete(now);
  }

  private onRelease(player: PlayerRecord, g: number): void {
    const hold = this.held.get(g);
    if (hold && hold.playerId === player.id) this.releaseHold(g, player.id);
  }

  private onScatter(player: PlayerRecord, aspect: number, now: number): void {
    if (now - this.lastScatterAt < 2000 || this.completion) return;
    this.lastScatterAt = now;
    const changed = this.model.scatterLoose((now ^ this.model.spec.seed) >>> 0, aspect, new Set(this.held.keys()));
    if (changed.length === 0) return;
    this.dirty = true;
    this.broadcast({
      t: 'update',
      by: player.id,
      reason: 'scatter',
      kind: null,
      groups: changed.map(toWire),
      removed: [],
      joined: 0,
      connected: this.model.connectedCount(),
    });
    this.broadcast({ t: 'event', event: { kind: 'scatter', playerId: player.id, name: player.name } }, player.id);
  }

  private onNewPuzzle(player: PlayerRecord, next: { puzzle: PuzzleInfo; model: PuzzleModel }, now: number): void {
    this.puzzle = next.puzzle;
    this.model = next.model;
    this.held.clear();
    this.pendingMoves.clear();
    this.completion = null;
    this.clockAccumulated = 0;
    this.clockSince = null;
    for (const p of this.players.values()) p.placed = 0;
    this.updateClock(now);
    this.dirty = true;
    this.broadcast({ t: 'puzzle', puzzle: this.puzzle, groups: this.model.snapshot().map(toWire), clock: this.clockInfo() });
    this.broadcast({ t: 'event', event: { kind: 'newPuzzle', playerId: player.id, name: player.name } }, player.id);
    this.broadcastPlayers();
  }

  private complete(now: number): void {
    this.updateClock(now);
    this.clockAccumulated = this.elapsedMs(now);
    this.clockSince = null;
    this.completion = {
      elapsedMs: this.clockAccumulated,
      completedAt: now,
      contributions: Array.from(this.players.values())
        .map((p) => ({ playerId: p.id, name: p.name, color: p.color, placed: p.placed }))
        .sort((a, b) => b.placed - a.placed),
    };
    this.held.clear();
    this.broadcast({ t: 'complete', completion: this.completion });
    this.broadcast({ t: 'clock', clock: this.clockInfo() });
  }

  // -------------------------------------------------------------------------
  // Ticks

  /** Sends batched transient updates (drag positions and cursors). */
  flush(): void {
    if (this.pendingMoves.size === 0 && this.pendingCursors.size === 0) return;
    const msg: Extract<ServerMessage, { t: 'tick' }> = { t: 'tick' };
    if (this.pendingMoves.size) msg.m = Array.from(this.pendingMoves.values());
    const cursors: Array<[string, number, number]> = [];
    const hidden: string[] = [];
    for (const [id, pos] of this.pendingCursors) {
      if (pos) cursors.push([id, pos[0], pos[1]]);
      else hidden.push(id);
    }
    if (cursors.length) msg.c = cursors;
    if (hidden.length) msg.ch = hidden;
    this.pendingMoves.clear();
    this.pendingCursors.clear();
    this.broadcast(msg);
  }

  // -------------------------------------------------------------------------
  // Helpers

  private releaseHold(g: number, playerId: string): void {
    const hold = this.held.get(g);
    if (!hold || hold.playerId !== playerId) return;
    this.held.delete(g);
    this.pendingMoves.delete(g);
    const group = this.model.groups.get(g);
    this.broadcast({
      t: 'update',
      by: playerId,
      reason: 'release',
      kind: null,
      groups: group ? [toWire(group)] : [],
      removed: [],
      joined: 0,
      connected: this.model.connectedCount(),
    });
  }

  private releaseAllHolds(playerId: string): void {
    for (const [g, h] of Array.from(this.held)) if (h.playerId === playerId) this.releaseHold(g, playerId);
  }

  private migrateHost(): void {
    const candidates = Array.from(this.players.values()).sort((a, b) => {
      if ((a.conn === null) !== (b.conn === null)) return a.conn ? -1 : 1;
      return a.joinedAt - b.joinedAt;
    });
    const next = candidates[0];
    this.hostId = next ? next.id : null;
    if (next) this.broadcast({ t: 'event', event: { kind: 'host', playerId: next.id, name: next.name } });
    this.broadcast({ t: 'room', room: this.roomInfo() });
  }

  private pickColor(): string {
    const used = new Set(Array.from(this.players.values(), (p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length]!;
  }

  private updateClock(now: number, exceptPlayerId?: string): void {
    const shouldRun = this.onlineCount > 0 && !this.completion;
    if (shouldRun && this.clockSince === null) {
      this.clockSince = now;
      this.broadcast({ t: 'clock', clock: this.clockInfo() }, exceptPlayerId);
    } else if (!shouldRun && this.clockSince !== null) {
      this.clockAccumulated += now - this.clockSince;
      this.clockSince = null;
      this.broadcast({ t: 'clock', clock: this.clockInfo() }, exceptPlayerId);
    }
  }

  private touch(now: number): void {
    this.lastActiveAt = now;
  }

  private findByConn(conn: Connection): PlayerRecord | undefined {
    for (const p of this.players.values()) if (p.conn === conn) return p;
    return undefined;
  }

  /** Rejects coordinates far outside the table so clients cannot corrupt the layout. */
  private inWorld(x: number, y: number): boolean {
    const { width, height } = this.model.spec;
    const limit = Math.max(width, height) * 6 + 2000;
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= limit && Math.abs(y) <= limit;
  }

  private sendError(conn: Connection, code: ErrorCode, message: string): void {
    conn.send({ t: 'error', code, message, fatal: false });
  }

  broadcastPlayers(): void {
    this.broadcast({ t: 'players', players: this.playerList() });
  }

  broadcast(msg: ServerMessage, exceptPlayerId?: string): void {
    for (const p of this.players.values()) {
      if (p.conn && p.id !== exceptPlayerId) p.conn.send(msg);
    }
  }
}

function clampCapacity(n: number): number {
  return Math.max(MIN_ROOM_CAPACITY, Math.min(MAX_ROOM_CAPACITY, Math.round(n)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
