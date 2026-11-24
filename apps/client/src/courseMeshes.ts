import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  DoubleSide,
} from 'three';
import { STAMINA } from '@golfwars/shared';
import { createCrateMesh } from './gadgetMeshes.js';
import {
  pieceBoxes,
  pieceQuaternion,
  resolveSize,
  resolveSurface,
  type Hole,
  type Surface,
} from '@golfwars/courses';

/** Flat colours per surface: wood tabletop, felt placemats, sugar spilled on the table. */
export const SURFACE_COLORS: Record<Surface, number> = {
  wood: 0xc08a52,
  felt: 0x3f9d7c,
  sugar: 0xf4ecd6,
};
const WALL_COLOR = 0x7b4f2d;
const BUMPER_COLOR = 0xe2514a;
const PIT_COLOR = 0x2b1b14;
const BRASS_COLOR = 0xd9a441;

const materials = new Map<number, MeshStandardMaterial>();
function mat(color: number): MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
    materials.set(color, m);
  }
  return m;
}

/** A built hole: the meshes plus its gadget crates in hole order (index = bit in the crate mask). */
export type HoleGroup = Group & { crates: Group[] };

/**
 * Builds simple flat-colour Three.js meshes from the same hole data (and the same piece
 * transforms and box layout) that the physics loader uses, so visuals and colliders match.
 */
export function buildHoleMeshes(hole: Hole, opts: { crates?: boolean } = {}): HoleGroup {
  const group = new Group() as HoleGroup;
  group.name = `hole-${hole.id}`;
  group.crates = [];

  for (const piece of hole.pieces) {
    if (piece.type === 'crate') {
      // Gadget crates only exist in online matches; the caller shows and animates them.
      if (opts.crates) {
        const crate = createCrateMesh(resolveSize(piece)[0]);
        crate.position.set(...piece.position);
        group.add(crate);
        group.crates.push(crate);
      }
      continue;
    }
    const q = pieceQuaternion(piece);
    const holder = new Group();
    holder.position.set(...piece.position);
    holder.quaternion.set(...q);
    group.add(holder);

    if (piece.type === 'windingPost') {
      group.remove(holder);
      group.add(buildWindingPost(piece.position, resolveSize(piece)));
      continue;
    }

    if (piece.type === 'bumper') {
      const [d, h] = resolveSize(piece);
      const m = new Mesh(new CylinderGeometry(d / 2, d / 2, h, 20), mat(BUMPER_COLOR));
      m.castShadow = m.receiveShadow = true;
      holder.add(m);
      continue;
    }

    const surfaceColor = piece.type === 'wall' ? WALL_COLOR : SURFACE_COLORS[resolveSurface(piece)];
    for (const box of pieceBoxes(piece)) {
      const m = new Mesh(
        new BoxGeometry(box.half[0] * 2, box.half[1] * 2, box.half[2] * 2),
        mat(box.role === 'pit' ? PIT_COLOR : surfaceColor),
      );
      m.position.set(...box.center);
      m.castShadow = m.receiveShadow = true;
      holder.add(m);
    }
  }

  group.add(buildFlag(hole));
  return group;
}

function buildFlag(hole: Hole): Group {
  const flag = new Group();
  const [cx, cy, cz] = hole.cup.position;
  flag.position.set(cx, cy, cz - 0.45);
  const pole = new Mesh(new CylinderGeometry(0.025, 0.025, 1.4, 8), mat(0xf5f5f5));
  pole.position.y = 0.7;
  const cloth = new Mesh(new ConeGeometry(0.28, 0.5, 3), mat(0xffd23f));
  cloth.rotation.z = -Math.PI / 2;
  cloth.position.set(0.25, 1.15, 0);
  for (const m of [pole, cloth]) m.castShadow = true;
  flag.add(pole, cloth);
  return flag;
}

/** A brass Winding Post: base, pole and a big key on top, plus a ring on the floor showing the rewind radius. */
function buildWindingPost(position: readonly number[], size: readonly number[]): Group {
  const [d, h] = size as [number, number, number];
  const post = new Group();
  post.position.set(position[0]!, position[1]! - h / 2, position[2]!);
  const brass = new MeshStandardMaterial({
    color: BRASS_COLOR,
    flatShading: true,
    roughness: 0.45,
    metalness: 0.15,
    emissive: BRASS_COLOR,
    emissiveIntensity: 0.15,
  });
  const base = new Mesh(new CylinderGeometry(d * 0.75, d * 0.85, 0.18, 8), brass);
  base.position.y = 0.09;
  const pole = new Mesh(new CylinderGeometry(d * 0.2, d * 0.28, h - 0.3, 8), brass);
  pole.position.y = 0.18 + (h - 0.3) / 2;
  const key = new Group();
  key.position.y = h - 0.05;
  const wingA = new Mesh(new BoxGeometry(0.7, 0.16, 0.06), brass);
  const wingB = new Mesh(new BoxGeometry(0.16, 0.5, 0.06), brass);
  wingB.position.y = 0.08;
  key.add(wingA, wingB);
  key.rotation.y = 0.5;
  const ring = new Mesh(
    new RingGeometry(STAMINA.postRadius - 0.06, STAMINA.postRadius, 48),
    new MeshBasicMaterial({
      color: BRASS_COLOR,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  post.add(base, pole, key, ring);
  for (const m of [base, pole, wingA, wingB]) m.castShadow = m.receiveShadow = true;
  return post;
}
