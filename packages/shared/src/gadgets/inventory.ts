import type { Vec3 } from '../physics/golfSim.js';
import { STEP_DT } from '../physics/config.js';
import { BALANCE } from '../balance.js';
import { GADGETS, type GadgetType } from './types.js';

interface CrateState {
  pos: Vec3;
  /** Tick from which the crate can be picked up again. */
  availableAt: number;
}

interface Held {
  gadget: GadgetType;
  /** First tick at which the gadget may be used. */
  readyTick: number;
}

const secondsToTicks = (s: number): number => Math.max(1, Math.round(s / STEP_DT));

/**
 * Crates and the one-slot gadget inventory of one hole (pure, deterministic: the random gadget
 * comes from the match's seeded RNG). A crate is a pickup, not a collider: a Windup that walks
 * within `pickupRadius` of an available crate while its slot is empty takes it and the crate
 * respawns after `respawnSeconds`. Using a gadget is validated here (holding one, cooldown) and by
 * the caller (hole in play, Windup on its feet).
 */
export class GadgetInventory {
  readonly crates: CrateState[];
  private readonly held = new Map<number, Held>();

  constructor(
    cratePositions: readonly Vec3[],
    private readonly rng: () => number,
  ) {
    this.crates = cratePositions.map((pos) => ({ pos: [...pos], availableAt: 0 }));
  }

  heldBy(slot: number): GadgetType | null {
    return this.held.get(slot)?.gadget ?? null;
  }

  /** Bit i set = crate i can be picked up right now. */
  crateMask(tick: number): number {
    let m = 0;
    this.crates.forEach((c, i) => {
      if (tick >= c.availableAt) m |= 1 << i;
    });
    return m;
  }

  /** Gives `slot` a gadget directly (tests and the dev cheat hook). */
  grant(slot: number, gadget: GadgetType, tick: number): void {
    this.held.set(slot, {
      gadget,
      readyTick: tick + secondsToTicks(BALANCE.crate.useCooldownSeconds),
    });
  }

  /** Walks `slot` into any crate in reach. Returns the gadget it picked up, if any. */
  pickup(slot: number, feet: Vec3, tick: number): GadgetType | null {
    if (this.held.has(slot)) return null;
    for (const c of this.crates) {
      if (tick < c.availableAt) continue;
      if (Math.hypot(c.pos[0] - feet[0], c.pos[2] - feet[2]) > BALANCE.crate.pickupRadius) continue;
      if (Math.abs(c.pos[1] - feet[1]) > 1.5) continue;
      const gadget =
        GADGETS[Math.min(GADGETS.length - 1, Math.floor(this.rng() * GADGETS.length))]!;
      c.availableAt = tick + secondsToTicks(BALANCE.crate.respawnSeconds);
      this.grant(slot, gadget, tick);
      return gadget;
    }
    return null;
  }

  /** Holding a gadget and the cooldown is over. */
  canUse(slot: number, tick: number): boolean {
    const h = this.held.get(slot);
    return h !== undefined && tick >= h.readyTick;
  }

  /** Takes the gadget out of the slot (when `canUse`), returning it. */
  take(slot: number, tick: number): GadgetType | null {
    if (!this.canUse(slot, tick)) return null;
    const g = this.held.get(slot)!.gadget;
    this.held.delete(slot);
    return g;
  }

  /** The slot is dropped (player left the match). */
  clear(slot: number): void {
    this.held.delete(slot);
  }
}
