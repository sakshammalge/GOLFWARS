import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../physics/golfSim.js';
import { MATCH, type MatchConfig } from '../net/config.js';
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
