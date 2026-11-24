import { NET } from './config.js';

/** Uppercase letters without the look-alikes I and O. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A random room code such as "KQZMT". `rng` returns a float in [0, 1). */
export function generateRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < NET.roomCodeLength; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}

/** Trims, uppercases and validates user input; returns null if it cannot be a room code. */
export function normalizeRoomCode(input: string): string | null {
  const s = input.trim().toUpperCase();
  const re = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${NET.roomCodeLength}}$`);
  return re.test(s) ? s : null;
}
