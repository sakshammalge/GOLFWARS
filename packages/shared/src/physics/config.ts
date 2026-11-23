import type { Surface } from '@golfwars/courses';

/** Contact + rolling parameters of one surface. */
export interface SurfacePhysics {
  /** Coulomb friction coefficient of the contact. */
  friction: number;
  restitution: number;
  /** Extra linear damping (1/s) applied while the ball is touching this surface. */
  rollLinearDamping: number;
  /** Angular damping (1/s) while touching: this is what makes a rolling ball slow down. */
  rollAngularDamping: number;
}

/**
 * Every physics tuning number for the ball and the course lives here, so the client, the tests
 * and (from M3) the server all simulate the exact same game. Units: metres, seconds, kilograms.
 */
export const PHYSICS = {
  /** The simulation always advances in fixed steps of 1 / stepHz seconds. */
  stepHz: 60,
  gravity: -20,

  ball: {
    radius: 0.15,
    mass: 0.05,
    restitution: 0.5,
    friction: 0.5,
    /** Air damping; the surface values below replace the linear part while grounded. */
    airLinearDamping: 0.02,
    airAngularDamping: 0.1,
  },

  surfaces: {
    // felt: normal. wood: fast. sugar: slow and sandy.
    felt: { friction: 0.8, restitution: 0.2, rollLinearDamping: 0.35, rollAngularDamping: 2.0 },
    wood: { friction: 0.45, restitution: 0.35, rollLinearDamping: 0.2, rollAngularDamping: 1.3 },
    sugar: { friction: 1.2, restitution: 0.05, rollLinearDamping: 2.8, rollAngularDamping: 12 },
  } satisfies Record<Surface, SurfacePhysics>,

  wallRestitution: 0.6,
  bumperRestitution: 0.95,

  shot: {
    /** Launch speed at 0% and 100% power (m/s). */
    minSpeed: 1.2,
    maxSpeed: 12,
    /** Small upward angle on every shot so balls can climb ramps and hop seams. */
    loftDeg: 8,
  },

  rest: {
    /** Linear speed (m/s) below which the ball counts as "not moving". */
    speed: 0.12,
    /** Ball must stay below the threshold this long (s) to be declared at rest. */
    seconds: 0.5,
  },

  /** The ball is out of bounds when it falls this far below the lowest piece... */
  fallBelowMargin: 4,
  /** ...or leaves the course's XZ bounds by more than this. */
  boundsMargin: 1.5,
  outOfBoundsPenalty: 1,

  cup: {
    /** The ball only drops in if it is slower than this when it reaches the cup (m/s). */
    maxSpeed: 3.5,
  },
} as const;

export const STEP_DT = 1 / PHYSICS.stepHz;
