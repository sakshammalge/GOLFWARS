import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance.js';
import { createRng } from '../rng.js';
import { GadgetInventory } from './inventory.js';
import { GADGETS, gadgetFromId, gadgetId } from './types.js';

const CRATES: [number, number, number][] = [
  [0, 0.3, 0],
  [5, 0.3, 0],
];
const TICKS_20S = 20 * 60;

describe('gadget inventory', () => {
  it('picks up the crate you stand next to, and nothing from far away', () => {
    const inv = new GadgetInventory(CRATES, createRng(1));
    expect(inv.pickup(0, [3, 0, 0], 10)).toBeNull();
    const g = inv.pickup(0, [0.5, 0, 0.2], 10);
    expect(GADGETS).toContain(g);
    expect(inv.heldBy(0)).toBe(g);
    expect(inv.crateMask(10)).toBe(0b10);
  });

  it('holds one gadget: cannot pick up while holding and the crate stays', () => {
    const inv = new GadgetInventory(CRATES, createRng(1));
    const first = inv.pickup(0, [0, 0, 0], 1);
    expect(inv.pickup(0, [5, 0, 0], 2)).toBeNull();
    expect(inv.heldBy(0)).toBe(first);
    expect(inv.crateMask(2)).toBe(0b10); // the second crate was not consumed
    // Another player can take it.
    expect(inv.pickup(1, [5, 0, 0], 3)).not.toBeNull();
  });

  it('a taken crate is empty for 20 s, then respawns', () => {
    const inv = new GadgetInventory(CRATES, createRng(2));
    inv.pickup(0, [0, 0, 0], 100);
    expect(inv.pickup(1, [0, 0, 0], 100 + TICKS_20S - 1)).toBeNull();
    expect(inv.crateMask(100 + TICKS_20S - 1) & 1).toBe(0);
    expect(inv.crateMask(100 + TICKS_20S) & 1).toBe(1);
    expect(inv.pickup(1, [0, 0, 0], 100 + TICKS_20S)).not.toBeNull();
  });

  it('the same seed gives the same gadgets, a different seed a different order', () => {
    const run = (seed: number): string[] => {
      const inv = new GadgetInventory([[0, 0.3, 0]], createRng(seed));
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const tick = i * (TICKS_20S + 1);
        out.push(inv.pickup(0, [0, 0, 0], tick)!);
        inv.take(0, tick + 1000);
      }
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    expect(new Set(run(7)).size).toBeGreaterThan(1);
  });

  it('cannot use without a gadget or during the cooldown; using empties the slot', () => {
    const inv = new GadgetInventory(CRATES, createRng(3));
    expect(inv.take(0, 1000)).toBeNull();
    inv.pickup(0, [0, 0, 0], 100);
    const cd = Math.round(BALANCE.crate.useCooldownSeconds * 60);
    expect(inv.canUse(0, 100 + cd - 1)).toBe(false);
    expect(inv.take(0, 100 + cd - 1)).toBeNull();
    expect(inv.canUse(0, 100 + cd)).toBe(true);
    expect(inv.take(0, 100 + cd)).not.toBeNull();
    expect(inv.heldBy(0)).toBeNull();
    expect(inv.take(0, 100 + cd + 1)).toBeNull();
  });

  it('wire ids round-trip', () => {
    expect(gadgetFromId(gadgetId(null))).toBeNull();
    for (const g of GADGETS) expect(gadgetFromId(gadgetId(g))).toBe(g);
    expect(gadgetFromId(99)).toBeNull();
  });
});
