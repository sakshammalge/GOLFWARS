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

  /** Existing configs, listed here so one file documents (and can override) every number. */
  physics: PHYSICS,
  windup: WINDUP,
  stamina: STAMINA,
  bonk: BONK,
};
