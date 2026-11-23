import { KITCHEN_TABLE, parseHole, type Surface } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS, STEP_DT } from './config.js';
import { GolfSim, initPhysics, previewShot, type StepEvents, type Vec3 } from './golfSim.js';

beforeAll(async () => {
  await initPhysics();
});

/** A long single-surface strip with a cup far away and no walls. */
function strip(surface: Surface, withWalls = false) {
  return parseHole({
    id: 't',
    name: 't',
    par: 2,
    tee: [0, 0, 30],
    pieces: [
      { type: 'floor', position: [0, -0.2, 10], size: [4, 0.4, 60], surface },
      { type: 'cup', position: [0, -0.2, -25], size: [4, 0.4, 4] },
      ...(withWalls
        ? [
            { type: 'wall', position: [-2.15, 0.3, 5], size: [0.3, 0.6, 70] },
            { type: 'wall', position: [2.15, 0.3, 5], size: [0.3, 0.6, 70] },
          ]
        : []),
    ],
    cup: { position: [0, 0, -25] },
  });
}

function runUntilStop(sim: GolfSim, maxSteps = 60 * 60): { steps: number; events: StepEvents } {
  let events: StepEvents = { rest: false, holed: false, outOfBounds: false };
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    events = sim.step();
    if (events.rest || events.holed || events.outOfBounds) break;
  }
  return { steps, events };
}

describe('fixed step', () => {
  it('runs at 60 Hz', () => {
    expect(PHYSICS.stepHz).toBe(60);
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    expect(sim.world.timestep).toBeCloseTo(STEP_DT, 6);
  });
});

describe('determinism', () => {
  it('the same scripted shot ends at the same position in 10 fresh worlds', () => {
    const hole = KITCHEN_TABLE[2]!; // bumper field: lots of collisions
    const finals: Vec3[] = [];
    for (let run = 0; run < 10; run++) {
      const sim = new GolfSim(hole);
      expect(sim.shoot(0.21, 0.8)).toBe(true);
      for (let i = 0; i < 60 * 8; i++) sim.step();
      finals.push(sim.position());
      sim.dispose();
    }
    const first = finals[0]!;
    for (const p of finals) {
      for (let k = 0; k < 3; k++) expect(Math.abs(p[k]! - first[k]!)).toBeLessThan(1e-6);
    }
    // And the shot actually did something.
    expect(Math.hypot(first[0] - 0, first[2] - 6)).toBeGreaterThan(1);
  });
});

describe('rest detection', () => {
  it('starts resting on the tee and cannot be shot while moving', () => {
    const sim = new GolfSim(KITCHEN_TABLE[0]!);
    expect(sim.state).toBe('resting');
    expect(sim.shoot(0, 0.3)).toBe(true);
    expect(sim.state).toBe('moving');
    expect(sim.shoot(0, 0.3)).toBe(false);
  });

  it('declares rest only after 0.5 s below the speed threshold, then allows another shot', () => {
    const sim = new GolfSim(strip('felt'));
    sim.shoot(0, 0.3);
    const { events, steps } = runUntilStop(sim);
    expect(events.rest).toBe(true);
    expect(sim.state).toBe('resting');
    expect(sim.speed()).toBe(0);
    expect(steps * STEP_DT).toBeGreaterThan(PHYSICS.rest.seconds);
    expect(sim.shoot(0, 0.1)).toBe(true);
  });
});

describe('surfaces', () => {
  it('wood is faster than felt, which is faster than sugar', () => {
    const dist: Record<string, number> = {};
    for (const s of ['wood', 'felt', 'sugar'] as const) {
      const sim = new GolfSim(strip(s));
      sim.shoot(0, 0.5);
      runUntilStop(sim);
      dist[s] = 30 - sim.position()[2];
    }
    expect(dist.wood!).toBeGreaterThan(dist.felt!);
    expect(dist.felt!).toBeGreaterThan(dist.sugar! * 2);
  });
});

describe('out of bounds', () => {
  it('resets to the last resting position when the ball falls off the course', () => {
    const sim = new GolfSim(strip('wood'));
    const start = sim.lastRestingPosition;
    sim.shoot(Math.PI / 2, 0.6); // yaw 90 degrees: towards -x, off the edge (no walls)
    const { events } = runUntilStop(sim, 60 * 20);
    expect(events.outOfBounds).toBe(true);
    expect(sim.state).toBe('resting');
    const p = sim.position();
    expect(p[0]).toBeCloseTo(start[0], 6);
    expect(p[1]).toBeCloseTo(start[1], 6);
    expect(p[2]).toBeCloseTo(start[2], 6);
  });
});

describe('cup', () => {
  it('a slow shot down the middle is holed', () => {
    const hole = parseHole({
      id: 'near',
      name: 'near',
      par: 1,
      tee: [0, 0, 3],
      pieces: [
        { type: 'floor', position: [0, -0.2, 1.5], size: [2, 0.4, 5], surface: 'felt' },
        { type: 'cup', position: [0, -0.2, -2], size: [2, 0.4, 2] },
      ],
      cup: { position: [0, 0, -2] },
    });
    let holed = false;
    for (let power = 0.05; power < 0.5 && !holed; power += 0.01) {
      const sim = new GolfSim(hole);
      sim.shoot(0, power);
      holed = runUntilStop(sim).events.holed;
      if (holed) expect(sim.state).toBe('holed');
    }
    expect(holed).toBe(true);
  });

  it('a hard shot does not drop in at speed', () => {
    const sim = new GolfSim(strip('wood'));
    sim.shoot(0, 1);
    const { events } = runUntilStop(sim);
    expect(events.holed).toBe(false);
  });
});

describe('previewShot', () => {
  it('returns an arc starting at the ball and leaves the scratch sim at the start', () => {
    const scratch = new GolfSim(KITCHEN_TABLE[0]!);
    const from = scratch.teePosition();
    const prev = previewShot(scratch, from, 0, 0.8);
    expect(prev.points.length).toBeGreaterThan(5);
    expect(prev.points[0]![2]).toBeCloseTo(from[2], 4);
    expect(prev.points.at(-1)![2]).toBeLessThan(from[2] - 1);
    expect(scratch.position()[2]).toBeCloseTo(from[2], 4);
    expect(scratch.state).toBe('resting');
  });
});
