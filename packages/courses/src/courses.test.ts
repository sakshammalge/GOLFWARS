import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  KITCHEN_TABLE,
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
