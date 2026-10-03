/**
 * WebSocket protocol between the browser and the multiplayer server.
 *
 * The server is authoritative: clients send intents (grab / move / drop) and
 * the server decides what actually happens (who holds a group, whether it
 * snaps or merges) and broadcasts the result to everyone in the room.
 */
import type { GroupState, Rot, SnapStrength } from './puzzle/model';
import type { PuzzleSpec } from './puzzle/spec';

export const PROTOCOL_VERSION = 1;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const MIN_ROOM_CAPACITY = 2;
export const MAX_ROOM_CAPACITY = 12;
export const DEFAULT_ROOM_CAPACITY = 8;
export const MAX_NAME_LENGTH = 24;

/** Accepts a pasted code or full invite link and returns the bare upper-case code. */
export function normalizeRoomCode(input: string): string {
  const trimmed = input.trim();
  const fromLink = /\/room\/([A-Za-z0-9]+)/.exec(trimmed);
  return (fromLink ? fromLink[1]! : trimmed).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** Collapses whitespace, strips control characters and clamps length. */
export function sanitizeName(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

export type ImageRef =
  | { kind: 'catalog'; id: string }
  | { kind: 'upload'; id: string };

export const UPLOAD_ID_PATTERN = /^u[a-z0-9]{20}$/;

export function imageRefUrl(ref: ImageRef): string {
  return ref.kind === 'catalog' ? `/gallery/${ref.id}.webp` : `/api/images/${ref.id}`;
}

export interface PuzzleInfo {
  spec: PuzzleSpec;
  image: ImageRef;
  title: string;
}

/** Compact group representation used on the wire. */
export interface WireGroup {
  i: number;
  x: number;
  y: number;
  r: Rot;
  l: 0 | 1;
  z: number;
  p: number[];
}

export function toWire(g: GroupState): WireGroup {
  return { i: g.id, x: Math.round(g.x * 100) / 100, y: Math.round(g.y * 100) / 100, r: g.rot, l: g.locked ? 1 : 0, z: g.z, p: g.pieces };
}

export function fromWire(w: WireGroup): GroupState {
  return { id: w.i, x: w.x, y: w.y, rot: w.r, locked: w.l === 1, z: w.z, pieces: w.p };
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  online: boolean;
  idle: boolean;
  joinedAt: number;
  /** Pieces this player has connected so far. */
  placed: number;
}

export interface RoomInfo {
  code: string;
  hostId: string | null;
  capacity: number;
  createdAt: number;
}

export interface ClockInfo {
  elapsedMs: number;
  running: boolean;
}

export interface CompletionInfo {
  elapsedMs: number;
  completedAt: number;
  contributions: Array<{ playerId: string; name: string; color: string; placed: number }>;
}

export interface NewPuzzleRequest {
  image: ImageRef;
  pieces: number;
  rotation: boolean;
  /** Viewport aspect ratio of the requesting player, used for the initial layout. */
  aspect: number;
}

// ---------------------------------------------------------------------------
// Client → server

export type ClientMessage =
  | { t: 'hello'; v: number; code: string; name: string; resume?: { playerId: string; token: string }; hostKey?: string }
  | { t: 'grab'; g: number }
  | { t: 'move'; g: number; x: number; y: number; r: Rot }
  | { t: 'drop'; g: number; x: number; y: number; r: Rot; snap: SnapStrength; op: number }
  | { t: 'release'; g: number }
  | { t: 'cursor'; x: number; y: number }
  | { t: 'cursorHide' }
  | { t: 'name'; name: string }
  | { t: 'scatter'; aspect: number }
  | { t: 'newPuzzle'; puzzle: NewPuzzleRequest }
  | { t: 'capacity'; max: number }
  | { t: 'ping'; ts: number }
  | { t: 'leave' };

// ---------------------------------------------------------------------------
// Server → client

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_HOST'
  | 'VERSION_MISMATCH'
  | 'SERVER_SHUTDOWN'
  | 'REPLACED'
  | 'SERVER_ERROR';

export type RoomEvent =
  | { kind: 'joined'; playerId: string; name: string }
  | { kind: 'left'; playerId: string; name: string }
  | { kind: 'rejoined'; playerId: string; name: string }
  | { kind: 'disconnected'; playerId: string; name: string }
  | { kind: 'host'; playerId: string; name: string }
  | { kind: 'scatter'; playerId: string; name: string }
  | { kind: 'newPuzzle'; playerId: string; name: string };

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  you: { id: string; token: string; color: string };
  room: RoomInfo;
  puzzle: PuzzleInfo;
  groups: WireGroup[];
  held: Array<[number, string]>;
  players: PlayerInfo[];
  clock: ClockInfo;
  completion: CompletionInfo | null;
}

export type ServerMessage =
  | WelcomeMessage
  | { t: 'error'; code: ErrorCode; message: string; fatal: boolean }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'event'; event: RoomEvent }
  | { t: 'held'; g: number; by: string }
  | { t: 'released'; g: number }
  | { t: 'denied'; g: number; group: WireGroup | null }
  | {
      t: 'tick';
      /** Live positions of held groups: [groupId, x, y, rot]. */
      m?: Array<[number, number, number, Rot]>;
      /** Cursor positions: [playerId, x, y]. */
      c?: Array<[string, number, number]>;
      /** Players whose cursor left the board. */
      ch?: string[];
    }
  | {
      t: 'update';
      by: string;
      op?: number;
      reason: 'drop' | 'scatter' | 'release';
      kind: 'board' | 'piece' | null;
      groups: WireGroup[];
      removed: number[];
      joined: number;
      connected: number;
    }
  | { t: 'complete'; completion: CompletionInfo }
  | { t: 'puzzle'; puzzle: PuzzleInfo; groups: WireGroup[]; clock: ClockInfo }
  | { t: 'clock'; clock: ClockInfo }
  | { t: 'pong'; ts: number };

export interface CreateRoomRequest {
  image: ImageRef;
  pieces: number;
  rotation: boolean;
  capacity: number;
  aspect: number;
}

export interface CreateRoomResponse {
  code: string;
  hostKey: string;
}

export interface RoomSummary {
  code: string;
  title: string;
  image: ImageRef;
  pieces: number;
  rotation: boolean;
  players: number;
  online: number;
  capacity: number;
  full: boolean;
  completed: boolean;
  progress: number;
}

export interface UploadResponse {
  id: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Share links: a puzzle (picture, cut and settings) someone sends to a friend,
// optionally as a challenge carrying the sender's time.

export const SHARE_ID_PATTERN = /^[a-z0-9]{10}$/;
export const MAX_SHARE_MESSAGE = 140;
export const MAX_SHARE_TITLE = 60;

export interface ShareChallenge {
  ms: number;
  moves: number;
}

export interface CreateShareRequest {
  image: ImageRef;
  /** The exact grid, so a challenge gets the same cut as the sender's puzzle. */
  cols: number;
  rows: number;
  rotation: boolean;
  /** Reuse a specific cut (challenges); a random one otherwise. */
  seed?: number;
  /** Title for uploaded photos; catalogue pictures keep their own. */
  title?: string;
  from?: string;
  message?: string;
  challenge?: ShareChallenge;
}

export interface ShareInfo {
  id: string;
  title: string;
  image: ImageRef;
  width: number;
  height: number;
  seed: number;
  cols: number;
  rows: number;
  rotation: boolean;
  from: string | null;
  message: string | null;
  challenge: ShareChallenge | null;
  createdAt: number;
  expiresAt: number;
}

export interface CreateShareResponse {
  id: string;
  expiresAt: number;
}

/** Single-line free text: strips control characters, collapses whitespace, clamps length. */
export function sanitizeText(input: string, maxLength: number): string {
  return input
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Accepts a bare id or a full `/s/<id>` link. */
export function normalizeShareId(input: string): string {
  const trimmed = input.trim();
  const fromLink = /\/s\/([A-Za-z0-9]+)/.exec(trimmed);
  return (fromLink ? fromLink[1]! : trimmed).toLowerCase();
}
