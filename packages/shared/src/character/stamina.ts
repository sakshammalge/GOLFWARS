import { STAMINA } from './config.js';

/** The wind-up key. `key` is 0..1; `frozen` is set at 0 and cleared once rewound to the threshold. */
export interface KeyState {
  key: number;
  frozen: boolean;
}

export interface KeyInput {
  /** Running with Shift while actually trying to move. */
  sprinting: boolean;
  /** A jump left the ground this step. */
  jumped: boolean;
  /** Standing still (no move input, not moving), so the key can rewind. */
  idle: boolean;
  /** Within the rewind radius of a Winding Post. */
  nearPost: boolean;
}

export function createKey(): KeyState {
  return { key: 1, frozen: false };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Whether a sprint may continue / start. */
export function canSprint(s: KeyState): boolean {
  return !s.frozen && s.key > 0;
}

/** Whether a jump may start (it costs a chunk, so the key must cover it). */
export function canJump(s: KeyState): boolean {
  return !s.frozen && s.key >= STAMINA.jumpCost;
}

/** Removes `amount` of key (a bonk, say); freezes at 0. */
export function drainKey(s: KeyState, amount: number): void {
  s.key = clamp01(s.key - amount);
  if (s.key <= 0) s.frozen = true;
}

/** True when a Windup standing at (x, z) is within rewind range of any of the posts. */
export function isNearPost(posts: readonly (readonly number[])[], x: number, z: number): boolean {
  const r2 = STAMINA.postRadius * STAMINA.postRadius;
  return posts.some((p) => (p[0]! - x) ** 2 + (p[2]! - z) ** 2 <= r2);
}

/** Advances the key by `dt` seconds. Sprinting drains, a jump costs a chunk, standing rewinds. */
export function stepKey(s: KeyState, input: KeyInput, dt: number): void {
  if (input.jumped) s.key = clamp01(s.key - STAMINA.jumpCost);
  if (input.sprinting) s.key = clamp01(s.key - STAMINA.sprintDrain * dt);
  else if (input.idle) {
    const rate = input.nearPost ? STAMINA.postRewind : STAMINA.idleRewind;
    s.key = clamp01(s.key + rate * dt);
  }
  if (s.key <= 0) s.frozen = true;
  else if (s.frozen && s.key >= STAMINA.unfreezeAt) s.frozen = false;
}
