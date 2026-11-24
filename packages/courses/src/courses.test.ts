import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  KITCHEN_TABLE,
  resolveSize,
  type Hole,
  type Piece,
  loadHoleIntoWorld,
  parseHole,
  validateHoleGeometry,
  type HoleInput,
  type LoadOptions,
} from './index.js';

const opts: LoadOptions = {
  surfaces: {
    felt: { friction: 0.8, restitution: 0.2 },
    wood: { friction: 0.4, restitution: 0.3 },
    sugar: { friction: 1, restitution: 0.05 },
  },
  wallRestitution: 0.6,
  bumperRestitution: 0.9,
};

const base: HoleInput = {
  id: 't',
  name: 'Test',
  par: 2,
  tee: [0, 0, 2],
  pieces: [
    { type: 'floor', position: [0, -0.2, 2], rotation: 0, size: [2, 0.4, 2] },
    { type: 'cup', position: [0, -0.2, -1], rotation: 0 },
  ],
  cup: { position: [0, 0, -1] },
};

describe('hole schema', () => {
  it('accepts all bundled kitchen table holes', () => {
    expect(KITCHEN_TABLE.map((h) => h.par)).toEqual([2, 3, 3]);
  });

  it('applies defaults', () => {
    const hole = parseHole({
      ...base,
      pieces: [{ type: 'floor', position: [0, 0, 0] }, ...base.pieces.slice(1)],
    });
    expect(hole.pieces[0]!.rotation).toBe(0);
  });

  it('rejects unknown piece types and surfaces', () => {
    expect(() => parseHole({ ...base, pieces: [{ type: 'lava', position: [0, 0, 0] }] })).toThrow();
    const bad = { ...base, pieces: [{ type: 'floor', position: [0, 0, 0], surface: 'ice' }] };
    expect(() => parseHole(bad)).toThrow();
  });

  it('requires exactly one cup piece and a sane par', () => {
    expect(() => parseHole({ ...base, pieces: [base.pieces[0]!] })).toThrow(/cup piece/);
    expect(() => parseHole({ ...base, par: 0 })).toThrow();
    expect(() => parseHole({ ...base, tee: [0, 0] })).toThrow();
  });
});

describe('geometry validation', () => {
  it('passes the bundled holes', () => {
    for (const h of KITCHEN_TABLE) expect(validateHoleGeometry(h)).toEqual([]);
  });

  it('flags a tee floating over nothing and a cup mismatch', () => {
    const h = parseHole({ ...base, tee: [10, 0, 10], cup: { position: [0, 0, 0.5] } });
    const problems = validateHoleGeometry(h);
    expect(problems.some((p) => p.includes('tee'))).toBe(true);
    expect(problems.some((p) => p.includes('cup'))).toBe(true);
  });
});

describe('loadHoleIntoWorld', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('records winding posts (holes 2 and 3 have one) as solid colliders', () => {
    expect(
      KITCHEN_TABLE.map((h) => h.pieces.filter((p) => p.type === 'windingPost').length),
    ).toEqual([0, 1, 1]);
    for (const hole of KITCHEN_TABLE) {
      const world = new RAPIER.World({ x: 0, y: -10, z: 0 });
      const loaded = loadHoleIntoWorld(world, hole, opts);
      expect(loaded.windingPosts).toHaveLength(
        hole.pieces.filter((p) => p.type === 'windingPost').length,
      );
      world.free();
    }
  });

  it('creates colliders for every piece and a cup sensor', () => {
    for (const hole of KITCHEN_TABLE) {
      const world = new RAPIER.World({ x: 0, y: -10, z: 0 });
      const loaded = loadHoleIntoWorld(world, hole, opts);
      expect(world.colliders.len()).toBeGreaterThanOrEqual(hole.pieces.length);
      expect(loaded.cupSensor.isSensor()).toBe(true);
      expect(loaded.surfaceByCollider.size).toBe(world.colliders.len() - 1);
      world.free();
    }
  });
});

/** Is (x, z) inside the piece's rotated footprint, grown by `margin` metres? */
function inFootprint(p: Piece, x: number, z: number, margin = 0): boolean {
  const [w, , d] = resolveSize(p);
  const yaw = (p.rotation * Math.PI) / 180;
  const dx = x - p.position[0];
  const dz = z - p.position[2];
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin;
}

/** Grid flood fill over the walkable floor (walls and posts block a 0.3 m wide Windup). */
function reachableFromTee(hole: Hole): (x: number, z: number) => boolean {
  const step = 0.1;
  const key = (i: number, j: number): string => `${i},${j}`;
  const walk = (x: number, z: number): boolean =>
    hole.pieces.some((p) => ['floor', 'cup', 'ramp'].includes(p.type) && inFootprint(p, x, z)) &&
    !hole.pieces.some(
      (p) => ['wall', 'bumper', 'windingPost'].includes(p.type) && inFootprint(p, x, z, 0.3),
    );
  const seen = new Set<string>();
  const start: [number, number] = [Math.round(hole.tee[0] / step), Math.round(hole.tee[2] / step)];
  const queue = [start];
  seen.add(key(...start));
  while (queue.length > 0) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (seen.has(key(ni, nj)) || !walk(ni * step, nj * step)) continue;
      seen.add(key(ni, nj));
      queue.push([ni, nj]);
    }
  }
  return (x, z) => seen.has(key(Math.round(x / step), Math.round(z / step)));
}

describe('gadget crates', () => {
  it('every hole has 2-3 crates, each resting on a floor and reachable on foot from the tee', () => {
    for (const hole of KITCHEN_TABLE) {
      const crates = hole.pieces.filter((p) => p.type === 'crate');
      expect(crates.length).toBeGreaterThanOrEqual(2);
      expect(crates.length).toBeLessThanOrEqual(3);
      expect(validateHoleGeometry(hole)).toEqual([]);
      const reach = reachableFromTee(hole);
      for (const c of crates) {
        expect(reach(c.position[0], c.position[2]), `${hole.id} crate at ${c.position}`).toBe(true);
      }
    }
  });

  it('crates have no collider and are listed by the loader in hole order', () => {
    const hole = KITCHEN_TABLE[1]!;
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const loaded = loadHoleIntoWorld(world, hole, opts);
    const expected = hole.pieces.filter((p) => p.type === 'crate').map((p) => p.position);
    expect(loaded.crates).toEqual(expected);
    const without = new RAPIER.World({ x: 0, y: -20, z: 0 });
    loadHoleIntoWorld(
      without,
      { ...hole, pieces: hole.pieces.filter((p) => p.type !== 'crate') },
      opts,
    );
    expect(world.colliders.len()).toBe(without.colliders.len());
  });

  it('rejects a crate floating in the air, off the floor, or more than 8 per hole', () => {
    const floating = { ...base, pieces: [...base.pieces, { type: 'crate', position: [0, 2, 2] }] };
    expect(validateHoleGeometry(parseHole(floating as HoleInput)).join()).toMatch(/does not rest/);
    const off = { ...base, pieces: [...base.pieces, { type: 'crate', position: [9, 0.3, 9] }] };
    expect(validateHoleGeometry(parseHole(off as HoleInput)).join()).toMatch(/not over a floor/);
    const many = {
      ...base,
      pieces: [
        ...base.pieces,
        ...Array.from({ length: 9 }, () => ({ type: 'crate', position: [0, 0.3, 2] })),
      ],
    };
    expect(() => parseHole(many as HoleInput)).toThrow(/at most 8 crates/);
  });
});
