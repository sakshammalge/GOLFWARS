import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three';
import { WINDUP, type WindupStatus } from '@golfwars/shared';

/** What the model needs to know each frame (all plain numbers, so a remote player can drive it too). */
export interface WindupPose {
  status: WindupStatus;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Facing, radians (0 = towards -z). */
  yaw: number;
  /** Wind-up key 0..1. */
  key: number;
  /** 0..1 through the topple, or null. */
  toppleProgress: number | null;
  /** 0..1 through a club swing, or null. */
  swingProgress: number | null;
  /** Bonk immunity: the body shimmers. */
  immune: boolean;
  /** Sprinting (faster key spin). */
  sprinting: boolean;
}

const BRASS = 0xd9a441;
const SKIN = 0xf2e3c6;
const DARK = 0x2a2a33;
const WOOD = 0x9a6a3a;

/** Seconds a quick "hit the ball" club swing lasts. */
const SHOT_SWING_SECONDS = 0.35;

/**
 * Placeholder wind-up toy built from Three.js primitives: chunky body, head, small club and a
 * brass key on its back. Procedural animation only: idle bob, run bob + lean, swing, topple and
 * get up, frozen slump. `color` tints the body so players can be told apart.
 *
 * Local frame: feet at the origin, facing -z, back (and the key) towards +z, about 1.1 m tall.
 */
export class WindupModel {
  readonly group = new Group();
  private readonly pivot = new Group();
  private readonly body: Mesh;
  private readonly head: Group;
  private readonly keyGroup = new Group();
  private readonly armL = new Group();
  private readonly armRYaw = new Group();
  private readonly armRPitch = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly bodyMat: MeshStandardMaterial;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private t = Math.random() * 10;
  private keyAngle = 0;
  private shotT = -1;
  private runBlend = 0;

  constructor(color: number) {
    this.bodyMat = this.mat(color);
    const skin = this.mat(SKIN);
    const dark = this.mat(DARK);
    const brass = this.mat(BRASS, 0.45, 0.15);
    const wood = this.mat(WOOD);
    const accent = this.mat(new Color(color).multiplyScalar(0.7).getHex());

    // Torso (the tinted part) with a belly plate.
    this.body = this.mesh(new BoxGeometry(0.56, 0.5, 0.42), this.bodyMat, 0, 0.55, 0);
    const belly = this.mesh(new BoxGeometry(0.34, 0.26, 0.04), skin, 0, 0.52, -0.22);
    const belt = this.mesh(new BoxGeometry(0.58, 0.07, 0.44), accent, 0, 0.34, 0);

    // Head with eyes and a little antenna bolt.
    this.head = new Group();
    this.head.position.set(0, 0.95, 0);
    const skull = this.mesh(new DodecahedronGeometry(0.22, 0), skin, 0, 0, 0);
    const eyeL = this.mesh(new IcosahedronGeometry(0.045, 0), dark, -0.09, 0.03, -0.19);
    const eyeR = this.mesh(new IcosahedronGeometry(0.045, 0), dark, 0.09, 0.03, -0.19);
    const bolt = this.mesh(new CylinderGeometry(0.03, 0.03, 0.1, 6), brass, 0, 0.24, 0);
    this.head.add(skull, eyeL, eyeR, bolt);

    // Legs hang from the hips, feet are small boxes.
    for (const [leg, x] of [
      [this.legL, -0.15],
      [this.legR, 0.15],
    ] as const) {
      leg.position.set(x, 0.3, 0);
      leg.add(
        this.mesh(new BoxGeometry(0.15, 0.22, 0.15), accent, 0, -0.1, 0),
        this.mesh(new BoxGeometry(0.19, 0.08, 0.28), dark, 0, -0.26, -0.04),
      );
    }

    // Left arm (empty) and right arm (club): yaw group sweeps, pitch group raises.
    this.armL.position.set(-0.36, 0.72, 0);
    this.armL.add(this.mesh(new BoxGeometry(0.12, 0.36, 0.12), skin, 0, -0.16, 0));
    this.armRYaw.position.set(0.36, 0.72, 0);
    this.armRYaw.add(this.armRPitch);
    this.armRPitch.add(
      this.mesh(new BoxGeometry(0.12, 0.3, 0.12), skin, 0, -0.13, 0),
      this.mesh(new CylinderGeometry(0.03, 0.03, 0.5, 6), wood, 0, -0.42, 0),
      this.mesh(new BoxGeometry(0.1, 0.2, 0.2), wood, 0, -0.72, 0),
    );

    // The wind-up key on the back: stem plus two flat wings, spinning around z.
    this.keyGroup.position.set(0, 0.58, 0.3);
    this.keyGroup.add(
      this.mesh(new CylinderGeometry(0.04, 0.04, 0.16, 6), brass, 0, 0, 0.04, Math.PI / 2),
      this.mesh(new BoxGeometry(0.4, 0.14, 0.04), brass, 0, 0, 0.14),
      this.mesh(new BoxGeometry(0.14, 0.4, 0.04), brass, 0, 0, 0.1),
    );

    this.pivot.add(
      this.body,
      belly,
      belt,
      this.head,
      this.legL,
      this.legR,
      this.armL,
      this.armRYaw,
      this.keyGroup,
    );
    this.group.add(this.pivot);
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
  }

  /** Re-tints the body (player colour). */
  setColor(color: number): void {
    this.bodyMat.color.setHex(color);
  }

  /** Plays the quick club swing used when hitting the ball. */
  playShot(): void {
    this.shotT = 0;
  }

  /** Current angle of the key (radians), for tests / debug. */
  get keySpin(): number {
    return this.keyAngle;
  }

  update(dt: number, pose: WindupPose): void {
    this.t += dt;
    const { status } = pose;
    this.group.rotation.y = pose.yaw;

    // Key spin: faster while sprinting, slower the less key is left, stopped when frozen.
    const rate =
      status === 'frozen'
        ? 0
        : (0.3 + 2.2 * pose.key) * (pose.sprinting ? 3 : status === 'run' ? 1.6 : 1);
    this.keyAngle += rate * dt * (status === 'topple' ? 0.3 : 1) * 2;
    this.keyGroup.rotation.z = this.keyAngle;

    const moving = status === 'run' ? Math.min(1, pose.speed / WINDUP.walkSpeed) : 0;
    this.runBlend = MathUtils.lerp(this.runBlend, moving, 1 - Math.exp(-12 * dt));
    const run = this.runBlend;
    const phase = this.t * (pose.sprinting ? 17 : 12);

    // Defaults: idle bob.
    let lift = Math.sin(this.t * 2.2) * 0.012 * (1 - run) + Math.abs(Math.sin(phase)) * 0.06 * run;
    let lean = -0.18 * run;
    let armLX = Math.sin(phase) * 0.9 * run;
    let armRPitch = 0.7 - Math.sin(phase) * 0.5 * run;
    let armRYaw = 0;
    let headX = 0;

    if (status === 'frozen') {
      lift = 0;
      lean = -0.4;
      headX = 0.5;
      armLX = 0.25;
      armRPitch = 0.2;
    }

    if (this.shotT >= 0) {
      this.shotT += dt;
      const p = this.shotT / SHOT_SWING_SECONDS;
      if (p >= 1) this.shotT = -1;
      else {
        // Back-swing, then through, like a putt: pitch the club arm only.
        const k = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
        armRPitch = p < 0.4 ? 0.7 - 1.3 * k : -0.6 + 1.9 * (1 - k) ** 0.6;
      }
    }

    let pivotRotX = lean;
    let pivotY = lift;

    if (status === 'swing' && pose.swingProgress !== null) {
      const p = pose.swingProgress;
      // Wind up to the left, sweep to the right through the hit window, then recover.
      const sweep =
        p < 0.27 ? p / 0.27 : p < 0.67 ? 1 - ((p - 0.27) / 0.4) * 2 : -1 + (p - 0.67) / 0.33;
      armRPitch = Math.PI / 2;
      armRYaw = sweep * 1.4;
      lean = -0.1;
      pivotRotX = lean;
    }

    if (status === 'topple' && pose.toppleProgress !== null) {
      const p = pose.toppleProgress;
      // Fall forward in the first 20%, lie still, get back up in the last 25%.
      const f = p < 0.2 ? p / 0.2 : p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
      const e = f * f * (3 - 2 * f);
      pivotRotX = -e * (Math.PI / 2 - 0.1);
      pivotY = e * 0.27;
      armLX = -e * 1.2;
      armRPitch = 0.7 + e * 1.2;
      headX = 0;
    }

    this.pivot.position.y = pivotY;
    this.pivot.rotation.x = pivotRotX;
    this.head.rotation.x = headX;
    this.armL.rotation.x = armLX;
    this.armRPitch.rotation.x = armRPitch;
    this.armRYaw.rotation.y = armRYaw;
    this.legL.rotation.x = -Math.sin(phase) * 0.9 * run;
    this.legR.rotation.x = Math.sin(phase) * 0.9 * run;

    // Immune after a bonk: the body shimmers.
    const glow = pose.immune ? 0.25 + 0.25 * Math.sin(this.t * 18) : 0;
    this.bodyMat.emissive.setRGB(glow, glow, glow);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private mat(color: number, roughness = 0.8, metalness = 0): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color, flatShading: true, roughness, metalness });
    this.materials.push(m);
    return m;
  }

  private mesh(
    geo: BufferGeometry,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    rotX = 0,
  ): Mesh {
    this.geometries.push(geo);
    const m = new Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    return m;
  }
}
