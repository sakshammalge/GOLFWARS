import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { loadHoleIntoWorld, type Hole, type LoadedHole, type Surface } from '@golfwars/courses';
import { PHYSICS, STEP_DT } from './config.js';

export type Vec3 = [number, number, number];
/** moving: in play. resting: waiting for the next shot. holed: in the cup. */
export type BallPhase = 'moving' | 'resting' | 'holed';

export interface StepEvents {
  /** Ball just came to rest (after having been in motion). */
  rest: boolean;
  /** Ball dropped into the cup. */
  holed: boolean;
  /** Ball left the course and was reset to its last resting position (a penalty stroke). */
  outOfBounds: boolean;
}

const NO_EVENTS: StepEvents = { rest: false, holed: false, outOfBounds: false };

let initPromise: Promise<void> | null = null;
/** Initialises the Rapier WASM once. Await before constructing any `GolfSim`. */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

/**
 * One hole's physics: the course colliders plus a single golf ball, advanced in fixed 60 Hz
 * steps. No rendering and no browser APIs, so the server can run the same class in M3.
 */
export class GolfSim {
  readonly world: World;
  readonly loaded: LoadedHole;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private phase: BallPhase = 'moving';
  private restTime = 0;
  private lastRest: Vec3;
  private grounded: Surface | null = null;

  /** `initPhysics()` must have resolved. */
  constructor(readonly hole: Hole) {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = STEP_DT;
    this.loaded = loadHoleIntoWorld(this.world, hole, {
      surfaces: PHYSICS.surfaces,
      wallRestitution: PHYSICS.wallRestitution,
      bumperRestitution: PHYSICS.bumperRestitution,
    });

    const b = PHYSICS.ball;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setCcdEnabled(true)
        .setLinearDamping(b.airLinearDamping)
        .setAngularDamping(b.airAngularDamping),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(b.radius)
        .setMass(b.mass)
        .setRestitution(b.restitution)
        .setFriction(b.friction),
      this.body,
    );
    this.lastRest = this.teePosition();
    this.teleport(this.lastRest);
    this.phase = 'resting';
  }

  /** Ball-centre position when sitting on the tee. */
  teePosition(): Vec3 {
    const [x, y, z] = this.loaded.tee;
    return [x, y + PHYSICS.ball.radius + 0.002, z];
  }

  get state(): BallPhase {
    return this.phase;
  }

  /** The surface the ball is currently touching, if any. */
  get surface(): Surface | null {
    return this.grounded;
  }

  get lastRestingPosition(): Vec3 {
    return [...this.lastRest];
  }

  position(): Vec3 {
    const p = this.body.translation();
    return [p.x, p.y, p.z];
  }

  /** Ball orientation as a quaternion [x, y, z, w] (for rendering the roll). */
  rotation(): [number, number, number, number] {
    const q = this.body.rotation();
    return [q.x, q.y, q.z, q.w];
  }

  velocity(): Vec3 {
    const v = this.body.linvel();
    return [v.x, v.y, v.z];
  }

  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Puts the ball at rest at `pos` (used for resets and by the aim-preview scratch sim). */
  teleport(pos: Vec3, markAsLastRest = true): void {
    this.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.phase = 'resting';
    this.restTime = 0;
    this.grounded = null;
    if (markAsLastRest) this.lastRest = [...pos];
  }

  /** Launch velocity for a shot: yaw in radians (0 = towards -z), power in 0..1. */
  static shotVelocity(yaw: number, power: number): Vec3 {
    const p = Math.min(1, Math.max(0, power));
    const speed = PHYSICS.shot.minSpeed + (PHYSICS.shot.maxSpeed - PHYSICS.shot.minSpeed) * p;
    const loft = (PHYSICS.shot.loftDeg * Math.PI) / 180;
    const flat = speed * Math.cos(loft);
    return [-Math.sin(yaw) * flat, speed * Math.sin(loft), -Math.cos(yaw) * flat];
  }

  /** Hits the ball. Only allowed while resting; returns whether the shot was taken. */
  shoot(yaw: number, power: number): boolean {
    if (this.phase !== 'resting') return false;
    this.lastRest = this.position();
    const [vx, vy, vz] = GolfSim.shotVelocity(yaw, power);
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.phase = 'moving';
    this.restTime = 0;
    return true;
  }

  /** Advances exactly one fixed step (1/60 s). */
  step(): StepEvents {
    this.updateGrounded();
    const mat = this.grounded ? PHYSICS.surfaces[this.grounded] : null;
    this.body.setLinearDamping(mat ? mat.rollLinearDamping : PHYSICS.ball.airLinearDamping);
    this.body.setAngularDamping(mat ? mat.rollAngularDamping : PHYSICS.ball.airAngularDamping);
    this.world.step();

    if (this.phase === 'holed') return NO_EVENTS;
    const events: StepEvents = { rest: false, holed: false, outOfBounds: false };

    const pos = this.position();
    if (this.isOutOfBounds(pos)) {
      this.teleport(this.lastRest, false);
      events.outOfBounds = true;
      return events;
    }

    if (
      this.world.intersectionPair(this.collider, this.loaded.cupSensor) &&
      this.speed() < PHYSICS.cup.maxSpeed
    ) {
      this.phase = 'holed';
      events.holed = true;
      return events;
    }

    if (this.phase === 'moving') {
      this.updateGrounded();
      if (this.grounded && this.speed() < PHYSICS.rest.speed) {
        this.restTime += STEP_DT;
        if (this.restTime >= PHYSICS.rest.seconds) {
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          this.phase = 'resting';
          this.lastRest = this.position();
          events.rest = true;
        }
      } else {
        this.restTime = 0;
      }
    }
    return events;
  }

  /** Releases the Rapier world (WASM memory). */
  dispose(): void {
    this.world.free();
  }

  private updateGrounded(): void {
    const p = this.body.translation();
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(
      ray,
      PHYSICS.ball.radius + 0.04,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
    );
    this.grounded = hit ? (this.loaded.surfaceByCollider.get(hit.collider.handle) ?? null) : null;
  }

  private isOutOfBounds(p: Vec3): boolean {
    const b = this.loaded.bounds;
    const m = PHYSICS.boundsMargin;
    return (
      p[1] < b.minY - PHYSICS.fallBelowMargin ||
      p[0] < b.minX - m ||
      p[0] > b.maxX + m ||
      p[2] < b.minZ - m ||
      p[2] > b.maxZ + m
    );
  }
}

export interface ShotPreview {
  /** Ball-centre positions sampled every `sampleEvery` steps, from the start up to the first bounce. */
  points: Vec3[];
  /** Whether the shot would be holed before landing. */
  holed: boolean;
}

/**
 * Cheap aim preview: re-uses a scratch `GolfSim` for the same hole (never the live one), places
 * the ball where the real one is, fires the shot and records the path until the first bounce off a
 * wall or bumper, the cup, running out of speed, or `maxSteps`. Roughly 0.1 ms per step for these small courses.
 */
export function previewShot(
  scratch: GolfSim,
  from: Vec3,
  yaw: number,
  power: number,
  maxSteps = 120,
  sampleEvery = 3,
): ShotPreview {
  scratch.teleport(from);
  scratch.shoot(yaw, power);
  const points: Vec3[] = [scratch.position()];
  const v0 = scratch.velocity();
  let holed = false;
  for (let i = 1; i <= maxSteps; i++) {
    const ev = scratch.step();
    if (i % sampleEvery === 0) points.push(scratch.position());
    if (ev.holed) {
      holed = true;
      break;
    }
    if (ev.outOfBounds) break;
    // Ends the preview at the first bounce off a wall/bumper (heading changed a lot) or when slow.
    const v = scratch.velocity();
    const hs = Math.hypot(v[0], v[2]);
    if (hs < 0.4) break;
    if ((v[0] * v0[0] + v[2] * v0[2]) / (hs * Math.hypot(v0[0], v0[2])) < 0.6) break;
  }
  scratch.teleport(from);
  return { points, holed };
}
