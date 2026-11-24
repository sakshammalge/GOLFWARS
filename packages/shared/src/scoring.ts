/**
 * Party-golf scoring, pure functions only. Score of a hole = strokes + finish-order bonus:
 * the first player to hole out gets `finishBonus[0]` (-2), the second `finishBonus[1]` (-1),
 * everybody else 0. Players who did not hole out (hole timer, left the match) score their
 * strokes (par + 3 or more, decided by `rules.recordTimeout`) and never get a bonus.
 * Lowest total wins; equal totals share a placement.
 */
import { BALANCE } from './balance.js';

/** What happened to one player on one hole. */
export interface HoleOutcome {
  slot: number;
  /** Final strokes for the hole (already par + extra for a timeout / abandon). */
  strokes: number;
  /** Sim tick at which the ball dropped in the cup, or null if the player never holed out. */
  holedTick: number | null;
}

export interface HoleScore {
  slot: number;
  strokes: number;
  /** Finish order among players who holed out (1 = first). 0 = did not hole out. */
  finishPlace: number;
  /** -2 / -1 / 0. */
  bonus: number;
  /** strokes + bonus. */
  points: number;
  /** Placement on this hole by points (1 = best); equal points share a placement. */
  place: number;
}

/**
 * Finish order of a player that holed out at `tick`, given everyone's hole-out ticks (null = not
 * holed). Players that hole out on the same tick tie and share the better place; the next place
 * then skips (1, 1, 3 ...).
 */
export function finishPlace(tick: number, holedTicks: readonly (number | null)[]): number {
  let earlier = 0;
  for (const t of holedTicks) if (t !== null && t < tick) earlier++;
  return earlier + 1;
}

/** Bonus for a finish place (1-based); 0 beyond the table. */
export function finishBonusFor(
  place: number,
  table: readonly number[] = BALANCE.scoring.finishBonus,
): number {
  return place >= 1 ? (table[place - 1] ?? 0) : 0;
}

/** Competition ranking ("1224"): lowest first, equal values share a place. */
export function rankLowest(values: readonly number[]): number[] {
  return values.map((v) => 1 + values.filter((o) => o < v).length);
}

/** Scores one finished hole for every player. */
export function scoreHole(
  outcomes: readonly HoleOutcome[],
  table: readonly number[] = BALANCE.scoring.finishBonus,
): HoleScore[] {
  const ticks = outcomes.map((o) => o.holedTick);
  const rows = outcomes.map((o) => {
    const place = o.holedTick === null ? 0 : finishPlace(o.holedTick, ticks);
    const bonus = place === 0 ? 0 : finishBonusFor(place, table);
    return {
      slot: o.slot,
      strokes: o.strokes,
      finishPlace: place,
      bonus,
      points: o.strokes + bonus,
    };
  });
  const places = rankLowest(rows.map((r) => r.points));
  return rows.map((r, i) => ({ ...r, place: places[i]! }));
}

export interface StandingRow {
  slot: number;
  total: number;
  /** Final placement; equal totals share one (1, 1, 3). */
  place: number;
}

/** Final standings from each player's total points, best first (ties ordered by slot). */
export function standings(totals: readonly { slot: number; total: number }[]): StandingRow[] {
  const places = rankLowest(totals.map((t) => t.total));
  return totals
    .map((t, i) => ({ slot: t.slot, total: t.total, place: places[i]! }))
    .sort((a, b) => a.place - b.place || a.slot - b.slot);
}

/** Points of each finished hole: strokes + bonus, element-wise. */
export function holePoints(strokes: readonly number[], bonuses: readonly number[]): number[] {
  return strokes.map((s, i) => s + (bonuses[i] ?? 0));
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
