import { BONK, WINDUP } from './config.js';

/**
 * Club-bonk state of one Windup (pure data + functions, no physics). Swinging starts a short
 * cooldown; while the swing's hit window is open the caller checks `inHitbox` against the other
 * Windups and calls `topple` on those it hits. Swings never affect balls.
 */
export interface BonkState {
  /** Seconds since the swing started, or null when not swinging. */
  swingT: number | null;
  /** Seconds until the next swing may start (counted from the start of the last one). */
  cooldown: number;
  /** Seconds of being toppled left (no control while > 0). */
  toppleT: number;
  /** Seconds of bonk immunity left; starts when the Windup gets back up. */
  immuneT: number;
  /** Ids already hit by the current swing (one hit per swing per victim). */
  hit: number[];
}

export function createBonk(): BonkState {
  return { swingT: null, cooldown: 0, toppleT: 0, immuneT: 0, hit: [] };
}

export const isToppled = (b: BonkState): boolean => b.toppleT > 0;
export const isSwinging = (b: BonkState): boolean => b.swingT !== null;

/** A swing may start when off cooldown, standing up, not already swinging and not frozen. */
export function canSwing(b: BonkState, frozen: boolean): boolean {
  return !frozen && b.cooldown <= 0 && b.toppleT <= 0 && b.swingT === null;
}

export function startSwing(b: BonkState): void {
  b.swingT = 0;
  b.cooldown = BONK.cooldown;
  b.hit = [];
}

/** True while the club can actually hit things (a slice in the middle of the swing). */
export function hitWindowOpen(b: BonkState): boolean {
  return b.swingT !== null && b.swingT >= BONK.hitStart && b.swingT <= BONK.hitEnd;
}

/** Normalised swing progress 0..1 (for animation), or null when not swinging. */
export function swingProgress(b: BonkState): number | null {
  return b.swingT === null ? null : Math.min(1, b.swingT / BONK.swingDuration);
}

/** A victim must be standing and not immune. */
export function canBeBonked(b: BonkState): boolean {
  return b.toppleT <= 0 && b.immuneT <= 0;
}

/** Topples the victim: no control for `toppleSeconds`, any swing in progress is cancelled. */
export function topple(b: BonkState): void {
  b.toppleT = BONK.toppleSeconds;
  b.swingT = null;
  b.immuneT = 0;
}

/** Advances all timers by `dt`. Returns true on the step the Windup finishes getting back up. */
export function stepBonk(b: BonkState, dt: number): boolean {
  b.cooldown = Math.max(0, b.cooldown - dt);
  let gotUp = false;
  if (b.toppleT > 0) {
    b.toppleT -= dt;
    if (b.toppleT <= 0) {
      b.toppleT = 0;
      b.immuneT = BONK.immunitySeconds;
      gotUp = true;
    }
  } else if (b.immuneT > 0) {
    b.immuneT = Math.max(0, b.immuneT - dt);
  }
  if (b.swingT !== null) {
    b.swingT += dt;
    if (b.swingT >= BONK.swingDuration) b.swingT = null;
  }
  return gotUp;
}

/**
 * Is the victim inside the attacker's arc? Positions are feet positions [x, y, z]; `yaw` is the
 * attacker's facing (0 = towards -z). The victim counts as a disc of `WINDUP.radius`.
 */
export function inHitbox(
  attacker: readonly number[],
  yaw: number,
  victim: readonly number[],
): boolean {
  if (Math.abs(victim[1]! - attacker[1]!) > BONK.height) return false;
  const dx = victim[0]! - attacker[0]!;
  const dz = victim[2]! - attacker[2]!;
  const dist = Math.hypot(dx, dz);
  if (dist - WINDUP.radius > BONK.range) return false;
  if (dist < WINDUP.radius) return true; // overlapping: always inside
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / dist;
  // Widen the angle by the victim's apparent size so near targets are not missed on the edge.
  const half = (BONK.halfAngleDeg * Math.PI) / 180 + Math.asin(Math.min(1, WINDUP.radius / dist));
  return cos >= Math.cos(half);
}
