import { BONK, STAMINA, WINDUP } from './character/config.js';
import { MATCH } from './net/config.js';
import { PHYSICS } from './physics/config.js';

/**
 * Every M4 tuning number (match rules, scoring, crates and the four gadgets) in one object, plus
 * pointers to the existing physics and character configs so a balance pass touches one place.
 * Values are read live (never copied) by the sim, so `applyBalanceOverride` can change them while a
 * dev server runs (see `apps/server/balance.dev.example.json`).
 */
export const BALANCE = {
  /** Match flow timers (intro, hole end, hole timer, timeout penalty). The same object as `MATCH`. */
  match: MATCH,

  scoring: {
    /** Score added for finishing 1st, 2nd, ... to hole out (negative is good). Others get 0. */
    finishBonus: [-2, -1] as number[],
  },

  /** Gadget crates and the one-slot inventory. */
  crate: {
    /** Walking this close (m, horizontal) to a crate picks it up, if the slot is empty. */
    pickupRadius: 0.9,
    /** A picked-up crate comes back after this long (s). */
    respawnSeconds: 20,
    /** Minimum time (s) between getting / using a gadget and using it. */
    useCooldownSeconds: 0.5,
  },

  /** The four gadgets. Times in seconds, distances in metres, accelerations in m/s^2. */
  gadgets: {
    bubble: {
      /** Travel speed of the bubble. */
      speed: 5,
      /** The bubble traps the first ball whose centre comes within radius + ball radius. */
      radius: 0.5,
      /** The bubble pops after this long if it touches nothing (about 20 m of range). */
      lifetime: 4,
      /** How long a trapped ball is frozen and unhittable. */
      trapSeconds: 4,
      /** Where it spawns, in front of the user's feet (m), and how high above the floor. */
      spawnDistance: 1,
      height: 0.4,
    },
    gum: {
      /** Radius of the sticky patch. */
      radius: 1,
      lifetime: 20,
      /** Placed this far in front of the user. */
      placeDistance: 1.6,
      /** Windups inside move at this fraction of their normal speed. */
      windupSpeedScale: 0.4,
    },
    fan: {
      duration: 2,
      /** Reach of the cone and its half angle. */
      range: 5,
      halfAngleDeg: 50,
      /** Ball push (m/s^2, away from the fan, fading to half at full range). */
      ballAccel: 10,
      /** Windup drift speed (m/s, away from the fan, fading to half at full range). */
      windupDrift: 4,
    },
    magnet: {
      duration: 5,
      /** Other players' moving balls within this distance of the magnet ball are pulled in. */
      range: 4,
      /** Pull strength towards the magnet ball (m/s^2): gentle. */
      pullAccel: 3.5,
    },
  },

  /** Existing configs, listed here so one file documents (and can override) every number. */
  physics: PHYSICS,
  windup: WINDUP,
  stamina: STAMINA,
  bonk: BONK,
};

// ------------------------------------------------------------------ overrides

type Json = Record<string, unknown>;

/** A deep copy of every default, taken once at load, so `resetBalance` can restore them. */
const DEFAULTS: Json = JSON.parse(JSON.stringify(BALANCE)) as Json;

/** Keys that must never change at runtime (the sim step is baked into everything). */
const LOCKED = new Set(['physics.stepHz']);

export interface OverrideResult {
  /** Paths that were set, for example `gadgets.fan.duration`. */
  applied: string[];
  /** Paths in the override that do not exist, are not numbers, or are locked. */
  ignored: string[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function walk(target: Json, patch: Json, path: string, out: OverrideResult): void {
  for (const [k, v] of Object.entries(patch)) {
    const p = path ? `${path}.${k}` : k;
    const cur = target[k];
    if (cur === undefined || LOCKED.has(p)) {
      out.ignored.push(p);
    } else if (typeof cur === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) {
        target[k] = v;
        out.applied.push(p);
      } else out.ignored.push(p);
    } else if (Array.isArray(cur)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        cur.splice(0, cur.length, ...(v as number[]));
        out.applied.push(p);
      } else out.ignored.push(p);
    } else if (isObj(cur) && isObj(v)) {
      walk(cur, v, p, out);
    } else out.ignored.push(p);
  }
}

function restore(target: Json, defaults: Json): void {
  for (const [k, d] of Object.entries(defaults)) {
    if (Array.isArray(d))
      (target[k] as number[]).splice(0, (target[k] as number[]).length, ...(d as number[]));
    else if (isObj(d)) restore(target[k] as Json, d);
    else target[k] = d;
  }
}

/** Puts every balance number back to its built-in default. */
export function resetBalance(): void {
  restore(BALANCE as unknown as Json, DEFAULTS);
}

/**
 * Sets the numbers named in `patch` (a partial copy of `BALANCE`, numbers and number arrays only)
 * on top of the current values. Unknown or non-numeric entries are ignored and reported.
 */
export function applyBalanceOverride(patch: unknown): OverrideResult {
  const out: OverrideResult = { applied: [], ignored: [] };
  if (isObj(patch)) walk(BALANCE as unknown as Json, patch, '', out);
  return out;
}

/** The override replaces any earlier one: defaults first, then `patch`. */
export function setBalanceOverride(patch: unknown): OverrideResult {
  resetBalance();
  return applyBalanceOverride(patch);
}
