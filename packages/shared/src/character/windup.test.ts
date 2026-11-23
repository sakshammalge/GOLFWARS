import { beforeAll, describe, expect, it } from 'vitest';
import { KITCHEN_TABLE, parseHole, type Hole, type HoleInput } from '@golfwars/courses';
import { GolfSim, initPhysics } from '../physics/golfSim.js';
import { STEP_DT } from '../physics/config.js';
import { BONK, STAMINA, WINDUP } from './config.js';
import { NO_INPUT, Windup, inBallReach, resolveBonks, type WindupInput } from './windup.js';

beforeAll(async () => {
  await initPhysics();
});

type Vec3 = [number, number, number];
const input = (o: Partial<WindupInput>): WindupInput => ({ ...NO_INPUT, ...o });

function spawn(sim: GolfSim, id = 1, at?: Vec3): Windup {
  const w = new Windup(id, sim.world, sim.loaded, at ?? [0, 0, 0]);
  if (!at) w.respawnNear(sim.position(), 0);
  return w;
}

function runFor(sim: GolfSim, ws: Windup[], seconds: number, make: () => WindupInput): void {
  for (let i = 0; i < Math.round(seconds / STEP_DT); i++) {
    for (const w of ws) w.step(make());
    resolveBonks(ws);
    sim.step();
  }
}

/** Walks towards a world point with a simple steering loop; returns true if it got within `tol`. */
function walkTo(
  sim: GolfSim,
  w: Windup,
  target: [number, number],
  opts: { tol?: number; seconds?: number; sprint?: boolean } = {},
): boolean {
  const { tol = 0.35, seconds = 12, sprint = false } = opts;
  for (let i = 0; i < Math.round(seconds / STEP_DT); i++) {
    const p = w.position();
    const dx = target[0] - p[0];
    const dz = target[1] - p[2];
    if (Math.hypot(dx, dz) < tol) return true;
    // camera yaw 0: forward = -z, right = +x
    const len = Math.hypot(dx, dz);
    w.step(input({ moveX: dx / len, moveZ: -dz / len, sprint }));
    sim.step();
  }
  return false;
}

function customHole(pieces: HoleInput['pieces']): Hole {
  return parseHole({
    id: 'test',
    name: 'Test',
    par: 2,
    tee: [0, 0, 8],
    pieces: [
      { type: 'floor', position: [0, -0.2, 6], size: [6, 0.4, 8] },
      { type: 'cup', position: [0, -0.2, -6], size: [6, 0.4, 4] },
      ...pieces,
    ],
    cup: { position: [0, 0, -6] },
  });
}

describe('character controller', () => {
  it('runs relative to the camera, sprints faster, and stands on the floor', () => {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    const w = spawn(sim);
    runFor(sim, [w], 0.5, () => NO_INPUT);
    expect(w.onGround).toBe(true);
    expect(w.position()[1]).toBeCloseTo(0, 1);

    const p0 = w.position();
    runFor(sim, [w], 1, () => input({ moveZ: 1 })); // forward with yaw 0 = -z
    const p1 = w.position();
    expect(p0[2] - p1[2]).toBeGreaterThan(3);
    expect(Math.abs(p1[0] - p0[0])).toBeLessThan(0.05);

    // Camera turned 90 deg left (yaw +90): forward is now -x.
    runFor(sim, [w], 0.5, () => input({ moveZ: 1, cameraYaw: Math.PI / 2 }));
    expect(w.position()[0]).toBeLessThan(p1[0] - 0.3);

    const walk = spawn(sim, 2, [0.6, 0, 4]);
    const sprint = spawn(sim, 3, [-0.6, 0, 4]);
    runFor(sim, [walk, sprint], 0.3, () => NO_INPUT);
    const w0 = walk.position()[2];
    const s0 = sprint.position()[2];
    for (let i = 0; i < 60; i++) {
      walk.step(input({ moveZ: 1 }));
      sprint.step(input({ moveZ: 1, sprint: true }));
      sim.step();
    }
    expect(s0 - sprint.position()[2]).toBeGreaterThan((w0 - walk.position()[2]) * 1.4);
    sim.dispose();
  });

  it('jumps about 1 m high and costs key', () => {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    const w = spawn(sim);
    runFor(sim, [w], 0.3, () => NO_INPUT);
    const y0 = w.position()[1];
    let top = y0;
    let jumped = false;
    let keyAfterJump = 1;
    for (let i = 0; i < 90; i++) {
      const ev = w.step(input({ jump: i === 0 }));
      if (ev.jumped) keyAfterJump = w.key.key;
      jumped ||= ev.jumped;
      sim.step();
      top = Math.max(top, w.position()[1]);
    }
    expect(jumped).toBe(true);
    expect(top - y0).toBeGreaterThan(0.9);
    expect(top - y0).toBeLessThan(1.2);
    expect(w.onGround).toBe(true);
    expect(keyAfterJump).toBeCloseTo(1 - STAMINA.jumpCost, 3);
    sim.dispose();
  });

  it('walks up slopes of 40 degrees and steps over small ledges, but not tall ones', () => {
    const hole = customHole([
      // 40 degree ramp, 3 m long, uphill towards -z (rotation 180 makes local +z point to -z)
      { type: 'ramp', position: [0, 0.96, 1.2], rotation: 180, size: [3, 0.3, 3], slope: 40 },
      { type: 'floor', position: [-2.4, 0.15, 4], size: [0.5, 0.3, 0.5] }, // 0.3 ledge top at 0.3
      { type: 'floor', position: [2.4, 0.3, 4], size: [0.5, 0.6, 0.5] }, // 0.6 ledge: too tall
    ]);
    const sim = new GolfSim(hole);
    const w = new Windup(1, sim.world, sim.loaded, [0, 0, 4.5]);
    sim.step();
    expect(walkTo(sim, w, [0, 1.2], { seconds: 6 })).toBe(true);
    expect(w.position()[1]).toBeGreaterThan(0.8); // climbed the ramp

    const small = new Windup(2, sim.world, sim.loaded, [-2.4, 0, 5.6]);
    sim.step();
    expect(walkTo(sim, small, [-2.4, 4], { seconds: 3, tol: 0.15 })).toBe(true);
    expect(small.position()[1]).toBeCloseTo(0.3, 1); // stepped on top

    const tall = new Windup(3, sim.world, sim.loaded, [2.4, 0, 5.6]);
    sim.step();
    walkTo(sim, tall, [2.4, 4], { seconds: 2, tol: 0.1 });
    expect(tall.position()[1]).toBeLessThan(0.1); // blocked
    expect(tall.position()[2]).toBeGreaterThan(4.5);
    sim.dispose();
  });

  it('falling off the course raises `fell`, and respawnNear puts it back by the ball', () => {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    const w = spawn(sim);
    let fell = false;
    for (let i = 0; i < 240 && !fell; i++) {
      fell = w.step(input({ moveX: 1 })).fell; // run to the right, off the 3.2 m wide floor? walls block
      sim.step();
    }
    expect(fell).toBe(false); // walls keep it on the table

    w.setPosition([0, -3, 0]);
    expect(w.step().fell).toBe(true);
    const ball = sim.position();
    const spot = w.respawnNear(ball, 0);
    expect(Math.hypot(spot[0] - ball[0], spot[2] - ball[2])).toBeLessThan(1.6);
    expect(w.step().fell).toBe(false);
    sim.dispose();
  });

  it('is invisible to the ball: walking into it does not move it and it still comes to rest', () => {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    for (let i = 0; i < 60; i++) sim.step(); // let the ball settle on the tee
    const ball0 = sim.position();
    const w = new Windup(1, sim.world, sim.loaded, [ball0[0], 0, ball0[2] + 1.5]);
    sim.step();
    runFor(sim, [w], 2, () => input({ moveZ: 1 })); // walks straight through the ball
    const b = sim.position();
    expect(Math.hypot(b[0] - ball0[0], b[2] - ball0[2])).toBeLessThan(0.01);
    expect(w.position()[2]).toBeLessThan(ball0[2] - 1);
    expect(sim.state).toBe('resting');

    // Standing under a rolling ball must not stop it from resting (rest rays ignore Windups).
    sim.shoot(0, 0.3);
    runFor(sim, [], 12, () => NO_INPUT);
    expect(sim.state).toBe('resting');
    sim.dispose();
  });

  it('inBallReach: within 1 m (XZ) only', () => {
    expect(inBallReach([0, 0, 0], [0.9, 0.15, 0])).toBe(true);
    expect(inBallReach([0, 0, 0], [1.1, 0.15, 0])).toBe(false);
  });
});

describe('all three holes are traversable without getting stuck', () => {
  // Waypoints from the tee area to the cup, around bumpers and through the dogleg / over the ramp.
  const routes: [number, number][][] = [
    [[0, -6.5]],
    [
      [0, -2.5],
      [-3, -3],
      [-6.5, -3],
      [-8.7, -3],
      [-11, -3],
    ],
    [
      [-0.8, 3.5],
      [-0.8, 0.9],
      [-1, -0.9],
      [-1, -2.6],
      [0, -2.8],
      [0, -5.2],
      [0, -7],
    ],
  ];

  routes.forEach((route, i) => {
    it(`hole ${i + 1}: tee to cup`, () => {
      const sim = new GolfSim(KITCHEN_TABLE[i]!);
      const w = spawn(sim);
      for (const wp of route) expect(walkTo(sim, w, wp, { sprint: true, seconds: 15 })).toBe(true);
      const cup = KITCHEN_TABLE[i]!.cup.position;
      expect(Math.hypot(w.position()[0] - cup[0], w.position()[2] - cup[2])).toBeLessThan(0.8);
      sim.dispose();
    });

    it(`hole ${i + 1}: pushing into walls and bumpers from every direction never traps it`, () => {
      const hole = KITCHEN_TABLE[i]!;
      for (let k = 0; k < 8; k++) {
        const sim = new GolfSim(hole);
        const w = spawn(sim);
        const a = (k * Math.PI) / 4;
        runFor(sim, [w], 3, () => input({ moveX: Math.sin(a), moveZ: Math.cos(a), sprint: true }));
        const stuckAt = w.position();
        runFor(sim, [w], 1, () => input({ moveX: -Math.sin(a), moveZ: -Math.cos(a) }));
        const p = w.position();
        expect(w.position()[1]).toBeGreaterThan(-0.5); // still on the course
        expect(Math.hypot(p[0] - stuckAt[0], p[2] - stuckAt[2])).toBeGreaterThan(0.5);
        sim.dispose();
      }
    });
  });

  it('winding posts on holes 2 and 3 are solid and the Windup slides around them', () => {
    for (const [i, from, to] of [
      [1, [0.7, 0, 2.2], [0.7, -0.5]],
      [2, [-2.1, 0, 5.5], [-2.1, 1.5]],
    ] as const) {
      const sim = new GolfSim(KITCHEN_TABLE[i]!);
      const w = new Windup(1, sim.world, sim.loaded, [...from] as Vec3);
      sim.step();
      expect(walkTo(sim, w, [to[0], to[1]], { seconds: 6, tol: 0.4 })).toBe(true);
      sim.dispose();
    }
  });
});

describe('winding post and key in the world', () => {
  it('standing by the post rewinds fast; sprinting drains until frozen; frozen cannot move', () => {
    const sim = new GolfSim(KITCHEN_TABLE[1]!);
    const post = sim.loaded.windingPosts[0]!;
    const w = new Windup(1, sim.world, sim.loaded, [post[0], 0, post[2] + 1]);
    sim.step();
    w.key.key = 0.3;
    runFor(sim, [w], 1, () => NO_INPUT);
    expect(w.key.key).toBeCloseTo(0.3 + STAMINA.postRewind, 1);

    w.key.key = 1;
    // sprint back and forth along the dogleg's straight until the key is gone
    let t = 0;
    while (!w.key.frozen && t < 10) {
      w.step(input({ moveZ: Math.sin(t * 0.7) > 0 ? 1 : -1, sprint: true }));
      sim.step();
      t += STEP_DT;
    }
    expect(w.key.frozen).toBe(true);
    expect(w.status).toBe('frozen');
    // 1 s of "sprint" at zero: frozen, must not move beyond coasting to a stop
    runFor(sim, [w], 0.5, () => NO_INPUT);
    const p = w.position();
    runFor(sim, [w], 0.5, () => input({ moveZ: 1, sprint: true }));
    expect(Math.hypot(w.position()[0] - p[0], w.position()[2] - p[2])).toBeLessThan(0.01);
    sim.dispose();
  });
});

describe('club bonk between Windups', () => {
  function duel(): { sim: GolfSim; a: Windup; b: Windup } {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    const a = new Windup(1, sim.world, sim.loaded, [0, 0, 3]);
    const b = new Windup(2, sim.world, sim.loaded, [0, 0, 1.8]); // 1.2 m in front (-z)
    sim.step();
    return { sim, a, b };
  }

  it('hits, topples for 1.5 s, removes 40% key, then 2 s immunity; attacker has a cooldown', () => {
    const { sim, a, b } = duel();
    const ws = [a, b];
    runFor(sim, ws, 0.1, () => NO_INPUT);
    a.step(input({ swing: true })); // face -z (camera yaw 0)
    resolveBonks(ws);
    sim.step();
    expect(a.status).toBe('swing');
    expect(b.status).not.toBe('topple'); // wind-up phase: not yet

    runFor(sim, ws, BONK.hitEnd, () => NO_INPUT);
    expect(b.status).toBe('topple');
    expect(b.key.key).toBeCloseTo(1 - BONK.keyLoss, 2);
    // a Windup that is toppled cannot move
    const p = b.position();
    runFor(sim, ws, 0.2, () => NO_INPUT);
    // knocked away from the attacker (towards -z), never towards it
    expect(b.position()[2]).toBeLessThanOrEqual(p[2] + 1e-6);

    // Attacker is on cooldown: swinging again right away does nothing.
    a.step(input({ swing: true }));
    expect(a.status).not.toBe('swing');

    // Back up after 1.5 s total.
    runFor(sim, ws, BONK.toppleSeconds - BONK.hitEnd, () => NO_INPUT);
    expect(b.status).toBe('idle');
    expect(b.immune).toBe(true);

    // Second swing (cooldown over) bounces off the immune Windup.
    const key = b.key.key;
    a.step(input({ swing: true }));
    runFor(sim, ws, BONK.swingDuration, () => NO_INPUT);
    expect(b.status).not.toBe('topple');
    expect(b.key.key).toBeGreaterThanOrEqual(key);

    // After the immunity runs out a swing lands again (b was shoved out of reach: put it back).
    runFor(sim, ws, BONK.immunitySeconds, () => NO_INPUT);
    b.setPosition([0, 0, 1.8]);
    expect(b.immune).toBe(false);
    a.step(input({ swing: true }));
    runFor(sim, ws, BONK.hitEnd + 0.05, () => NO_INPUT);
    expect(b.status).toBe('topple');
    sim.dispose();
  });

  it('a swing only hits once per victim and never touches the ball', () => {
    const { sim, a, b } = duel();
    const ws = [a, b];
    for (let i = 0; i < 60; i++) sim.step();
    const ball = sim.position();
    const hits: number[] = [];
    a.step(input({ swing: true }));
    for (let i = 0; i < 40; i++) {
      for (const w of ws) w.step(NO_INPUT);
      hits.push(...resolveBonks(ws).map((h) => h.victim));
      sim.step();
    }
    expect(hits).toEqual([2]);
    expect(sim.position()).toEqual(ball);
    sim.dispose();
  });

  it('a swing at nobody (or behind) hits nothing', () => {
    const { sim, a, b } = duel();
    a.step(input({ swing: true, cameraYaw: Math.PI })); // faces +z, away from b
    for (let i = 0; i < 40; i++) {
      a.step(NO_INPUT);
      b.step(NO_INPUT);
      expect(resolveBonks([a, b])).toEqual([]);
      sim.step();
    }
    expect(b.status).toBe('idle');
    sim.dispose();
  });

  it('bonking a frozen Windup keeps it frozen after it gets up', () => {
    const { sim, a, b } = duel();
    b.key.key = 0.3;
    a.step(input({ swing: true }));
    runFor(sim, [a, b], 0.35, () => NO_INPUT);
    expect(b.key.key).toBe(0); // 0.3 - 0.4 clamps
    expect(b.key.frozen).toBe(true);
    runFor(sim, [a, b], BONK.toppleSeconds, () => NO_INPUT);
    expect(b.status).toBe('frozen');
    sim.dispose();
  });
});

describe('determinism', () => {
  function script(i: number): WindupInput {
    const t = i / 60;
    return input({
      moveX: Math.sin(t * 1.3),
      moveZ: Math.cos(t * 0.9) > -0.3 ? 1 : -0.5,
      cameraYaw: Math.sin(t * 0.2),
      sprint: Math.sin(t * 2.1) > 0,
      jump: i % 97 === 0,
      swing: i % 150 === 0,
      aimYaw: i > 500 && i < 560 ? 0.4 : null,
    });
  }
  function simulate(holeIndex: number): { w: Vec3; ball: Vec3; key: number } {
    const sim = new GolfSim(KITCHEN_TABLE[holeIndex]!);
    const w = spawn(sim);
    const dummy = new Windup(2, sim.world, sim.loaded, [0.5, 0, 1]);
    dummy.respawnNear(sim.position(), 0);
    for (let i = 0; i < 900; i++) {
      w.step(script(i));
      dummy.step();
      resolveBonks([w, dummy]);
      if (i === 300) sim.shoot(0, 0.5);
      sim.step();
    }
    const out = { w: w.position(), ball: sim.position(), key: w.key.key };
    sim.dispose();
    return out;
  }

  it('the same input sequence gives exactly the same final position (all holes)', () => {
    for (const h of [0, 1, 2]) {
      const a = simulate(h);
      const b = simulate(h);
      expect(b.w).toEqual(a.w);
      expect(b.ball).toEqual(a.ball);
      expect(b.key).toBe(a.key);
    }
  });

  it('different inputs give different results (the test is not vacuous)', () => {
    const a = simulate(0);
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    const w = spawn(sim);
    for (let i = 0; i < 900; i++) {
      w.step(input({ moveZ: 1 }));
      sim.step();
    }
    expect(w.position()).not.toEqual(a.w);
    expect(WINDUP.walkSpeed).toBeGreaterThan(0);
    sim.dispose();
  });
});
