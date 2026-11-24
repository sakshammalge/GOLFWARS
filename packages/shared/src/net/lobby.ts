import { NICKNAME_MAX, PLAYER_COLORS } from './config.js';

/** Trims, strips control characters and angle brackets, collapses spaces, limits the length. */
export function cleanNickname(raw: unknown, fallbackIndex = 1): string {
  let s = '';
  if (typeof raw === 'string') {
    for (const ch of raw) {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 32 || code === 127 || ch === '<' || ch === '>') continue;
      s += ch;
    }
    s = s.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
  }
  return s.length > 0 ? s : `Player ${fallbackIndex}`;
}

/** Is `i` a valid colour index (0..7)? */
export function isColorIndex(i: unknown): i is number {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < PLAYER_COLORS.length;
}
