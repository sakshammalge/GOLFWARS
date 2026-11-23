import { z } from 'zod';

export const SURFACES = ['felt', 'wood', 'sugar'] as const;
/** felt = normal, wood = fast, sugar = slow and sandy. */
export type Surface = (typeof SURFACES)[number];

export const PIECE_TYPES = ['floor', 'wall', 'ramp', 'cup', 'bumper'] as const;
export type PieceType = (typeof PIECE_TYPES)[number];

export type Vec3 = [number, number, number];

const finite = z.number().refine(Number.isFinite, 'must be finite');
const vec3 = z.tuple([finite, finite, finite]);
const size3 = z.tuple([
  finite.refine((n) => n > 0, 'must be > 0'),
  finite.refine((n) => n > 0, 'must be > 0'),
  finite.refine((n) => n > 0, 'must be > 0'),
]);

export const pieceSchema = z.object({
  type: z.enum(PIECE_TYPES),
  /** Centre of the piece's bounding box (hole centre for `cup`). Units are metres, y is up. */
  position: vec3,
  /** Yaw in degrees around the vertical axis. */
  rotation: finite.default(0),
  /**
   * Full extents [x, y, z] before rotation. Boxes: width, thickness, length. Ramps: width,
   * thickness, slope length (along local +z, which is the uphill end). Bumpers: [diameter,
   * height, diameter] (x is the diameter). Defaults per type: see `DEFAULT_SIZES`.
   */
  size: size3.optional(),
  /** Defaults to felt for floor/ramp/cup and wood for wall/bumper. */
  surface: z.enum(SURFACES).optional(),
  /** Ramps only: incline in degrees (default 12). */
  slope: finite.refine((n) => n > 0 && n < 45, 'slope must be in (0, 45) degrees').optional(),
});
export type PieceInput = z.input<typeof pieceSchema>;
export type Piece = z.output<typeof pieceSchema>;

export const holeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    par: z.number().int().min(1).max(12),
    /** Where the ball is placed: a point on the surface of a floor/cup piece. */
    tee: vec3,
    /** Initial camera/aim direction in degrees (0 = looking down -z). Defaults to tee -> cup. */
    startYaw: finite.optional(),
    pieces: z.array(pieceSchema).min(1),
    cup: z.object({ position: vec3 }),
  })
  .superRefine((hole, ctx) => {
    const cups = hole.pieces.filter((p) => p.type === 'cup');
    if (cups.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['pieces'],
        message: `a hole needs exactly one cup piece (found ${cups.length})`,
      });
    }
    hole.pieces.forEach((p, i) => {
      if (p.type !== 'cup') return;
      const [w, h, d] = resolveSize(p);
      if (w <= CUP_HOLE_SIZE || d <= CUP_HOLE_SIZE || h <= CUP_PIT_DEPTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['pieces', i, 'size'],
          message: `cup piece must be wider than ${CUP_HOLE_SIZE} and thicker than ${CUP_PIT_DEPTH}`,
        });
      }
    });
  });
export type HoleInput = z.input<typeof holeSchema>;
export type Hole = z.output<typeof holeSchema>;

/** Side of the square hole cut into a `cup` piece, and how deep the pit is. */
export const CUP_HOLE_SIZE = 0.6;
export const CUP_PIT_DEPTH = 0.3;

export const DEFAULT_SIZES: Record<PieceType, Vec3> = {
  floor: [4, 0.4, 4],
  wall: [4, 0.5, 0.3],
  ramp: [2, 0.3, 3],
  cup: [2, 0.4, 2],
  bumper: [0.8, 0.6, 0.8],
};

export const DEFAULT_SLOPE_DEG = 12;

export function resolveSize(p: Pick<Piece, 'type' | 'size'>): Vec3 {
  return p.size ?? DEFAULT_SIZES[p.type];
}

export function resolveSurface(p: Pick<Piece, 'type' | 'surface'>): Surface {
  if (p.surface) return p.surface;
  return p.type === 'wall' || p.type === 'bumper' ? 'wood' : 'felt';
}

/** Parses and validates untrusted JSON into a Hole; throws a ZodError with readable paths. */
export function parseHole(raw: unknown): Hole {
  return holeSchema.parse(raw);
}
