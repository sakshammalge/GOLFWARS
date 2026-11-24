import { afterEach, describe, expect, it } from 'vitest';
import { BONK, PHYSICS, STAMINA, WINDUP } from './index.js';
import { BALANCE, applyBalanceOverride, resetBalance, setBalanceOverride } from './balance.js';
import { MATCH } from './net/config.js';
import { scoreHole } from './scoring.js';

afterEach(() => resetBalance());

describe('BALANCE', () => {
  it('holds every M4 number and points at the existing configs', () => {
    expect(BALANCE.match).toBe(MATCH);
    expect(BALANCE.physics).toBe(PHYSICS);
    expect(BALANCE.windup).toBe(WINDUP);
    expect(BALANCE.stamina).toBe(STAMINA);
    expect(BALANCE.bonk).toBe(BONK);
    expect(BALANCE.scoring.finishBonus).toEqual([-2, -1]);
    expect(BALANCE.crate).toEqual({
      pickupRadius: 0.9,
      respawnSeconds: 20,
      useCooldownSeconds: 0.5,
    });
    const g = BALANCE.gadgets;
    expect(g.bubble.trapSeconds).toBe(4);
    expect(g.gum).toMatchObject({ radius: 1, lifetime: 20, windupSpeedScale: 0.4 });
    expect(g.fan).toMatchObject({ duration: 2, range: 5, halfAngleDeg: 50 });
    expect(g.magnet).toMatchObject({ duration: 5, range: 4 });
    expect(MATCH).toMatchObject({ introSeconds: 3, holeEndSeconds: 5, holeTimeSeconds: 90 });
  });

  it('applies a partial override to the live objects, including the existing configs', () => {
    const r = applyBalanceOverride({
      gadgets: { fan: { duration: 3 } },
      windup: { walkSpeed: 6 },
      match: { holeTimeSeconds: 30 },
      scoring: { finishBonus: [-3] },
    });
    expect(r.ignored).toEqual([]);
    expect(r.applied).toEqual(
      [
        'match.holeTimeSeconds',
        'scoring.finishBonus',
        'gadgets.fan.duration',
        'windup.walkSpeed',
      ].sort((a, b) => r.applied.indexOf(a) - r.applied.indexOf(b)),
    );
    expect(BALANCE.gadgets.fan.duration).toBe(3);
    expect(BALANCE.gadgets.fan.range).toBe(5); // untouched
    expect(WINDUP.walkSpeed).toBe(6);
    expect(MATCH.holeTimeSeconds).toBe(30);
    // The scoring code reads the table live.
    expect(scoreHole([{ slot: 0, strokes: 3, holedTick: 1 }])[0]!.bonus).toBe(-3);
  });

  it('ignores unknown, non-numeric and locked entries and reports them', () => {
    const r = applyBalanceOverride({
      gadgets: { fan: { duration: 'long', nope: 1 }, laser: { range: 3 } },
      physics: { stepHz: 120 },
      _comment: 'hello',
    });
    expect(r.applied).toEqual([]);
    expect(r.ignored.sort()).toEqual(
      [
        '_comment',
        'gadgets.fan.duration',
        'gadgets.fan.nope',
        'gadgets.laser',
        'physics.stepHz',
      ].sort(),
    );
    expect(PHYSICS.stepHz).toBe(60);
  });

  it('setBalanceOverride replaces the previous override; reset restores the defaults', () => {
    setBalanceOverride({ gadgets: { fan: { duration: 9 } } });
    setBalanceOverride({ gadgets: { magnet: { duration: 8 } } });
    expect(BALANCE.gadgets.fan.duration).toBe(2);
    expect(BALANCE.gadgets.magnet.duration).toBe(8);
    setBalanceOverride({ scoring: { finishBonus: [-5, -4, -3] } });
    expect(BALANCE.scoring.finishBonus).toEqual([-5, -4, -3]);
    resetBalance();
    expect(BALANCE.scoring.finishBonus).toEqual([-2, -1]);
    expect(BALANCE.gadgets.magnet.duration).toBe(5);
  });

  it('survives garbage input', () => {
    for (const bad of [null, 5, 'x', [], undefined]) {
      expect(applyBalanceOverride(bad)).toEqual({ applied: [], ignored: [] });
    }
  });
});
