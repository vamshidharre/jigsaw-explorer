/** Runtime validation for everything a client can send. */
import { z } from 'zod';
import { MAX_NAME_LENGTH, MAX_ROOM_CAPACITY, MIN_ROOM_CAPACITY, ROOM_CODE_PATTERN, UPLOAD_ID_PATTERN } from '../../shared/protocol';
import { MAX_PIECES, MIN_PIECES } from '../../shared/puzzle/spec';

const coord = z.number().min(-1e6).max(1e6);
const rot = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const groupId = z.number().int().min(0).max(10_000);
const aspect = z.number().min(0.1).max(10);

export const imageRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), id: z.string().regex(/^[a-z0-9-]{1,64}$/) }),
  z.object({ kind: z.literal('upload'), id: z.string().regex(UPLOAD_ID_PATTERN) }),
]);

export const newPuzzleSchema = z.object({
  image: imageRefSchema,
  pieces: z.number().int().min(MIN_PIECES).max(MAX_PIECES),
  rotation: z.boolean(),
  aspect,
});

export const createRoomSchema = newPuzzleSchema.extend({
  capacity: z.number().int().min(MIN_ROOM_CAPACITY).max(MAX_ROOM_CAPACITY),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    code: z.string().regex(ROOM_CODE_PATTERN),
    name: z.string().max(MAX_NAME_LENGTH * 4),
    resume: z.object({ playerId: z.string().regex(/^p[a-z0-9]{12}$/), token: z.string().min(16).max(64) }).optional(),
    hostKey: z.string().min(16).max(64).optional(),
  }),
  z.object({ t: z.literal('grab'), g: groupId }),
  z.object({ t: z.literal('move'), g: groupId, x: coord, y: coord, r: rot }),
  z.object({
    t: z.literal('drop'),
    g: groupId,
    x: coord,
    y: coord,
    r: rot,
    snap: z.enum(['gentle', 'normal', 'strong']),
    op: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({ t: z.literal('release'), g: groupId }),
  z.object({ t: z.literal('cursor'), x: coord, y: coord }),
  z.object({ t: z.literal('cursorHide') }),
  z.object({ t: z.literal('name'), name: z.string().max(MAX_NAME_LENGTH * 4) }),
  z.object({ t: z.literal('scatter'), aspect }),
  z.object({ t: z.literal('newPuzzle'), puzzle: newPuzzleSchema }),
  z.object({ t: z.literal('capacity'), max: z.number().int().min(MIN_ROOM_CAPACITY).max(MAX_ROOM_CAPACITY) }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
  z.object({ t: z.literal('leave') }),
]);
