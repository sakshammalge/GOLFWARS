import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
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

const materials = new Map<number, MeshStandardMaterial>();
function mat(color: number): MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
    materials.set(color, m);
  }
  return m;
}

/**
 * Builds simple flat-colour Three.js meshes from the same hole data (and the same piece
 * transforms and box layout) that the physics loader uses, so visuals and colliders match.
 */
export function buildHoleMeshes(hole: Hole): Group {
  const group = new Group();
  group.name = `hole-${hole.id}`;

  for (const piece of hole.pieces) {
    const q = pieceQuaternion(piece);
    const holder = new Group();
    holder.position.set(...piece.position);
    holder.quaternion.set(...q);
    group.add(holder);

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
