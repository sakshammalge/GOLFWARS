import { describe, expect, it } from 'vitest';
import { STAMINA } from './config.js';
import { canJump, canSprint, createKey, drainKey, isNearPost, stepKey } from './stamina.js';

const DT = 1 / 60;
const none = { sprinting: false, jumped: false, idle: false, nearPost: false };

function run(s: ReturnType<typeof createKey>, seconds: number, input: Partial<typeof none>): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepKey(s, { ...none, ...input }, DT);
}

describe('wind-up key', () => {
  it('starts full and unfrozen', () => {
    expect(createKey()).toEqual({ key: 1, frozen: false });
  });

  it('drains while sprinting at the configured rate', () => {
    const s = createKey();
    run(s, 2, { sprinting: true });
    expect(s.key).toBeCloseTo(1 - 2 * STAMINA.sprintDrain, 2);
  });

  it('walking neither drains nor rewinds', () => {
    const s = createKey();
    s.key = 0.5;
    run(s, 3, {});
    expect(s.key).toBeCloseTo(0.5, 6);
  });

  it('a jump costs a chunk', () => {
    const s = createKey();
    stepKey(s, { ...none, jumped: true }, DT);
    expect(s.key).toBeCloseTo(1 - STAMINA.jumpCost, 6);
  });

  it('rewinds slowly when idle and fast next to a winding post, never above 1', () => {
    const slow = createKey();
    slow.key = 0.2;
    run(slow, 2, { idle: true });
    expect(slow.key).toBeCloseTo(0.2 + 2 * STAMINA.idleRewind, 2);

    const fast = createKey();
    fast.key = 0.2;
    run(fast, 1, { idle: true, nearPost: true });
    expect(fast.key).toBeCloseTo(0.2 + STAMINA.postRewind, 2);
    expect(fast.key).toBeGreaterThan(slow.key);
    run(fast, 5, { idle: true, nearPost: true });
    expect(fast.key).toBe(1);
  });

  it('a post does not help a Windup that is not standing still', () => {
    const s = createKey();
    s.key = 0.3;
    run(s, 2, { nearPost: true });
    expect(s.key).toBeCloseTo(0.3, 6);
  });

  it('freezes at zero and stays frozen until the unfreeze threshold', () => {
    const s = createKey();
    run(s, 6, { sprinting: true });
    expect(s.key).toBe(0);
    expect(s.frozen).toBe(true);
    expect(canSprint(s)).toBe(false);
    expect(canJump(s)).toBe(false);

    // Rewinding a little is not enough...
    run(s, 1, { idle: true });
    expect(s.key).toBeLessThan(STAMINA.unfreezeAt);
    expect(s.frozen).toBe(true);
    // ...until the key passes the threshold.
    run(s, 4, { idle: true });
    expect(s.key).toBeGreaterThanOrEqual(STAMINA.unfreezeAt);
    expect(s.frozen).toBe(false);
    expect(canSprint(s)).toBe(true);
  });

  it('cannot jump with less key than a jump costs', () => {
    const s = createKey();
    s.key = STAMINA.jumpCost - 0.01;
    expect(canJump(s)).toBe(false);
    s.key = STAMINA.jumpCost;
    expect(canJump(s)).toBe(true);
  });

  it('drainKey (bonk) clamps at 0 and freezes', () => {
    const s = createKey();
    drainKey(s, 0.4);
    expect(s.key).toBeCloseTo(0.6, 6);
    expect(s.frozen).toBe(false);
    drainKey(s, 5);
    expect(s.key).toBe(0);
    expect(s.frozen).toBe(true);
  });

  it('detects posts by horizontal distance', () => {
    const posts = [[2, 0.6, -3]];
    expect(isNearPost(posts, 2 + STAMINA.postRadius - 0.1, -3)).toBe(true);
    expect(isNearPost(posts, 2 + STAMINA.postRadius + 0.1, -3)).toBe(false);
    expect(isNearPost([], 0, 0)).toBe(false);
  });
});
