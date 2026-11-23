/**
 * Golf rules as pure functions over an immutable `RoundState`: stroke counting, penalties,
 * hole results, sequencing and the scorecard. No physics or rendering in here, so the client
 * renders it today and the server can own it in M3.
 */

export interface HoleSpec {
  id: string;
  name: string;
  par: number;
}

export interface HoleResult extends HoleSpec {
  /** Total strokes for the hole, penalties included. */
  strokes: number;
}

/**
 * hole-intro: banner is up, no shooting yet. playing: ball in play. hole-end: ball holed, result
 * banner is up. finished: all holes done, show the scorecard.
 */
export type RoundPhase = 'hole-intro' | 'playing' | 'hole-end' | 'finished';

export interface RoundState {
  readonly holes: readonly HoleSpec[];
  /** Index of the current hole (the last hole's index while finished). */
  readonly index: number;
  readonly phase: RoundPhase;
  /** Strokes taken on the current hole so far. */
  readonly strokes: number;
  readonly results: readonly HoleResult[];
}

export function createRound(holes: readonly HoleSpec[]): RoundState {
  if (holes.length === 0) throw new Error('a round needs at least one hole');
  return { holes, index: 0, phase: 'hole-intro', strokes: 0, results: [] };
}

export function currentHole(s: RoundState): HoleSpec {
  return s.holes[s.index]!;
}

/** Intro banner is done: the player may shoot. */
export function beginPlay(s: RoundState): RoundState {
  return s.phase === 'hole-intro' ? { ...s, phase: 'playing' } : s;
}

/** A shot was taken. Ignored unless the hole is in play. */
export function recordStroke(s: RoundState): RoundState {
  return s.phase === 'playing' ? { ...s, strokes: s.strokes + 1 } : s;
}

/** Penalty strokes (for example out of bounds). Ignored unless the hole is in play. */
export function recordPenalty(s: RoundState, strokes = 1): RoundState {
  return s.phase === 'playing' ? { ...s, strokes: s.strokes + strokes } : s;
}

/** The ball was holed. A hole always counts at least one stroke. */
export function recordHoled(s: RoundState): RoundState {
  if (s.phase !== 'playing') return s;
  const hole = currentHole(s);
  const result: HoleResult = { ...hole, strokes: Math.max(1, s.strokes) };
  return { ...s, phase: 'hole-end', results: [...s.results, result] };
}

/** Hole-end banner is done: move to the next hole's intro, or finish the round. */
export function advance(s: RoundState): RoundState {
  if (s.phase !== 'hole-end') return s;
  if (s.index + 1 >= s.holes.length) return { ...s, phase: 'finished' };
  return { ...s, index: s.index + 1, phase: 'hole-intro', strokes: 0 };
}

/** "Play again": same holes, fresh scorecard. */
export function restartRound(s: RoundState): RoundState {
  return createRound(s.holes);
}

/** "Hole 2 - Dogleg - Par 3" (en dashes). */
export function holeIntroText(s: RoundState): string {
  const h = currentHole(s);
  return `Hole ${s.index + 1} – ${h.name} – Par ${h.par}`;
}

/** Name for a hole score relative to par. */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -3) return 'Albatross!';
  switch (d) {
    case -2:
      return 'Eagle!';
    case -1:
      return 'Birdie!';
    case 0:
      return 'Par';
    case 1:
      return 'Bogey';
    case 2:
      return 'Double bogey';
    default:
      return d > 0 ? `+${d}` : `${d}`;
  }
}

/** "E" for even, otherwise "+2" / "-1". */
export function formatToPar(diff: number): string {
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
}

/** Text of the hole-end banner, for example "Birdie! 2 strokes". */
export function holeEndText(r: HoleResult): string {
  const unit = r.strokes === 1 ? 'stroke' : 'strokes';
  return `${scoreName(r.strokes, r.par)} – ${r.strokes} ${unit} (par ${r.par})`;
}

export interface ScorecardRow extends HoleResult {
  /** strokes - par */
  diff: number;
}

export interface Scorecard {
  rows: ScorecardRow[];
  totalStrokes: number;
  totalPar: number;
  /** totalStrokes - totalPar */
  totalDiff: number;
}

/** Scorecard of the holes completed so far. */
export function scorecard(s: RoundState): Scorecard {
  const rows = s.results.map((r) => ({ ...r, diff: r.strokes - r.par }));
  const totalStrokes = rows.reduce((n, r) => n + r.strokes, 0);
  const totalPar = rows.reduce((n, r) => n + r.par, 0);
  return { rows, totalStrokes, totalPar, totalDiff: totalStrokes - totalPar };
}
