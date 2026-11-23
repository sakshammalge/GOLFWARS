import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import { holeBounds, pieceBoxes, pieceQuaternion, type Bounds, type Quat } from './geometry.js';
import {
  CUP_PIT_DEPTH,
  resolveSize,
  resolveSurface,
  type Hole,
  type Piece,
  type Surface,
  type Vec3,
} from './schema.js';

/** Contact material of a surface, handed in by the physics config (kept out of the course data). */
export interface SurfaceMaterial {
  friction: number;
  restitution: number;
}

export interface LoadOptions {
  surfaces: Record<Surface, SurfaceMaterial>;
  /** Restitution for walls and bumpers (bumpers get `bumperRestitution`). */
  wallRestitution: number;
  bumperRestitution: number;
}

export interface LoadedHole {
  hole: Hole;
  bounds: Bounds;
  /** Sensor volume inside the cup pit. */
  cupSensor: Collider;
  /** Surface of every course collider, keyed by `Collider.handle`. */
  surfaceByCollider: Map<number, Surface>;
  /** Where the ball should be placed on the tee (ball centre = tee + radius up). */
  tee: Vec3;
  cup: Vec3;
}

/**
 * Creates the static colliders of a hole in a Rapier world. Pure physics, no rendering, so the
 * server can use it unchanged. `RAPIER.init()` must have completed before calling.
 */
export function loadHoleIntoWorld(world: World, hole: Hole, opts: LoadOptions): LoadedHole {
  const surfaceByCollider = new Map<number, Surface>();
  let cupSensor: Collider | null = null;

  for (const piece of hole.pieces) {
    const surface = resolveSurface(piece);
    const mat = opts.surfaces[surface];
    const restitution =
      piece.type === 'wall'
        ? opts.wallRestitution
        : piece.type === 'bumper'
          ? opts.bumperRestitution
          : mat.restitution;
    const q = pieceQuaternion(piece);

    const add = (desc: RAPIER.ColliderDesc): Collider => {
      const c = world.createCollider(desc.setFriction(mat.friction).setRestitution(restitution));
      surfaceByCollider.set(c.handle, surface);
      return c;
    };

    if (piece.type === 'bumper') {
      const [d, h] = resolveSize(piece);
      add(
        RAPIER.ColliderDesc.cylinder(h / 2, d / 2)
          .setTranslation(...piece.position)
          .setRotation(toRapierQuat(q)),
      );
      continue;
    }

    for (const box of pieceBoxes(piece)) {
      const [wx, wy, wz] = localToWorld(piece, q, box.center);
      add(
        RAPIER.ColliderDesc.cuboid(...box.half)
          .setTranslation(wx, wy, wz)
          .setRotation(toRapierQuat(q)),
      );
    }

    if (piece.type === 'cup') {
      const [, h] = resolveSize(piece);
      // Sensor slab filling the pit (just under the rim) so a ball that drops in overlaps it.
      const half: Vec3 = [0.3, (CUP_PIT_DEPTH - 0.02) / 2, 0.3];
      const [sx, sy, sz] = localToWorld(piece, q, [0, h / 2 - 0.02 - half[1], 0]);
      const s = world.createCollider(
        RAPIER.ColliderDesc.cuboid(...half)
          .setTranslation(sx, sy, sz)
          .setRotation(toRapierQuat(q))
          .setSensor(true),
      );
      cupSensor = s;
    }
  }

  if (!cupSensor) throw new Error(`hole ${hole.id} has no cup piece`);
  return {
    hole,
    bounds: holeBounds(hole),
    cupSensor,
    surfaceByCollider,
    tee: [...hole.tee],
    cup: [...hole.cup.position],
  };
}

function toRapierQuat(q: Quat): { x: number; y: number; z: number; w: number } {
  return { x: q[0], y: q[1], z: q[2], w: q[3] };
}

/** Local-frame point of a piece to world coordinates. */
export function localToWorld(piece: Piece, q: Quat, v: Vec3): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    piece.position[0] + x + qw * tx + (qy * tz - qz * ty),
    piece.position[1] + y + qw * ty + (qz * tx - qx * tz),
    piece.position[2] + z + qw * tz + (qx * ty - qy * tx),
  ];
}
