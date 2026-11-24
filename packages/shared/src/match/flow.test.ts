import { describe, expect, it } from 'vitest';
import {
  acceptsInput,
  canJoin,
  createFlow,
  endHoleFlow,
  rematchTarget,
  startFlow,
  stepFlow,
  tallyRematch,
  type FlowConfig,
  type FlowTransition,
} from './flow.js';

const CFG: FlowConfig = { introSeconds: 3, holeEndSeconds: 5, holeTimeSeconds: 90 };

/** Steps the flow in 1 s chunks until it returns a transition (max 200 s). */
function until(f: ReturnType<typeof createFlow>, allDone = false): FlowTransition {
  for (let i = 0; i < 200; i++) {
    const t = stepFlow(f, 1, CFG, allDone);
    if (t) return t;
  }
  throw new Error('no transition');
}

describe('match flow', () => {
  it('walks lobby -> intro -> playing -> hole-end -> ... -> results for any hole count', () => {
    for (const holes of [1, 3, 6]) {
      const f = createFlow(holes);
      expect(f.phase).toBe('lobby');
      expect(canJoin(f)).toBe(true);
      expect(startFlow(f, CFG)).toBe(true);
      expect(canJoin(f)).toBe(false);
      for (let h = 0; h < holes; h++) {
        expect(f.phase).toBe('hole-intro');
        expect(f.holeIndex).toBe(h);
        expect(acceptsInput(f)).toBe(false);
        expect(until(f)).toEqual({ kind: 'play' });
        expect(acceptsInput(f)).toBe(true);
        expect(until(f, true)).toEqual({ kind: 'hole-over', timedOut: false });
        expect(f.phase).toBe('hole-end');
        const t = until(f);
        expect(t).toEqual(
          h + 1 < holes ? { kind: 'next-hole', holeIndex: h + 1 } : { kind: 'results' },
        );
      }
      expect(f.phase).toBe('results');
      expect(stepFlow(f, 10, CFG, true)).toBeNull();
    }
  });

  it('intro lasts 3 s, hole-end 5 s, the hole timer 90 s', () => {
    const f = createFlow(2);
    startFlow(f, CFG);
    expect(stepFlow(f, 2.9, CFG, false)).toBeNull();
    expect(stepFlow(f, 0.2, CFG, false)).toEqual({ kind: 'play' });
    expect(f.timeLeft).toBe(90);
    expect(stepFlow(f, 89.9, CFG, false)).toBeNull();
    expect(stepFlow(f, 0.2, CFG, false)).toEqual({ kind: 'hole-over', timedOut: true });
    expect(f.timeLeft).toBe(5);
  });

  it('endHoleFlow only works while playing; start only from the lobby', () => {
    const f = createFlow(1);
    expect(endHoleFlow(f, CFG, false)).toBeNull();
    startFlow(f, CFG);
    expect(startFlow(f, CFG)).toBe(false);
    expect(endHoleFlow(f, CFG, false)).toBeNull(); // still the intro
  });

  it('rematch is only possible at the results', () => {
    expect(rematchTarget('playing', 'again')).toBeNull();
    expect(rematchTarget('results', 'again')).toBe('restart');
    expect(rematchTarget('results', 'lobby')).toBe('lobby');
    expect(rematchTarget('results', undefined)).toBe('lobby');
  });

  it('tallies rematch votes of eligible players only', () => {
    const votes = new Map([
      [0, true],
      [1, false],
      [5, true],
    ]);
    expect(tallyRematch(votes, [0, 1, 2])).toEqual({ yes: 1, total: 3 });
  });

  it('rejects a match without holes', () => {
    expect(() => createFlow(0)).toThrow();
  });
});
