import { describe, expect, it } from 'vitest';
import {
  finishBonusFor,
  finishPlace,
  holePoints,
  ordinal,
  rankLowest,
  scoreHole,
  standings,
} from './scoring.js';

const o = (slot: number, strokes: number, holedTick: number | null) => ({
  slot,
  strokes,
  holedTick,
});

describe('finish order', () => {
  it('numbers players by hole-out tick, ties share the better place', () => {
    const t = [100, 50, null, 50, 200];
    expect(t.map((x) => (x === null ? 0 : finishPlace(x, t)))).toEqual([3, 1, 0, 1, 4]);
  });

  it('bonus table: -2, -1, then 0', () => {
    expect([1, 2, 3, 4].map((p) => finishBonusFor(p))).toEqual([-2, -1, 0, 0]);
    expect(finishBonusFor(0)).toBe(0);
  });
});

describe('scoreHole', () => {
  it('1st gets -2, 2nd -1, the rest 0', () => {
    const r = scoreHole([o(0, 3, 300), o(1, 2, 200), o(2, 4, 400), o(3, 2, 500)]);
    expect(r.map((x) => x.bonus)).toEqual([-1, -2, 0, 0]);
    expect(r.map((x) => x.points)).toEqual([2, 0, 4, 2]);
    expect(r.map((x) => x.finishPlace)).toEqual([2, 1, 3, 4]);
  });

  it('a tie for 1st gives both -2 and the next player is 3rd (no bonus)', () => {
    const r = scoreHole([o(0, 2, 100), o(1, 2, 100), o(2, 2, 150)]);
    expect(r.map((x) => x.bonus)).toEqual([-2, -2, 0]);
    expect(r.map((x) => x.finishPlace)).toEqual([1, 1, 3]);
    expect(r.map((x) => x.place)).toEqual([1, 1, 3]);
  });

  it('a tie for 2nd gives both -1', () => {
    const r = scoreHole([o(0, 3, 10), o(1, 3, 20), o(2, 3, 20)]);
    expect(r.map((x) => x.bonus)).toEqual([-2, -1, -1]);
  });

  it('timeouts and abandons score their strokes with no bonus', () => {
    const r = scoreHole([o(0, 2, 100), o(1, 6, null), o(2, 6, null)]);
    expect(r.map((x) => x.bonus)).toEqual([-2, 0, 0]);
    expect(r.map((x) => x.points)).toEqual([0, 6, 6]);
    expect(r.map((x) => x.place)).toEqual([1, 2, 2]);
  });

  it('everyone timing out: nobody gets a bonus and all tie for 1st', () => {
    const r = scoreHole([o(0, 6, null), o(1, 6, null), o(2, 6, null)]);
    expect(r.every((x) => x.bonus === 0 && x.points === 6 && x.place === 1)).toBe(true);
  });

  it('a lone player gets the 1st-place bonus', () => {
    expect(scoreHole([o(0, 4, 77)])[0]).toMatchObject({ bonus: -2, points: 2, place: 1 });
  });

  it('a holed-out slow player can still place behind a quick timeout-free rival by points', () => {
    // 1st to finish took 5 strokes (-2 = 3), 2nd took 2 strokes (-1 = 1): the 2nd places better.
    const r = scoreHole([o(0, 5, 10), o(1, 2, 20)]);
    expect(r.map((x) => x.place)).toEqual([2, 1]);
  });

  it('respects a custom bonus table', () => {
    const r = scoreHole([o(0, 3, 1), o(1, 3, 2)], [-3]);
    expect(r.map((x) => x.bonus)).toEqual([-3, 0]);
  });
});

describe('standings', () => {
  it('lowest total wins and ties share a placement', () => {
    const s = standings([
      { slot: 0, total: 5 },
      { slot: 1, total: -2 },
      { slot: 2, total: 5 },
      { slot: 3, total: 9 },
    ]);
    expect(s.map((x) => [x.slot, x.place])).toEqual([
      [1, 1],
      [0, 2],
      [2, 2],
      [3, 4],
    ]);
  });

  it('totals can be negative', () => {
    expect(standings([{ slot: 0, total: -3 }])[0]).toEqual({ slot: 0, total: -3, place: 1 });
  });
});

describe('helpers', () => {
  it('rankLowest and holePoints and ordinal', () => {
    expect(rankLowest([3, 1, 1, 2])).toEqual([4, 1, 1, 3]);
    expect(holePoints([2, 3, 4], [-2, -1])).toEqual([0, 2, 4]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});
