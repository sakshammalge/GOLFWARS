/**
 * The match state machine, as pure functions over a plain `FlowState` (no physics, no clocks):
 *
 *   lobby -> hole-intro (banner, no input) -> playing (hole timer) -> hole-end (results banner)
 *         -> hole-intro of the next hole ... -> results (podium) -> rematch: back to lobby, or a
 *            fresh match with the same players.
 *
 * The number of holes is data: it comes from the course's hole list. `MatchSim` owns one of these
 * and does the side effects (loading holes, scoring); the room maps it onto the schema.
 */

export type FlowPhase = 'lobby' | 'hole-intro' | 'playing' | 'hole-end' | 'results';

export interface FlowState {
  phase: FlowPhase;
  holeIndex: number;
  holeCount: number;
  /** Seconds left in the intro / hole-end banner, or on the hole timer while playing. */
  timeLeft: number;
}

export interface FlowConfig {
  introSeconds: number;
  holeEndSeconds: number;
  holeTimeSeconds: number;
}

/** What `stepFlow` did, for the caller's side effects. */
export type FlowTransition =
  | { kind: 'play' }
  | { kind: 'hole-over'; timedOut: boolean }
  | { kind: 'next-hole'; holeIndex: number }
  | { kind: 'results' };

export function createFlow(holeCount: number): FlowState {
  if (holeCount < 1) throw new Error('a match needs at least one hole');
  return { phase: 'lobby', holeIndex: 0, holeCount, timeLeft: 0 };
}

/** Lobby -> intro of hole 0. Ignored outside the lobby. */
export function startFlow(f: FlowState, cfg: FlowConfig): boolean {
  if (f.phase !== 'lobby') return false;
  f.phase = 'hole-intro';
  f.holeIndex = 0;
  f.timeLeft = cfg.introSeconds;
  return true;
}

/** Late joiners are only accepted in the lobby. */
export function canJoin(f: Pick<FlowState, 'phase'>): boolean {
  return f.phase === 'lobby';
}

/** Players may move, shoot and use gadgets only while the hole is in play. */
export function acceptsInput(f: Pick<FlowState, 'phase'>): boolean {
  return f.phase === 'playing';
}

/**
 * Advances the clock by `dt`. `allDone` = every connected player has finished the hole (it then
 * ends at once). Returns the transition that happened this step, or null.
 */
export function stepFlow(
  f: FlowState,
  dt: number,
  cfg: FlowConfig,
  allDone: boolean,
): FlowTransition | null {
  switch (f.phase) {
    case 'hole-intro':
      f.timeLeft -= dt;
      if (f.timeLeft > 0) return null;
      f.phase = 'playing';
      f.timeLeft = cfg.holeTimeSeconds;
      return { kind: 'play' };
    case 'playing':
      f.timeLeft -= dt;
      if (f.timeLeft <= 0) return endHoleFlow(f, cfg, true);
      return allDone ? endHoleFlow(f, cfg, false) : null;
    case 'hole-end':
      f.timeLeft -= dt;
      if (f.timeLeft > 0) return null;
      if (f.holeIndex + 1 >= f.holeCount) {
        f.phase = 'results';
        f.timeLeft = 0;
        return { kind: 'results' };
      }
      f.holeIndex++;
      f.phase = 'hole-intro';
      f.timeLeft = cfg.introSeconds;
      return { kind: 'next-hole', holeIndex: f.holeIndex };
    default:
      return null;
  }
}

/** Ends the hole now (everyone is done, or the timer ran out). Only valid while playing. */
export function endHoleFlow(
  f: FlowState,
  cfg: FlowConfig,
  timedOut: boolean,
): FlowTransition | null {
  if (f.phase !== 'playing') return null;
  f.phase = 'hole-end';
  f.timeLeft = cfg.holeEndSeconds;
  return { kind: 'hole-over', timedOut };
}

export type RematchMode = 'again' | 'lobby';

/** What the room does after the results: nothing (not at the results), a fresh match, or the lobby. */
export function rematchTarget(phase: FlowPhase, mode: unknown): 'restart' | 'lobby' | null {
  if (phase !== 'results') return null;
  return mode === 'again' ? 'restart' : 'lobby';
}

/** Votes at the results screen: how many connected players want another match. */
export function tallyRematch(
  votes: ReadonlyMap<number, boolean>,
  eligible: readonly number[],
): { yes: number; total: number } {
  let yes = 0;
  for (const slot of eligible) if (votes.get(slot) === true) yes++;
  return { yes, total: eligible.length };
}
