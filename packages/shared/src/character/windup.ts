import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { LoadedHole } from '@golfwars/courses';
import { PHYSICS, STEP_DT } from '../physics/config.js';
import {
  canBeBonked,
  canSwing,
  createBonk,
  hitWindowOpen,
  inHitbox,
  isSwinging,
  isToppled,
  startSwing,
  stepBonk,
  swingProgress,
  topple,
  type BonkState,
} from './bonk.js';
import { BONK, STAMINA, WINDUP } from './config.js';
import { WINDUP_GROUPS } from './groups.js';
import {
  canJump,
  canSprint,
  createKey,
  drainKey,
  isNearPost,
  stepKey,
  type KeyState,
} from './stamina.js';

type Vec3 = [number, number, number];

/** Animation / HUD state of a Windup. */
export type WindupStatus = 'idle' | 'run' | 'swing' | 'topple' | 'frozen';

/** One fixed step of control input. All fields are plain data so the server can send them. */
export interface WindupInput {
  /** Strafe axis, -1 (left) .. 1 (right), relative to the camera. */
  moveX: number;
  /** Forward axis, -1 (back) .. 1 (towards where the camera looks). */
  moveZ: number;
  /** Camera yaw in radians (0 = looking down -z); movement is relative to it. */
  cameraYaw: number;
  sprint: boolean;
  /** Jump held (a jump starts whenever grounded and the key can pay for it). */
  jump: boolean;
  /** Start a club swing now (the caller sends it for one step per click). */
  swing: boolean;
  /** Use the held gadget now (one step per key press). Ignored by the Windup itself: the match handles it. */
  gadget: boolean;
  /** When not null the Windup is planted (charging a shot) and turns to face this yaw. */
  aimYaw: number | null;
}

export const NO_INPUT: WindupInput = {
  moveX: 0,
  moveZ: 0,
  cameraYaw: 0,
  sprint: false,
  jump: false,
  swing: false,
  gadget: false,
  aimYaw: null,
};

/**
 * Outside influences on one step, decided by the match (gadgets) and not by the Windup itself:
 * `speedScale` multiplies the wanted walking speed (Gum Blob: 0.4), `drift` is an extra horizontal
 * displacement speed in m/s that is not part of the Windup's own velocity (Desk Fan wind).
 */
export interface WindupEnv {
  speedScale: number;
  drift: readonly [number, number];
}

export const NO_ENV: WindupEnv = { speedScale: 1, drift: [0, 0] };

export interface WindupEvents {
  /** Fell off the course: the caller should `respawnNear` the ball. */
  fell: boolean;
  jumped: boolean;
  swung: boolean;
  /** Finished getting up after being toppled. */
  gotUp: boolean;
}

/** Everything about a Windup that changes while playing (plain data; used for netcode rewinds). */
export interface WindupState {
  feet: Vec3;
  vel: Vec3;
  yaw: number;
  grounded: boolean;
  coyote: number;
  key: KeyState;
  bonk: BonkState;
}

export interface BonkHit {
  attacker: number;
  victim: number;
}

/**
 * A wind-up toy: kinematic capsule character controller (Rapier `KinematicCharacterController`)
 * plus the wind-up key and club-bonk state. It lives in the same Rapier world as the course (use
 * `GolfSim.world` / `GolfSim.loaded`) but is invisible to the ball (see `groups.ts`). Pure
 * simulation, no rendering: call `step()` once per fixed 1/60 s tick, before `GolfSim.step()`.
 * Same input sequence gives the same positions (Rapier is deterministic for identical calls).
 */
export class Windup {
  readonly key: KeyState = createKey();
  readonly bonk: BonkState = createBonk();
  /** Facing, radians (0 = towards -z). */
  yaw: number;
  private readonly collider: Collider;
  private readonly kcc: KinematicCharacterController;
  private readonly center = WINDUP.halfHeight + WINDUP.radius;
  private vel: Vec3 = [0, 0, 0];
  private feet: Vec3;
  private grounded = false;
  private coyote = 0;

  /** `feet` is the point on the floor the Windup stands on. `initPhysics()` must have resolved. */
  constructor(
    readonly id: number,
    private readonly world: World,
    private readonly loaded: LoadedHole,
    feet: Vec3,
    yaw = 0,
  ) {
    this.feet = [...feet];
    this.yaw = yaw;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(WINDUP.halfHeight, WINDUP.radius)
        .setCollisionGroups(WINDUP_GROUPS)
        .setSensor(true)
        .setTranslation(feet[0], feet[1] + this.center, feet[2]),
    );
    const c = WINDUP.controller;
    const kcc = world.createCharacterController(c.skin);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setSlideEnabled(true);
    kcc.enableAutostep(c.stepMaxHeight, c.stepMinWidth, false);
    kcc.setMaxSlopeClimbAngle((c.maxClimbSlopeDeg * Math.PI) / 180);
    kcc.setMinSlopeSlideAngle((c.minSlideSlopeDeg * Math.PI) / 180);
    kcc.enableSnapToGround(c.snapDistance);
    this.kcc = kcc;
    this.roundState();
    this.collider.setTranslation({
      x: this.feet[0],
      y: this.feet[1] + this.center,
      z: this.feet[2],
    });
  }

  /** Position of the feet [x, y, z]. */
  position(): Vec3 {
    return [...this.feet];
  }

  velocity(): Vec3 {
    return [...this.vel];
  }

  get onGround(): boolean {
    return this.grounded;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel[0], this.vel[2]);
  }

  get status(): WindupStatus {
    if (isToppled(this.bonk)) return 'topple';
    if (this.key.frozen) return 'frozen';
    if (isSwinging(this.bonk)) return 'swing';
    return this.horizontalSpeed > 0.8 ? 'run' : 'idle';
  }

  /** Normalised swing progress 0..1, or null. */
  get swingProgress(): number | null {
    return swingProgress(this.bonk);
  }

  /** 0..1 through the topple (fall, lie, get up), or null when standing. */
  get toppleProgress(): number | null {
    return isToppled(this.bonk) ? 1 - this.bonk.toppleT / BONK.toppleSeconds : null;
  }

  get immune(): boolean {
    return this.bonk.immuneT > 0;
  }

  /** A deep copy of the full simulation state. */
  getState(): WindupState {
    return {
      feet: [...this.feet],
      vel: [...this.vel],
      yaw: this.yaw,
      grounded: this.grounded,
      coyote: this.coyote,
      key: { ...this.key },
      bonk: { ...this.bonk, hit: [...this.bonk.hit] },
    };
  }

  /** Restores a state from `getState()` (or the network); the next `step` continues from it. */
  setState(s: WindupState): void {
    this.feet = [...s.feet];
    this.vel = [...s.vel];
    this.yaw = s.yaw;
    this.grounded = s.grounded;
    this.coyote = s.coyote;
    this.key.key = s.key.key;
    this.key.frozen = s.key.frozen;
    Object.assign(this.bonk, s.bonk, { hit: [...s.bonk.hit] });
    this.roundState();
    this.collider.setTranslation({
      x: this.feet[0],
      y: this.feet[1] + this.center,
      z: this.feet[2],
    });
  }

  /** Teleports onto `feet` (no collision check) and stops. */
  setPosition(feet: Vec3): void {
    this.feet = [...feet];
    this.vel = [0, 0, 0];
    this.coyote = 0;
    this.roundState();
    this.collider.setTranslation({
      x: this.feet[0],
      y: this.feet[1] + this.center,
      z: this.feet[2],
    });
  }

  /**
   * Puts the Windup on the floor next to `ball` (a ball-centre position) on a free spot, looking
   * along `facingYaw`. Tries the point beside (left of) the ball first, then a ring around the ball.
   * Returns the chosen feet position.
   */
  respawnNear(ball: Vec3, facingYaw: number): Vec3 {
    const spot = this.findSpot(ball, facingYaw) ?? [
      ball[0],
      ball[1] - PHYSICS.ball.radius,
      ball[2],
    ];
    this.setPosition(spot);
    this.yaw = facingYaw;
    return spot;
  }

  /** Called by `resolveBonks` when a club hits this Windup. */
  receiveBonk(attacker: Vec3): void {
    topple(this.bonk);
    drainKey(this.key, BONK.keyLoss);
    const dx = this.feet[0] - attacker[0];
    const dz = this.feet[2] - attacker[2];
    const d = Math.hypot(dx, dz) || 1;
    this.vel[0] = (dx / d) * BONK.knockSpeed;
    this.vel[2] = (dz / d) * BONK.knockSpeed;
    this.roundState();
  }

  /** Advances one fixed step. */
  step(input: WindupInput = NO_INPUT, env: WindupEnv = NO_ENV): WindupEvents {
    const dt = STEP_DT;
    const events: WindupEvents = { fell: false, jumped: false, swung: false, gotUp: false };
    events.gotUp = stepBonk(this.bonk, dt);

    const toppled = isToppled(this.bonk);
    const controllable = !toppled && !this.key.frozen;
    const planted = input.aimYaw !== null;

    if (input.swing && controllable && !planted && canSwing(this.bonk, this.key.frozen)) {
      startSwing(this.bonk);
      this.yaw = input.cameraYaw; // the club goes where the camera looks
      events.swung = true;
    }
    const swinging = isSwinging(this.bonk);

    // Wanted horizontal velocity, camera relative.
    let wx = 0;
    let wz = 0;
    if (controllable && !planted) {
      let mx = input.moveX;
      let mz = input.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const s = Math.sin(input.cameraYaw);
      const c = Math.cos(input.cameraYaw);
      // forward = (-sin, -cos), right = (cos, -sin) on the XZ plane
      wx = c * mx - s * mz;
      wz = -s * mx - c * mz;
    }
    const wantLen = Math.hypot(wx, wz);
    const wantsMove = wantLen > 0.05;
    const sprinting = input.sprint && wantsMove && canSprint(this.key);
    let speed = sprinting ? WINDUP.sprintSpeed : WINDUP.walkSpeed;
    if (swinging) speed *= BONK.swingMoveScale;
    speed *= env.speedScale;
    const tx = wx * speed;
    const tz = wz * speed;
    const accel = toppled
      ? WINDUP.toppledDecel
      : this.grounded
        ? WINDUP.groundAccel
        : WINDUP.airAccel;
    const ddx = tx - this.vel[0];
    const ddz = tz - this.vel[2];
    const dd = Math.hypot(ddx, ddz);
    const maxD = accel * dt;
    if (dd <= maxD) {
      this.vel[0] = tx;
      this.vel[2] = tz;
    } else {
      this.vel[0] += (ddx / dd) * maxD;
      this.vel[2] += (ddz / dd) * maxD;
    }

    // Vertical: jump, gravity.
    this.coyote = this.grounded ? WINDUP.coyoteTime : Math.max(0, this.coyote - dt);
    if (controllable && input.jump && !planted && this.coyote > 0 && canJump(this.key)) {
      this.vel[1] = WINDUP.jumpSpeed;
      this.coyote = 0;
      this.grounded = false;
      events.jumped = true;
    } else if (this.grounded && this.vel[1] <= 0) {
      this.vel[1] = 0;
    } else {
      this.vel[1] = Math.max(this.vel[1] + PHYSICS.gravity * dt, -WINDUP.terminalSpeed);
    }

    // Move through the course with the character controller.
    if (this.vel[1] > 0) this.kcc.disableSnapToGround();
    else this.kcc.enableSnapToGround(WINDUP.controller.snapDistance);
    const want = {
      x: (this.vel[0] + env.drift[0]) * dt,
      y: this.vel[1] * dt,
      z: (this.vel[2] + env.drift[1]) * dt,
    };
    this.kcc.computeColliderMovement(
      this.collider,
      want,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      WINDUP_GROUPS,
    );
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    this.feet = [this.feet[0] + m.x, this.feet[1] + m.y, this.feet[2] + m.z];
    this.collider.setTranslation({
      x: this.feet[0],
      y: this.feet[1] + this.center,
      z: this.feet[2],
    });
    if (want.y > 0 && m.y < want.y * 0.5) this.vel[1] = 0; // bumped a ceiling
    if (this.grounded && this.vel[1] < 0) this.vel[1] = 0;

    // Facing.
    let targetYaw: number | null = null;
    if (!toppled && !this.key.frozen && !swinging) {
      if (planted) targetYaw = input.aimYaw;
      else if (wantsMove) targetYaw = Math.atan2(-wx, -wz);
    }
    if (targetYaw !== null) {
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      const maxTurn = WINDUP.turnSpeed * dt;
      this.yaw += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    }

    // The wind-up key.
    const idle =
      !toppled &&
      !wantsMove &&
      !swinging &&
      this.grounded &&
      this.horizontalSpeed < STAMINA.idleSpeed;
    stepKey(
      this.key,
      {
        sprinting,
        jumped: events.jumped,
        idle: idle || (this.key.frozen && !toppled),
        nearPost: isNearPost(this.loaded.windingPosts, this.feet[0], this.feet[2]),
      },
      dt,
    );

    this.roundState();
    events.fell = this.hasFallen();
    return events;
  }

  /**
   * Rounds all simulation state to float32 (what Rapier uses internally anyway). The network
   * sends state as float32, so after this a state that went over the wire is bit-identical to the
   * one it came from, and client prediction replays reproduce the server exactly.
   */
  private roundState(): void {
    const f = Math.fround;
    this.feet = [f(this.feet[0]), f(this.feet[1]), f(this.feet[2])];
    this.vel = [f(this.vel[0]), f(this.vel[1]), f(this.vel[2])];
    this.yaw = f(this.yaw);
    this.coyote = f(this.coyote);
    this.key.key = f(this.key.key);
    const b = this.bonk;
    if (b.swingT !== null) b.swingT = f(b.swingT);
    b.cooldown = f(b.cooldown);
    b.toppleT = f(b.toppleT);
    b.immuneT = f(b.immuneT);
  }

  dispose(): void {
    this.world.removeCollider(this.collider, false);
    this.world.removeCharacterController(this.kcc);
  }

  private hasFallen(): boolean {
    const b = this.loaded.bounds;
    const m = WINDUP.boundsMargin;
    const [x, y, z] = this.feet;
    return (
      y < b.minY - WINDUP.fallBelowMargin ||
      x < b.minX - m ||
      x > b.maxX + m ||
      z < b.minZ - m ||
      z > b.maxZ + m
    );
  }

  private findSpot(ball: Vec3, facingYaw: number): Vec3 | null {
    const shape = new RAPIER.Capsule(WINDUP.halfHeight, WINDUP.radius);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    // Start to the left of the aim, then sweep the ring (nearest ring first).
    const start = facingYaw - Math.PI / 2;
    for (const dist of [WINDUP.respawnDistance, WINDUP.respawnDistance * 1.5]) {
      for (let i = 0; i < 8; i++) {
        const a = start + (i * Math.PI) / 4;
        const x = ball[0] + Math.sin(a) * dist;
        const z = ball[2] + Math.cos(a) * dist;
        const origin = { x, y: ball[1] + 0.8, z };
        const hit = this.world.castRay(
          new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 }),
          2,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          WINDUP_GROUPS,
        );
        if (!hit) continue;
        const floorY = origin.y - hit.timeOfImpact;
        const centre = { x, y: floorY + this.center + 0.03, z };
        const blocked = this.world.intersectionWithShape(
          centre,
          rot,
          shape,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          WINDUP_GROUPS,
          this.collider,
        );
        if (!blocked) return [x, floorY, z];
      }
    }
    return null;
  }
}

/**
 * Applies club hits for one fixed step: every Windup whose swing is in its hit window bonks each
 * other Windup inside its arc (once per swing). Call after all `Windup.step()`s. Only Windups are
 * affected, never balls.
 */
export function resolveBonks(
  windups: readonly Windup[],
  /** Lag compensation: where the attacker saw `victim` (default: where it is now). */
  victimPosition: (attacker: Windup, victim: Windup) => Vec3 = (_a, v) => v.position(),
): BonkHit[] {
  const hits: BonkHit[] = [];
  for (const a of windups) {
    if (!hitWindowOpen(a.bonk)) continue;
    const from = a.position();
    for (const v of windups) {
      if (v === a || a.bonk.hit.includes(v.id) || !canBeBonked(v.bonk)) continue;
      if (!inHitbox(from, a.yaw, victimPosition(a, v))) continue;
      a.bonk.hit.push(v.id);
      v.receiveBonk(from);
      hits.push({ attacker: a.id, victim: v.id });
    }
  }
  return hits;
}

/** Can a Windup at `feet` start a shot at a ball (centre `ball`)? Ball must also be resting. */
export function inBallReach(feet: readonly number[], ball: readonly number[]): boolean {
  return (
    Math.hypot(feet[0]! - ball[0]!, feet[2]! - ball[2]!) <= WINDUP.ballReach &&
    Math.abs(ball[1]! - feet[1]!) <= 1.2
  );
}
