import { describe, expect, it } from 'vitest';
import {
  advance,
  beginPlay,
  createRound,
  currentHole,
  formatToPar,
  holeEndText,
  holeIntroText,
  recordHoled,
  recordPenalty,
  recordStroke,
  restartRound,
  scoreName,
  scorecard,
  type RoundState,
} from './rules.js';

const holes = [
  { id: 'a', name: 'Straight', par: 2 },
  { id: 'b', name: 'Dogleg', par: 3 },
  { id: 'c', name: 'Bumpers', par: 3 },
];

function play(s: RoundState, strokes: number, penalties = 0): RoundState {
  s = beginPlay(s);
  for (let i = 0; i < strokes; i++) s = recordStroke(s);
  if (penalties) s = recordPenalty(s, penalties);
  return advance(recordHoled(s));
}

describe('round sequence', () => {
  it('starts on hole 1 in the intro phase and cannot be shot before play begins', () => {
    const s = createRound(holes);
    expect(s.phase).toBe('hole-intro');
    expect(recordStroke(s)).toBe(s);
    expect(beginPlay(s).phase).toBe('playing');
  });

  it('counts strokes and penalties, then holes out and advances', () => {
    let s = beginPlay(createRound(holes));
    s = recordStroke(recordStroke(s));
    s = recordPenalty(s);
    expect(s.strokes).toBe(3);
    s = recordHoled(s);
    expect(s.phase).toBe('hole-end');
    expect(s.results).toEqual([{ id: 'a', name: 'Straight', par: 2, strokes: 3 }]);
    s = advance(s);
    expect(s.phase).toBe('hole-intro');
    expect(s.index).toBe(1);
    expect(s.strokes).toBe(0);
    expect(currentHole(s).id).toBe('b');
  });

  it('ignores out-of-phase events', () => {
    const intro = createRound(holes);
    expect(recordHoled(intro)).toBe(intro);
    expect(advance(intro)).toBe(intro);
    const ended = recordHoled(beginPlay(intro));
    expect(recordStroke(ended)).toBe(ended);
    expect(recordPenalty(ended)).toBe(ended);
  });

  it('finishes after the last hole and restarts clean', () => {
    let s = createRound(holes);
    s = play(s, 2);
    s = play(s, 4);
    s = play(s, 3);
    expect(s.phase).toBe('finished');
    expect(s.index).toBe(2);
    expect(advance(s)).toBe(s);
    const again = restartRound(s);
    expect(again.phase).toBe('hole-intro');
    expect(again.results).toEqual([]);
    expect(again.index).toBe(0);
  });

  it('counts a holed ball as at least one stroke', () => {
    const s = recordHoled(beginPlay(createRound(holes)));
    expect(s.results[0]!.strokes).toBe(1);
  });
});

describe('scorecard', () => {
  it('totals strokes against par per hole and overall', () => {
    let s = createRound(holes);
    s = play(s, 1);
    s = play(s, 4, 1);
    s = play(s, 3);
    const card = scorecard(s);
    expect(card.rows.map((r) => r.strokes)).toEqual([1, 5, 3]);
    expect(card.rows.map((r) => r.diff)).toEqual([-1, 2, 0]);
    expect(card.totalStrokes).toBe(9);
    expect(card.totalPar).toBe(8);
    expect(card.totalDiff).toBe(1);
  });
});

describe('text helpers', () => {
  it('formats the intro banner', () => {
    let s = createRound(holes);
    s = play(s, 2);
    expect(holeIntroText(s)).toBe('Hole 2 – Dogleg – Par 3');
  });

  it('names scores relative to par', () => {
    expect(scoreName(1, 3)).toBe('Hole in one!');
    expect(scoreName(2, 3)).toBe('Birdie!');
    expect(scoreName(3, 3)).toBe('Par');
    expect(scoreName(4, 3)).toBe('Bogey');
    expect(scoreName(5, 3)).toBe('Double bogey');
    expect(scoreName(7, 3)).toBe('+4');
    expect(scoreName(2, 4)).toBe('Eagle!');
    expect(scoreName(2, 5)).toBe('Albatross!');
  });

  it('formats to-par and the end-of-hole banner', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(2)).toBe('+2');
    expect(formatToPar(-1)).toBe('-1');
    expect(holeEndText({ id: 'x', name: 'X', par: 3, strokes: 2 })).toBe(
      'Birdie! – 2 strokes (par 3)',
    );
  });
});
