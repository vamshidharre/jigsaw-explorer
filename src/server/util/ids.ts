import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/protocol';

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export function newRoomCode(): string {
  return randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);
}

export function newPlayerId(): string {
  return `p${randomString(LOWER_ALNUM, 12)}`;
}

export function newUploadId(): string {
  return `u${randomString(LOWER_ALNUM, 20)}`;
}

export function newShareId(): string {
  return randomString(LOWER_ALNUM, 10);
}

export function newSecret(): string {
  return randomBytes(24).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
