import { describe, expect, it } from 'vitest';
import {
  canBeBonked,
  canSwing,
  createBonk,
  hitWindowOpen,
  inHitbox,
  isSwinging,
  isToppled,
  startSwing,
  stepBonk,
  topple,
} from './bonk.js';
import { BONK } from './config.js';

const DT = 1 / 60;
const tick = (b: ReturnType<typeof createBonk>, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepBonk(b, DT);
};

describe('bonk state', () => {
  it('a swing opens a hit window in the middle of the swing only', () => {
    const b = createBonk();
    expect(canSwing(b, false)).toBe(true);
    startSwing(b);
    expect(isSwinging(b)).toBe(true);
    expect(hitWindowOpen(b)).toBe(false); // wind-up
    tick(b, BONK.hitStart + 0.02);
    expect(hitWindowOpen(b)).toBe(true);
    tick(b, BONK.hitEnd - BONK.hitStart);
    expect(hitWindowOpen(b)).toBe(false); // follow-through
    tick(b, BONK.swingDuration);
    expect(isSwinging(b)).toBe(false);
  });

  it('the attacker cannot swing again until the cooldown has passed', () => {
    const b = createBonk();
    startSwing(b);
    tick(b, BONK.swingDuration + 0.05); // swing over, still cooling down
    expect(canSwing(b, false)).toBe(false);
    tick(b, BONK.cooldown - BONK.swingDuration - 0.05 - 0.02);
    expect(canSwing(b, false)).toBe(false);
    tick(b, 0.05);
    expect(canSwing(b, false)).toBe(true);
  });

  it('cannot swing while frozen or toppled', () => {
    const b = createBonk();
    expect(canSwing(b, true)).toBe(false);
    topple(b);
    expect(canSwing(b, false)).toBe(false);
  });

  it('topple lasts 1.5 s, then grants 2 s of immunity', () => {
    const b = createBonk();
    expect(canBeBonked(b)).toBe(true);
    topple(b);
    expect(isToppled(b)).toBe(true);
    expect(canBeBonked(b)).toBe(false);
    tick(b, BONK.toppleSeconds - 0.05);
    expect(isToppled(b)).toBe(true);
    tick(b, 0.1);
    expect(isToppled(b)).toBe(false);
    expect(canBeBonked(b)).toBe(false); // immune
    tick(b, BONK.immunitySeconds - 0.2);
    expect(canBeBonked(b)).toBe(false);
    tick(b, 0.3);
    expect(canBeBonked(b)).toBe(true);
  });

  it('stepBonk reports the step on which the Windup gets up', () => {
    const b = createBonk();
    topple(b);
    let gotUp = 0;
    for (let i = 0; i < 120; i++) if (stepBonk(b, DT)) gotUp++;
    expect(gotUp).toBe(1);
  });

  it('being toppled cancels a swing in progress', () => {
    const b = createBonk();
    startSwing(b);
    topple(b);
    expect(isSwinging(b)).toBe(false);
  });
});

describe('bonk hitbox', () => {
  const me = [0, 0, 0];
  it('hits a Windup in front within range, using yaw 0 = towards -z', () => {
    expect(inHitbox(me, 0, [0, 0, -1.2])).toBe(true);
    expect(inHitbox(me, 0, [0, 0, 1.2])).toBe(false); // behind
    expect(inHitbox(me, Math.PI / 2, [-1.2, 0, 0])).toBe(true); // yaw 90 deg faces -x
  });

  it('misses targets too far, too far off-axis or at a different height', () => {
    expect(inHitbox(me, 0, [0, 0, -3])).toBe(false);
    expect(inHitbox(me, 0, [1.4, 0, -0.1])).toBe(false);
    expect(inHitbox(me, 0, [0, 2, -1])).toBe(false);
  });

  it('is an arc: off-axis targets within the half angle are hit', () => {
    const a = (50 * Math.PI) / 180;
    expect(inHitbox(me, 0, [-Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2])).toBe(true);
  });
});
