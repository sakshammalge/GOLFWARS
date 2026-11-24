import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../physics/golfSim.js';
import { MATCH, type MatchConfig } from '../net/config.js';
import { BALANCE } from '../balance.js';
import { toEntry } from '../net/input.js';
import { NO_INPUT, type WindupInput } from '../character/index.js';
import { MatchSim, type TickInput } from './matchSim.js';

beforeAll(async () => {
  await initPhysics();
});

const FAST: MatchConfig = {
  ...MATCH,
  introSeconds: 0.05,
  holeEndSeconds: 0.1,
  holeTimeSeconds: 600,
};
let seq = 0;
const inp = (input: WindupInput = NO_INPUT): TickInput => ({
  seq: ++seq,
  viewTick: 1e9,
  entry: toEntry(input),
});

function run(m: MatchSim, n: number, make: (slot: number) => TickInput[] = () => []) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const inputs = new Map<number, TickInput[]>();
    for (const s of m.players.keys()) inputs.set(s, make(s));
    events.push(...m.tick(inputs));
  }
  return events;
}

function playing(slots: number[], seed = 5): MatchSim {
  const m = new MatchSim(KITCHEN_TABLE, slots, FAST, seed);
  run(m, 10);
  expect(m.phase).toBe('playing');
  return m;
}

/** Puts a Windup's feet on the floor next to a crate (just out of pickup range, then walk in). */
function beside(m: MatchSim, slot: number, crate: number, dx = 0): void {
  const c = m.gadgets.crates[crate]!.pos;
  m.windupOf(slot)!.setPosition([c[0] + dx, c[1] - 0.3, c[2]]);
}

describe('crates and gadget use in a match', () => {
  it('walking into a crate gives a random gadget (seeded) and sets the crate empty', () => {
    const a = playing([0, 1], 11);
    const b = playing([0, 1], 11);
    beside(a, 0, 0);
    beside(b, 0, 0);
    const evA = run(a, 2);
    const evB = run(b, 2);
    const pick = evA.find((e) => e.k === 'pickup');
    expect(pick).toMatchObject({ k: 'pickup', p: 0 });
    expect(evB.find((e) => e.k === 'pickup')).toEqual(pick); // same seed, same gadget
    expect(a.snapshotFor(0).gadget).toBe((pick as { g: string }).g);
    expect(a.snapshotFor(1).gadget).toBeNull(); // others do not see it
    expect(a.snapshotFor(0).crates & 1).toBe(0);
    a.dispose();
    b.dispose();
  });

  it('really walks into a crate on foot', () => {
    const m = playing([0]);
    const c = m.gadgets.crates[0]!.pos;
    m.windupOf(0)!.setPosition([c[0] - 2.5, c[1] - 0.3, c[2]]);
    // Walk +x (camera yaw 0: moveX = 1 is +x).
    const ev = run(m, 90, () => [inp({ ...NO_INPUT, moveX: 1 })]);
    expect(ev.some((e) => e.k === 'pickup')).toBe(true);
    m.dispose();
  });

  it('cannot pick up while holding, and the crate is still there', () => {
    const m = playing([0]);
    beside(m, 0, 0);
    run(m, 2);
    const held = m.gadgets.heldBy(0);
    expect(held).not.toBeNull();
    beside(m, 0, 1);
    const ev = run(m, 3);
    expect(ev.some((e) => e.k === 'pickup')).toBe(false);
    expect(m.gadgets.heldBy(0)).toBe(held);
    expect(m.snapshotFor(0).crates & 2).toBe(2);
    m.dispose();
  });

  it('Q (gadget input) uses the held gadget once the cooldown is over, and empties the slot', () => {
    const m = playing([0]);
    beside(m, 0, 0);
    run(m, 2);
    const g = m.gadgets.heldBy(0)!;
    // Too early (cooldown).
    expect(run(m, 1, () => [inp({ ...NO_INPUT, gadget: true })]).some((e) => e.k === 'use')).toBe(
      false,
    );
    expect(m.gadgets.heldBy(0)).toBe(g);
    run(m, 40);
    const ev = run(m, 1, () => [inp({ ...NO_INPUT, gadget: true })]);
    expect(ev).toContainEqual({ k: 'use', p: 0, g });
    expect(m.gadgets.heldBy(0)).toBeNull();
    // Nothing left to use.
    expect(run(m, 1, () => [inp({ ...NO_INPUT, gadget: true })]).some((e) => e.k === 'use')).toBe(
      false,
    );
    m.dispose();
  });

  it('refuses use while toppled or unwound, and outside the playing phase', () => {
    const m = playing([0, 1]);
    beside(m, 0, 0);
    run(m, 45);
    expect(m.gadgets.heldBy(0)).not.toBeNull();
    const w = m.windupOf(0)!;
    w.key.frozen = true;
    expect(
      run(m, 1, (s) => (s === 0 ? [inp({ ...NO_INPUT, gadget: true })] : [])).some(
        (e) => e.k === 'use',
      ),
    ).toBe(false);
    w.key.frozen = false;
    w.receiveBonk([w.position()[0] + 1, 0, w.position()[2]]);
    expect(
      run(m, 1, (s) => (s === 0 ? [inp({ ...NO_INPUT, gadget: true })] : [])).some(
        (e) => e.k === 'use',
      ),
    ).toBe(false);
    expect(m.gadgets.heldBy(0)).not.toBeNull();
    m.dispose();

    const intro = new MatchSim(KITCHEN_TABLE, [0], { ...FAST, introSeconds: 5 }, 5);
    intro.grantGadget(0, 'fan');
    run(intro, 120, () => [inp({ ...NO_INPUT, gadget: true })]);
    expect(intro.gadgets.heldBy(0)).toBe('fan');
    intro.dispose();
  });

  it('a new hole resets crates and held gadgets', () => {
    const m = playing([0], 3);
    m.grantGadget(0, 'gum');
    const cup = m.hole.cup.position;
    m.ballOf(0)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
    for (let i = 0; i < 400 && m.holeIndex === 0; i++) m.tick();
    expect(m.holeIndex).toBe(1);
    expect(m.gadgets.heldBy(0)).toBeNull();
    expect(m.snapshotFor(0).crates).toBe(0b111);
    m.dispose();
  });
});

describe('gadget effects inside a match', () => {
  /** A playing 2-player match with both Windups and A's gadget ready. */
  function setup(g: 'bubble' | 'gum' | 'fan' | 'magnet') {
    const m = playing([0, 1]);
    m.grantGadget(0, g);
    run(m, 40); // cooldown
    return m;
  }
  const useNow = (m: MatchSim) =>
    run(m, 1, (s) => (s === 0 ? [inp({ ...NO_INPUT, gadget: true })] : []));

  it("Bubble: A fires it, it shows up in snapshots, and B's ball ends up trapped and unhittable", () => {
    const m = setup('bubble');
    const w = m.windupOf(0)!;
    w.setPosition([0, 0, 4]);
    w.yaw = 0;
    m.ballOf(1)!.teleport([0, 0.152, -1]);
    const ev = useNow(m);
    expect(ev).toContainEqual({ k: 'use', p: 0, g: 'bubble' });
    expect(m.snapshotFor(1).effects.map((e) => e.kind)).toEqual(['bubble']);
    const trapEvents = run(m, 90).filter((e) => e.k === 'trap');
    expect(trapEvents).toContainEqual({ k: 'trap', p: 1, a: 0 });
    expect(m.snapshotFor(0).players.find((p) => p.slot === 1)!.ball.phase).toBe('trapped');
    expect(m.snapshotFor(0).effects).toHaveLength(0);
    // B stands next to its trapped ball and tries to hit it: refused, no stroke.
    m.windupOf(1)!.setPosition([0.5, 0, -1]);
    run(m, 2);
    run(m, 1, (s) =>
      s === 1 ? [{ seq: ++seq, viewTick: 1e9, entry: toEntry(NO_INPUT, [0, 0, 0.5]) }] : [],
    );
    expect(m.players.get(1)!.round.strokes).toBe(0);
    m.dispose();
  });

  it("Gum: the patch is placed in front of A, slows B's Windup to 40% and stops B's ball", () => {
    const m = setup('gum');
    const a = m.windupOf(0)!;
    a.setPosition([0, 0, 3]);
    a.yaw = 0;
    useNow(m);
    const patch = m.snapshotFor(1).effects[0]!;
    expect(patch.kind).toBe('gum');
    expect(patch.pos[2]).toBeCloseTo(3 - BALANCE.gadgets.gum.placeDistance, 1);
    // B's Windup walks through it at 40% speed.
    const b = m.windupOf(1)!;
    b.setPosition([0, 0, patch.pos[2] + 0.9]);
    const z0 = b.position()[2];
    run(m, 15, (s) => (s === 1 ? [inp({ ...NO_INPUT, moveZ: 1 })] : []));
    const slowed = z0 - b.position()[2];
    b.setPosition([0, 0, -4.5]);
    const z1 = b.position()[2];
    run(m, 15, (s) => (s === 1 ? [inp({ ...NO_INPUT, moveZ: 1 })] : []));
    const free = z1 - b.position()[2];
    expect(slowed / free).toBeLessThan(0.6);
    // B's ball rolls into it and stops dead.
    const ball = m.ballOf(1)!;
    ball.teleport([0, 0.152, patch.pos[2] + 2.5]);
    b.setPosition([1, 0, patch.pos[2] + 2.5]);
    expect(ball.shoot(0, 0.7)).toBe(true);
    const ev = run(m, 90);
    expect(ev).toContainEqual({ k: 'stick', p: 1 });
    expect(ball.state).toBe('resting');
    m.dispose();
  });

  it("Fan: B's Windup in the cone is pushed away without any input, A's is not; B's ball is blown", () => {
    const m = setup('fan');
    const a = m.windupOf(0)!;
    a.setPosition([0, 0, 5]);
    a.yaw = 0;
    const b = m.windupOf(1)!;
    b.setPosition([0, 0, 3]);
    m.ballOf(1)!.teleport([0.3, 0.152, 2.4]);
    useNow(m);
    expect(m.snapshotFor(1).effects.map((e) => e.kind)).toEqual(['fan']);
    run(m, 90, () => [inp()]); // a Windup only moves on ticks where its client sent an input
    expect(b.position()[2]).toBeLessThan(3 - 1.2);
    expect(a.position()[2]).toBeCloseTo(5, 2);
    expect(m.ballOf(1)!.position()[2]).toBeLessThan(2.4 - 0.5);
    run(m, 40);
    expect(m.snapshotFor(1).effects).toHaveLength(0); // the 2 s are over
    m.dispose();
  });

  it("Magnet: shows for 5 s and bends B's moving ball towards A's ball", () => {
    const run2 = (withMagnet: boolean): number => {
      const m = setup('magnet');
      m.ballOf(0)!.teleport([0, 0.152, -3.5]);
      m.ballOf(1)!.teleport([1, 0.152, 1]);
      if (withMagnet) {
        useNow(m);
        expect(m.snapshotFor(1).effects.map((e) => e.kind)).toEqual(['magnet']);
      }
      m.ballOf(1)!.shoot(0, 0.3);
      run(m, 70);
      const x = m.ballOf(1)!.position()[0];
      m.dispose();
      return x;
    };
    expect(run2(true)).toBeLessThan(run2(false) - 0.05);
  });
});
