import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../physics/golfSim.js';
import { MATCH, NET, type MatchConfig } from '../net/config.js';
import { toEntry, type ShotTuple } from '../net/input.js';
import { NO_INPUT, WINDUP, type WindupInput } from '../character/index.js';
import { MatchSim, type TickInput } from './matchSim.js';

beforeAll(async () => {
  await initPhysics();
});

const FAST: MatchConfig = { ...MATCH, introSeconds: 0.05, holeEndSeconds: 0.1 };

let seqCounter = 0;
function inp(input: WindupInput, viewTick = 0, shot?: ShotTuple): TickInput {
  return { seq: ++seqCounter, viewTick, entry: toEntry(input, shot) };
}
const still = (): TickInput => inp(NO_INPUT, 1e9);

/** Runs `n` ticks, feeding each player the entries from `make(tick)`. */
function run(
  m: MatchSim,
  n: number,
  make: (slot: number) => TickInput[] = () => [],
  slots: number[] = [...m.players.keys()],
) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const inputs = new Map<number, TickInput[]>();
    for (const s of slots) inputs.set(s, make(s));
    events.push(...m.tick(inputs));
  }
  return events;
}

/** Drops player `slot`'s ball into the cup and ticks until it counts as holed. */
function holeIn(m: MatchSim, slot: number): void {
  const cup = m.hole.cup.position;
  m.ballOf(slot)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
  for (let i = 0; i < 60 && !m.players.get(slot)!.holed; i++) m.tick();
  expect(m.players.get(slot)!.holed).toBe(true);
}

/** Drops `slot`'s ball into the cup and returns the events up to and including its holed event. */
function holeInEvents(m: MatchSim, slot: number) {
  const cup = m.hole.cup.position;
  m.ballOf(slot)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
  const out = [];
  for (let i = 0; i < 60 && !m.players.get(slot)!.holed; i++) out.push(...m.tick());
  return out;
}

function startPlaying(m: MatchSim): void {
  run(m, 10);
  expect(m.phase).toBe('playing');
}

describe('MatchSim', () => {
  it('starts in the intro with every player beside their own ball on the tee', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1, 2], FAST);
    expect(m.phase).toBe('hole-intro');
    expect(m.netPlayers()).toHaveLength(3);
    const tee = m.hole.tee;
    for (const p of m.netPlayers()) {
      expect(Math.hypot(p.ball.pos[0] - tee[0], p.ball.pos[2] - tee[2])).toBeLessThan(0.01);
      expect(Math.hypot(p.windup.pos[0] - tee[0], p.windup.pos[2] - tee[2])).toBeLessThan(1.1);
    }
    m.dispose();
  });

  it('takes a valid shot, counts the stroke and moves only that ball', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    startPlaying(m);
    const yaw = 0;
    const ev = run(m, 1, (s) => (s === 0 ? [inp(NO_INPUT, 1e9, [yaw, 0, 0.5])] : []));
    expect(ev).toContainEqual({ k: 'shot', p: 0 });
    expect(m.players.get(0)!.round.strokes).toBe(1);
    run(m, 30);
    expect(m.ballOf(0)!.position()[2]).toBeLessThan(m.hole.tee[2] - 0.3);
    expect(m.ballOf(1)!.state).toBe('resting');
    expect(m.players.get(1)!.round.strokes).toBe(0);
    m.dispose();
  });

  it('rejects shots out of reach, while the ball moves, before play and when frozen', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0], FAST);
    // During the intro.
    run(m, 1, () => [inp(NO_INPUT, 1e9, [0, 0, 0.5])]);
    expect(m.players.get(0)!.round.strokes).toBe(0);
    startPlaying(m);
    // Walk away (camera yaw 0, move forward = -z... ball is at the tee, so go back towards +z).
    run(m, 90, () => [inp({ ...NO_INPUT, moveZ: -1, sprint: false })]);
    const far = m.windupOf(0)!.position();
    expect(
      Math.hypot(far[0] - m.ballOf(0)!.position()[0], far[2] - m.ballOf(0)!.position()[2]),
    ).toBeGreaterThan(WINDUP.ballReach);
    expect(run(m, 1, () => [inp(NO_INPUT, 1e9, [0, 0, 0.5])])).toEqual([]);
    expect(m.players.get(0)!.round.strokes).toBe(0);
    m.dispose();
  });

  it('ignores a second shot while the ball is moving', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0], FAST);
    startPlaying(m);
    run(m, 1, () => [inp(NO_INPUT, 1e9, [0, 0, 0.4])]);
    run(m, 2, () => [inp(NO_INPUT, 1e9, [0, 0, 0.4])]);
    expect(m.players.get(0)!.round.strokes).toBe(1);
    m.dispose();
  });

  it('ends the hole when every player has holed, then plays hole 2, then finishes with a scoreboard', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    for (let h = 0; h < KITCHEN_TABLE.length; h++) {
      startPlaying(m);
      expect(m.holeIndex).toBe(h);
      holeIn(m, 0);
      expect(m.phase).toBe('playing'); // player 1 is still out there
      holeIn(m, 1);
      expect(m.phase).toBe('hole-end');
      run(m, 10);
    }
    expect(m.phase).toBe('results');
    const board = m.scoreboard();
    expect(board).toHaveLength(2);
    expect(board[0]!.holes).toEqual([1, 1, 1]);
    // 1st to hole out gets -2 per hole, 2nd gets -1: 3 strokes - 6 = -3 and 3 - 3 = 0.
    expect(board[0]!.bonuses).toEqual([-2, -2, -2]);
    expect(board[0]!.total).toBe(-3);
    expect(board[1]!.bonuses).toEqual([-1, -1, -1]);
    expect(board[1]!.total).toBe(0);
    expect(board[0]!.places).toEqual([1, 1, 1]);
    expect(board[1]!.places).toEqual([2, 2, 2]);
    m.dispose();
  });

  it('times a hole out: unfinished players score par + 3, finished players keep their strokes', () => {
    const cfg = { ...FAST, holeTimeSeconds: 0.5 };
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], cfg);
    startPlaying(m);
    holeIn(m, 0);
    const events = run(m, 60);
    expect(events).toContainEqual({ k: 'timeout', p: 1 });
    expect(events.some((e) => e.k === 'timeout' && e.p === 0)).toBe(false);
    const par = KITCHEN_TABLE[0]!.par;
    expect(m.players.get(1)!.round.results[0]!.strokes).toBe(par + 3);
    expect(m.players.get(0)!.round.results[0]!.strokes).toBe(1);
    m.dispose();
  });

  it('scores an abandoned player par + 3 on this and all later holes', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    startPlaying(m);
    m.abandon(1);
    expect(m.netPlayers()).toHaveLength(1);
    holeIn(m, 0);
    expect(m.phase).toBe('hole-end');
    run(m, 10);
    expect(m.holeIndex).toBe(1);
    expect(m.players.get(1)!.round.results).toHaveLength(2);
    expect(m.players.get(1)!.round.results[1]!.strokes).toBe(KITCHEN_TABLE[1]!.par + 3);
    m.dispose();
  });

  it('does not run the clock while nobody is connected', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0], { ...FAST, holeTimeSeconds: 1 });
    startPlaying(m);
    m.setConnected(0, false);
    const t = m.timeLeft;
    run(m, 120, () => [], []);
    expect(m.timeLeft).toBe(t);
    m.setConnected(0, true);
    run(m, 5);
    expect(m.timeLeft).toBeLessThan(t);
    m.dispose();
  });

  it('respawns a Windup that fell off the table beside its ball', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0], FAST);
    startPlaying(m);
    m.windupOf(0)!.setPosition([40, -20, 40]);
    const ev = run(m, 2, () => [still()]);
    expect(ev).toContainEqual({ k: 'fell', p: 0 });
    const w = m.windupOf(0)!.position();
    const b = m.ballOf(0)!.position();
    expect(Math.hypot(w[0] - b[0], w[2] - b[2])).toBeLessThan(2);
    m.dispose();
  });
});

describe('lag-compensated bonks', () => {
  /** Attacker chases a sprinting victim, swings; returns whether the victim was toppled. */
  function chase(viewLag: number): boolean {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    startPlaying(m);
    const a = m.windupOf(0)!;
    const v = m.windupOf(1)!;
    const y = a.position()[1];
    a.setPosition([0, y, 4]);
    a.yaw = 0;
    v.setPosition([0, y, 2.6]);
    const run1: WindupInput = { ...NO_INPUT, moveZ: 1, sprint: true };
    // Both sprint towards -z; the attacker trails by 1.4 m.
    for (let i = 0; i < 40; i++) {
      m.tick(
        new Map([
          [0, [inp(run1)]],
          [1, [inp(run1)]],
        ]),
      );
    }
    const gap0 = v.position()[2] - a.position()[2];
    expect(Math.abs(gap0)).toBeGreaterThan(1.0);
    // Attacker swings (slowing down) while the victim keeps running.
    const swing: WindupInput = { ...run1, swing: true };
    const events = [];
    for (let i = 0; i < 16; i++) {
      const view = m.tickCount + 1 - viewLag;
      events.push(
        ...m.tick(
          new Map([
            [0, [inp(i === 0 ? swing : run1, view)]],
            [1, [inp(run1)]],
          ]),
        ),
      );
    }
    m.dispose();
    return events.some((e) => e.k === 'bonk' && e.a === 0 && e.v === 1);
  }

  it('misses a running victim without compensation but hits it when rewound by the view lag', () => {
    expect(chase(0)).toBe(false);
    expect(chase(NET.lagMaxRewindTicks)).toBe(true);
  });

  it('caps the rewind at lagMaxRewindTicks', () => {
    expect(chase(60)).toBe(chase(NET.lagMaxRewindTicks));
  });

  it('gives the finish bonus by hole-out order and reports it in the holed event', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1, 2], FAST);
    startPlaying(m);
    expect(holeInEvents(m, 2)).toContainEqual({ k: 'holed', p: 2, s: 1, r: 1, b: -2 });
    expect(holeInEvents(m, 0)).toContainEqual({ k: 'holed', p: 0, s: 1, r: 2, b: -1 });
    expect(holeInEvents(m, 1)).toContainEqual({ k: 'holed', p: 1, s: 1, r: 3, b: 0 });
    expect(m.phase).toBe('hole-end');
    const board = m.scoreboard();
    expect(board.map((r) => r.bonuses[0])).toEqual([-1, 0, -2]);
    expect(board.map((r) => r.total)).toEqual([0, 1, -1]);
    expect(board.map((r) => r.places[0])).toEqual([2, 3, 1]);
    m.dispose();
  });

  it('players who hole out on the same tick tie for 1st and both get -2', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1, 2], FAST);
    startPlaying(m);
    const cup = m.hole.cup.position;
    for (const s of [0, 1]) m.ballOf(s)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
    const ev = run(m, 20);
    const holed = ev.filter((e) => e.k === 'holed');
    expect(holed).toHaveLength(2);
    for (const e of holed) expect(e).toMatchObject({ r: 1, b: -2 });
    // The third player holes later: place 3 (not 2), no bonus.
    expect(holeInEvents(m, 2)).toContainEqual({ k: 'holed', p: 2, s: 1, r: 3, b: 0 });
    m.dispose();
  });

  it('everyone timing out scores par + 3, no bonus, and ties for 1st on the hole', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], { ...FAST, holeTimeSeconds: 0.3 });
    startPlaying(m);
    run(m, 14);
    expect(m.phase).toBe('hole-end');
    const par = KITCHEN_TABLE[0]!.par;
    const board = m.scoreboard();
    for (const r of board) {
      expect(r.holes).toEqual([par + 3]);
      expect(r.bonuses).toEqual([0]);
      expect(r.places).toEqual([1]);
      expect(r.total).toBe(par + 3);
    }
    m.dispose();
  });

  it('a timeout never earns a bonus even when others hole out, and a left player keeps par + 3', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1, 2], { ...FAST, holeTimeSeconds: 1 });
    startPlaying(m);
    m.abandon(2);
    holeIn(m, 0);
    for (let i = 0; i < 200 && m.phase !== 'hole-end'; i++) m.tick(); // player 1 times out
    expect(m.phase).toBe('hole-end');
    const [a, b, c] = m.scoreboard();
    const par = KITCHEN_TABLE[0]!.par;
    expect([a!.total, b!.total, c!.total]).toEqual([-1, par + 3, par + 3]);
    expect([a!.places[0], b!.places[0], c!.places[0]]).toEqual([1, 2, 2]);
    m.dispose();
  });

  it('abandoning during the intro scores that hole as par + 3 too', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    m.abandon(1);
    startPlaying(m);
    holeIn(m, 0);
    expect(m.phase).toBe('hole-end');
    expect(m.scoreboard()[1]!.holes).toEqual([KITCHEN_TABLE[0]!.par + 3]);
    m.dispose();
  });
});
