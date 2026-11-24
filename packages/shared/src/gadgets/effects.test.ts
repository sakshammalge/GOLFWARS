import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALANCE } from '../balance.js';
import { Windup, NO_INPUT, type WindupEnv } from '../character/index.js';
import { PHYSICS, STEP_DT } from '../physics/config.js';
import { Ball, createCourseWorld, initPhysics, type Vec3 } from '../physics/golfSim.js';
import type { GameEvent } from '../protocol.js';
import { GadgetEffects, fanPush, gumScaleAt } from './effects.js';

beforeAll(async () => {
  await initPhysics();
});

const R = PHYSICS.ball.radius;
const HOLE = KITCHEN_TABLE[0]!; // straight felt corridor, x in [-1.6, 1.6], z from 7.5 to -8

/** A course world with gadget effects and one ball per slot, stepped like `MatchSim.tick` does. */
function rig(balls: Record<number, Vec3>) {
  const cw = createCourseWorld(HOLE);
  const bs = new Map<number, Ball>();
  for (const [slot, pos] of Object.entries(balls)) {
    const b = new Ball(cw.world, cw.loaded);
    b.teleport(pos);
    bs.set(Number(slot), b);
  }
  const fx = new GadgetEffects(cw.world);
  const events: GameEvent[] = [];
  let tick = 1;
  return {
    cw,
    balls: bs,
    fx,
    events,
    get tick() {
      return tick;
    },
    step(n = 1) {
      for (let i = 0; i < n; i++, tick++) {
        fx.step(tick, bs, events);
        for (const b of bs.values()) b.prepare();
        cw.world.step();
        for (const b of bs.values()) b.afterStep();
      }
    },
    use(g: Parameters<GadgetEffects['activate']>[0], slot: number, feet: Vec3, yaw: number) {
      fx.activate(g, { slot, feet, yaw }, tick, bs);
    },
    dispose() {
      cw.world.free();
    },
  };
}

/** Rest position of a ball centre on the floor. */
const onFloor = (x: number, z: number): Vec3 => [x, R + 0.002, z];

describe('Bubble Wand', () => {
  it("traps the first ball it touches, even the user's own, for 4 s, then releases it at rest", () => {
    const r = rig({ 0: onFloor(0, 3.0), 1: onFloor(0, -3.0) });
    // User 0 stands at z = 5 facing -z (yaw 0): the bubble flies over its own ball first.
    r.use('bubble', 0, [0, 0, 5], 0);
    let hit = 0;
    while (r.balls.get(0)!.state !== 'trapped' && hit < 120) {
      r.step();
      hit++;
    }
    expect(r.balls.get(0)!.state).toBe('trapped'); // its own ball was in the way
    r.step(10);
    expect(r.balls.get(1)!.state).toBe('resting'); // the bubble is gone: only the first ball
    expect(r.fx.active.filter((e) => e.kind === 'bubble')).toHaveLength(0);
    expect(r.events).toContainEqual({ k: 'trap', p: 0, a: 0 });
    const held = r.balls.get(0)!.position();

    // Frozen and unhittable for the whole trap time.
    expect(r.balls.get(0)!.shoot(0, 1)).toBe(false);
    r.step(Math.round(BALANCE.gadgets.bubble.trapSeconds / STEP_DT) - 10 - 5);
    expect(r.balls.get(0)!.state).toBe('trapped');
    expect(r.balls.get(0)!.position()).toEqual(held);
    expect(r.balls.get(0)!.shoot(0, 1)).toBe(false);
    r.step(10);
    expect(r.balls.get(0)!.state).toBe('resting');
    const after = r.balls.get(0)!.position();
    expect(Math.hypot(after[0] - held[0], after[2] - held[2])).toBeLessThan(0.01);
    expect(r.balls.get(0)!.shoot(0, 0.5)).toBe(true); // hittable again
    r.dispose();
  });

  it("traps another player's ball and counter-play works: a ball hit away in time is missed", () => {
    const r = rig({ 0: onFloor(0.9, 6.5), 1: onFloor(0, -2) });
    r.use('bubble', 0, [0, 0, 5], 0);
    r.step(10);
    // The victim hits its ball sideways before the bubble arrives.
    const b = r.balls.get(1)!;
    expect(b.shoot(Math.PI / 2, 0.3)).toBe(true);
    r.step(130);
    expect(b.state).not.toBe('trapped');
    expect(r.events.some((e) => e.k === 'trap')).toBe(false);
    r.dispose();

    const r2 = rig({ 0: onFloor(0.9, 6.5), 1: onFloor(0, -2) });
    r2.use('bubble', 0, [0, 0, 5], 0);
    r2.step(130);
    expect(r2.balls.get(1)!.state).toBe('trapped');
    expect(r2.events).toContainEqual({ k: 'trap', p: 1, a: 0 });
    r2.dispose();
  });

  it('flies about 5 m/s, pops on a wall and ignores holed balls', () => {
    const r = rig({ 0: onFloor(0, 6.9) });
    r.use('bubble', 0, [0, 0, 5], -Math.PI / 2); // towards +x, into the wall 1.6 m away
    r.step(3);
    const e = r.fx.active.find((x) => x.kind === 'bubble');
    expect(e).toBeDefined();
    expect(e!.pos[0]).toBeGreaterThan(BALANCE.gadgets.bubble.spawnDistance);
    r.step(60);
    expect(r.fx.active.filter((x) => x.kind === 'bubble')).toHaveLength(0);

    const cup = HOLE.cup.position;
    const r2 = rig({ 0: [cup[0], cup[1] + 0.2, cup[2]] });
    r2.step(60);
    expect(r2.balls.get(0)!.state).toBe('holed');
    r2.use('bubble', 1, [cup[0], 0, cup[2] + 2], 0);
    r2.step(120);
    expect(r2.balls.get(0)!.state).toBe('holed');
    r.dispose();
    r2.dispose();
  });

  it('a rolling ball that is trapped hangs in place, then is released with zero speed', () => {
    const r = rig({ 0: onFloor(0, 3), 1: onFloor(0, 6.3) });
    r.balls.get(1)!.shoot(0, 0.5); // rolls -z towards the bubble's path
    r.use('bubble', 0, [0, 0, 6.2], 0);
    r.step(60);
    expect(r.events.some((e) => e.k === 'trap')).toBe(true);
    const trapped = [...r.balls.values()].find((b) => b.state === 'trapped')!;
    expect(trapped).toBeDefined();
    const pos = trapped.position();
    r.step(30);
    expect(trapped.position()).toEqual(pos);
    r.step(Math.round(BALANCE.gadgets.bubble.trapSeconds / STEP_DT));
    expect(trapped.state).not.toBe('trapped');
    expect(trapped.speed()).toBeLessThan(3);
    r.dispose();
  });
});

describe('Gum Blob', () => {
  it('a rolling ball that enters the patch stops dead and rests; it can be hit again from there', () => {
    const r = rig({ 0: onFloor(0, 5), 1: onFloor(0, 6.8) });
    r.use('gum', 1, [0, 0, 6.8], 0); // patch 1.6 m ahead of player 1, centred on z = 5.2
    const patch = r.fx.active.find((e) => e.kind === 'gum')!;
    expect(patch.pos[2]).toBeCloseTo(5.2, 1);
    // A ball is shot from beside the tee through the patch.
    const b = r.balls.get(0)!;
    b.teleport(onFloor(0, 2.8));
    b.shoot(Math.PI, 0.6); // yaw pi = towards +z
    r.step(90);
    expect(r.events).toContainEqual({ k: 'stick', p: 0 });
    expect(b.state).toBe('resting');
    expect(b.speed()).toBeLessThan(0.01);
    const p = b.position();
    expect(Math.hypot(p[0] - patch.pos[0], p[2] - patch.pos[2])).toBeLessThanOrEqual(1.05);
    // Hit again from inside the patch: not caught again on the way out.
    expect(b.shoot(0, 0.5)).toBe(true);
    r.step(60);
    expect(b.position()[2]).toBeLessThan(p[2] - 0.5);
    r.dispose();
  });

  it('is gone after 20 s and only one patch per player exists', () => {
    const r = rig({ 0: onFloor(0, 0) });
    r.use('gum', 1, [0, 0, 6.8], 0);
    r.use('gum', 1, [0, 0, 3.0], 0);
    expect(r.fx.active.filter((e) => e.kind === 'gum')).toHaveLength(1);
    r.use('gum', 2, [0, 0, 1.0], 0);
    expect(r.fx.active.filter((e) => e.kind === 'gum')).toHaveLength(2);
    r.step(20 * 60 - 2);
    expect(r.fx.active.filter((e) => e.kind === 'gum').length).toBeGreaterThan(0);
    r.step(5);
    expect(r.fx.active.filter((e) => e.kind === 'gum')).toHaveLength(0);
    r.dispose();
  });

  it('slows Windups to 40% while they stand in it, user included', () => {
    const cw = createCourseWorld(HOLE);
    const fx = new GadgetEffects(cw.world);
    fx.activate('gum', { slot: 0, feet: [0, 0, 5], yaw: 0 }, 1, new Map());
    const walk = (z0: number): number => {
      const w = new Windup(1, cw.world, cw.loaded, [0, 0, z0]);
      let env: WindupEnv;
      const t0 = w.position()[2];
      for (let i = 0; i < 30; i++) {
        env = fx.windupEnv(1, w.position());
        w.step({ ...NO_INPUT, moveZ: 1 }, env);
      }
      const d = t0 - w.position()[2];
      w.dispose();
      return d;
    };
    const inside = walk(3.4); // patch centre z = 3.4, walking -z for 0.5 s stays inside (r = 1)
    const outside = walk(-3);
    expect(inside / outside).toBeGreaterThan(0.3);
    expect(inside / outside).toBeLessThan(0.5);
    expect(gumScaleAt(fx.active, [0, 0, 3.4])).toBe(0.4);
    expect(gumScaleAt(fx.active, [0, 0, 1.0])).toBe(1);
    expect(gumScaleAt(fx.active, [0, 3, 3.4])).toBe(1); // jumping over it
    cw.world.free();
  });
});

describe('Desk Fan', () => {
  it('pushes balls in the cone away from the fan, not those behind it or out of range', () => {
    const r = rig({ 0: onFloor(0, 3), 1: onFloor(0, 7), 2: onFloor(0, -4.5) });
    r.use('fan', 9, [0, 0, 5], 0); // faces -z; ball 0 is 2 m ahead, ball 1 behind, ball 2 is 9.5 m ahead
    r.step(60);
    expect(r.balls.get(0)!.position()[2]).toBeLessThan(2.5); // blown further away (towards -z)
    expect(r.balls.get(1)!.state).toBe('resting');
    expect(r.balls.get(1)!.position()[2]).toBeCloseTo(7, 1);
    expect(r.balls.get(2)!.state).toBe('resting');
    r.dispose();
  });

  it('the cone is 50 degrees to each side with 5 m of range, and lasts 2 s', () => {
    const origin: Vec3 = [0, 0, 0];
    expect(fanPush(origin, 0, [0, 0, -4.9])).not.toBeNull();
    expect(fanPush(origin, 0, [0, 0, -5.1])).toBeNull();
    // 40 degrees off the axis at 3 m is inside, 60 degrees is outside.
    const at = (deg: number, d: number): Vec3 => [
      -Math.sin((deg * Math.PI) / 180) * d,
      0,
      -Math.cos((deg * Math.PI) / 180) * d,
    ];
    expect(fanPush(origin, 0, at(40, 3))).not.toBeNull();
    expect(fanPush(origin, 0, at(60, 3))).toBeNull();
    expect(fanPush(origin, 0, [0, 0, 3])).toBeNull(); // behind
    const push = fanPush(origin, 0, at(0, 2.5))!;
    expect(push.dir[1]).toBeCloseTo(-1, 5);
    expect(push.falloff).toBeCloseTo(0.75, 5);

    const r = rig({ 0: onFloor(0, 0) });
    r.use('fan', 1, [0, 0, 2], 0);
    r.step(119);
    expect(r.fx.active.filter((e) => e.kind === 'fan')).toHaveLength(1);
    r.step(2);
    expect(r.fx.active.filter((e) => e.kind === 'fan')).toHaveLength(0);
    r.dispose();
  });

  it('drifts other Windups away but never its owner', () => {
    const cw = createCourseWorld(HOLE);
    const fx = new GadgetEffects(cw.world);
    fx.activate('fan', { slot: 0, feet: [0, 0, 5], yaw: 0 }, 1, new Map());
    const victim = new Windup(1, cw.world, cw.loaded, [0, 0, 3]);
    const owner = new Windup(0, cw.world, cw.loaded, [0, 0, 3]);
    for (let i = 0; i < 60; i++) {
      victim.step(NO_INPUT, fx.windupEnv(1, victim.position()));
      owner.step(NO_INPUT, fx.windupEnv(0, owner.position()));
    }
    expect(victim.position()[2]).toBeLessThan(3 - 1.5); // pushed away from the fan
    expect(owner.position()[2]).toBeCloseTo(3, 3);
    expect(victim.velocity()[2]).toBeCloseTo(0, 6); // displacement, not velocity: it stops when the wind does
    cw.world.free();
  });
});

describe('Fridge Magnet', () => {
  /** Where a ball shot along +z at (x0, z0) is after `n` ticks, with or without the magnet. */
  function curve(withMagnet: boolean, startZ = 0, magnetZ = -3.5): { x: number; ball: Ball } {
    const r = rig({ 0: onFloor(0.0, magnetZ), 1: onFloor(1.0, startZ) });
    if (withMagnet) r.use('magnet', 0, [0, 0, magnetZ + 0.8], 0);
    r.balls.get(1)!.shoot(0, 0.3); // slow roll along -z, passing the magnet ball at 1 m
    r.step(70);
    return { x: r.balls.get(1)!.position()[0], ball: r.balls.get(1)! };
  }

  it("gently bends other players' moving balls towards the magnet ball", () => {
    const plain = curve(false);
    const pulled = curve(true);
    expect(pulled.x).toBeLessThan(plain.x - 0.05); // closer to x = 0 (the magnet ball)
    expect(pulled.x).toBeGreaterThan(-1); // gentle: it did not slingshot across
  });

  it("does not touch resting balls, balls out of range, or the user's own ball", () => {
    const r = rig({ 0: onFloor(0, 2), 1: onFloor(1.5, 2), 2: onFloor(0, 7) });
    r.use('magnet', 0, [0, 0, 3], 0);
    r.step(120);
    expect(r.balls.get(1)!.position()[0]).toBeCloseTo(1.5, 2);
    expect(r.balls.get(1)!.state).toBe('resting');
    // Own moving ball is not pulled to itself; far ball (7 m) rolling past is out of range.
    const far = r.balls.get(2)!;
    far.shoot(Math.PI / 2, 0.2); // towards -x... stays far from the magnet ball
    r.step(40);
    expect(far.position()[2]).toBeGreaterThan(6.5);
    r.dispose();
  });

  it('lasts 5 s', () => {
    const r = rig({ 0: onFloor(0, 0) });
    r.use('magnet', 0, [0, 0, 1], 0);
    r.step(5 * 60 - 1);
    expect(r.fx.active.some((e) => e.kind === 'magnet')).toBe(true);
    r.step(2);
    expect(r.fx.active.some((e) => e.kind === 'magnet')).toBe(false);
    r.dispose();
  });
});
