import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX, PLAYER_COLORS } from './config.js';
import { cleanNickname, isColorIndex } from './lobby.js';

describe('lobby helpers', () => {
  it('cleans nicknames', () => {
    expect(cleanNickname('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanNickname('<b>x</b>')).toBe('bx/b');
    expect(cleanNickname('x'.repeat(40))).toHaveLength(NICKNAME_MAX);
    expect(cleanNickname('', 3)).toBe('Player 3');
    expect(cleanNickname(42)).toBe('Player 1');
  });
  it('has 8 distinct colours', () => {
    expect(new Set(PLAYER_COLORS.map((c) => c.hex)).size).toBe(8);
    expect(isColorIndex(7)).toBe(true);
    expect(isColorIndex(8)).toBe(false);
    expect(isColorIndex(1.5)).toBe(false);
  });
});
