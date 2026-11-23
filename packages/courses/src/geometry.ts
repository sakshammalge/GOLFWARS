import { CUP_HOLE_SIZE, CUP_PIT_DEPTH, DEFAULT_SLOPE_DEG, resolveSize } from './schema.js';
import type { Hole, Piece, Vec3 } from './schema.js';

export type Quat = [number, number, number, number]; // x, y, z, w

const DEG = Math.PI / 180;

/** Orientation of a piece: yaw about +Y, then (ramps only) pitch so local +z rises. */
export function pieceQuaternion(p: Piece): Quat {
  const hy = (p.rotation * DEG) / 2;
  const qy: Quat = [0, Math.sin(hy), 0, Math.cos(hy)];
  if (p.type !== 'ramp') return qy;
  const hp = (-(p.slope ?? DEFAULT_SLOPE_DEG) * DEG) / 2; // rotating about X by -slope lifts +z
  const qx: Quat = [Math.sin(hp), 0, 0, Math.cos(hp)];
  return mulQuat(qy, qx);
}

function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** A box in a piece's local frame (centre + half extents). `pit` boxes are the cup's dark base. */
export interface LocalBox {
  center: Vec3;
  half: Vec3;
  role: 'surface' | 'pit';
}

/** The boxes that make up a (non-bumper) piece, in the piece's local frame. */
export function pieceBoxes(p: Piece): LocalBox[] {
  const [w, h, d] = resolveSize(p);
  if (p.type !== 'cup') {
    return [{ center: [0, 0, 0], half: [w / 2, h / 2, d / 2], role: 'surface' }];
  }
  const hs = CUP_HOLE_SIZE / 2;
  const sideW = (w - CUP_HOLE_SIZE) / 2;
  const sideD = (d - CUP_HOLE_SIZE) / 2;
  const boxes: LocalBox[] = [
    { center: [-(hs + sideW / 2), 0, 0], half: [sideW / 2, h / 2, d / 2], role: 'surface' },
    { center: [hs + sideW / 2, 0, 0], half: [sideW / 2, h / 2, d / 2], role: 'surface' },
    { center: [0, 0, -(hs + sideD / 2)], half: [hs, h / 2, sideD / 2], role: 'surface' },
    { center: [0, 0, hs + sideD / 2], half: [hs, h / 2, sideD / 2], role: 'surface' },
  ];
  const baseTop = h / 2 - CUP_PIT_DEPTH;
  boxes.push({
    center: [0, (baseTop - h / 2) / 2, 0],
    half: [hs, (baseTop + h / 2) / 2, hs],
    role: 'pit',
  });
  return boxes;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

/** Axis-aligned bounds of everything in the hole (rotated piece corners included). */
export function holeBounds(hole: Hole): Bounds {
  const b: Bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const p of hole.pieces) {
    const [w, h, d] = resolveSize(p);
    const [qx, qy, qz, qw] = pieceQuaternion(p);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const v = rotate([sx * w * 0.5, sy * h * 0.5, sz * d * 0.5], [qx, qy, qz, qw]);
          const x = p.position[0] + v[0];
          const y = p.position[1] + v[1];
          const z = p.position[2] + v[2];
          b.minX = Math.min(b.minX, x);
          b.maxX = Math.max(b.maxX, x);
          b.minY = Math.min(b.minY, y);
          b.maxY = Math.max(b.maxY, y);
          b.minZ = Math.min(b.minZ, z);
          b.maxZ = Math.max(b.maxZ, z);
        }
  }
  return b;
}

function rotate(v: Vec3, q: Quat): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Height of the top surface of the highest floor/cup piece whose footprint contains (x, z), or
 * null if none does. Used to check that the tee and cup sit on a floor.
 */
export function floorTopAt(hole: Hole, x: number, z: number): number | null {
  let best: number | null = null;
  for (const p of hole.pieces) {
    if (p.type !== 'floor' && p.type !== 'cup') continue;
    const [w, h, d] = resolveSize(p);
    const yaw = p.rotation * DEG;
    const dx = x - p.position[0];
    const dz = z - p.position[2];
    // Rotate the offset by -yaw into the piece's local frame.
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2) {
      const top = p.position[1] + h / 2;
      if (best === null || top > best) best = top;
    }
  }
  return best;
}

/** Geometric sanity checks beyond the schema. Returns human-readable problems (empty = ok). */
export function validateHoleGeometry(hole: Hole): string[] {
  const problems: string[] = [];
  const tol = 0.05;
  const [tx, ty, tz] = hole.tee;
  const teeTop = floorTopAt(hole, tx, tz);
  if (teeTop === null) problems.push(`tee (${tx}, ${tz}) is not over a floor piece`);
  else if (Math.abs(teeTop - ty) > tol)
    problems.push(`tee y=${ty} is not on the floor surface (floor top is ${teeTop})`);

  const [cx, cy, cz] = hole.cup.position;
  const cupPiece = hole.pieces.find((p) => p.type === 'cup');
  if (cupPiece) {
    const dx = cupPiece.position[0] - cx;
    const dz = cupPiece.position[2] - cz;
    if (Math.hypot(dx, dz) > 0.01)
      problems.push('cup.position does not match the cup piece centre');
  }
  const cupTop = floorTopAt(hole, cx, cz);
  if (cupTop === null) problems.push(`cup (${cx}, ${cz}) is not over a floor piece`);
  else if (Math.abs(cupTop - cy) > tol)
    problems.push(`cup y=${cy} is not on the floor surface (floor top is ${cupTop})`);

  return problems;
}
