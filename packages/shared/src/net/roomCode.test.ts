import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, generateRoomCode, normalizeRoomCode } from './roomCode.js';

describe('room codes', () => {
  it('has no ambiguous letters', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });
  it('generates 5 uppercase letters from the alphabet', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z]{5}$/);
  });
  it('normalises input', () => {
    expect(normalizeRoomCode(' abcde ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABCD')).toBeNull();
    expect(normalizeRoomCode('ABCDO')).toBeNull();
    expect(normalizeRoomCode('ABC1E')).toBeNull();
  });
});
