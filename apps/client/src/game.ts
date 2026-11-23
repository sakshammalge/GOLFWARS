import {
  BoxGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
} from 'three';
import { KITCHEN_TABLE, type Hole } from '@golfwars/courses';
import { GolfSim, PHYSICS, STEP_DT, initPhysics, previewShot, type Vec3 } from '@golfwars/shared';
import { AimPreview } from './aimPreview.js';
import { buildHoleMeshes } from './courseMeshes.js';
import { Hud } from './hud.js';
import type { Stage } from './scene.js';
import { ShotControls } from './shotControls.js';

const TABLE_COLOR = 0x6f8fb5;

/** Orchestrates one offline round: physics sim, meshes, shot input, HUD. */
export class Game {
  private readonly hud = new Hud();
  private readonly aim = new AimPreview();
  private readonly controls: ShotControls;
  private readonly ballMesh = new Mesh(
    new IcosahedronGeometry(PHYSICS.ball.radius, 1),
    new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.6 }),
  );
  private readonly table = new Mesh(
    new BoxGeometry(120, 1, 120),
    new MeshStandardMaterial({ color: TABLE_COLOR, flatShading: true, roughness: 1 }),
  );
  private courseGroup: Group | null = null;
  private sim!: GolfSim;
  private scratch!: GolfSim;
  private hole!: Hole;
  private strokes = 0;
  private acc = 0;
  private prevPos: Vec3 = [0, 0, 0];
  private curPos: Vec3 = [0, 0, 0];

  constructor(private readonly stage: Stage) {
    this.ballMesh.castShadow = true;
    this.table.receiveShadow = true;
    this.stage.scene.add(this.ballMesh, this.aim.object, this.table);
    this.controls = new ShotControls(stage.renderer.domElement, stage.keys, {
      onShoot: (power, aimOffset) => this.shoot(power, aimOffset),
    });
  }

  async start(): Promise<void> {
    await initPhysics();
    this.loadHole(0);
    this.stage.start((dt) => this.frame(dt));
  }

  private loadHole(index: number): void {
    this.hole = KITCHEN_TABLE[index]!;
    this.sim?.dispose();
    this.scratch?.dispose();
    this.sim = new GolfSim(this.hole);
    this.scratch = new GolfSim(this.hole);
    this.strokes = 0;

    if (this.courseGroup) this.stage.scene.remove(this.courseGroup);
    this.courseGroup = buildHoleMeshes(this.hole);
    this.stage.scene.add(this.courseGroup);

    const b = this.sim.loaded.bounds;
    this.table.position.set((b.minX + b.maxX) / 2, b.minY - 0.5 - 0.01, (b.minZ + b.maxZ) / 2);
    this.stage.fitShadows(
      (b.minX + b.maxX) / 2,
      (b.minZ + b.maxZ) / 2,
      (b.maxX - b.minX) / 2,
      (b.maxZ - b.minZ) / 2,
    );

    this.curPos = this.prevPos = this.sim.position();
    // Face the cup from the tee.
    const [tx, , tz] = this.hole.tee;
    const [cx, , cz] = this.hole.cup.position;
    this.stage.rig.yaw = Math.atan2(-(cx - tx), -(cz - tz));
    this.stage.rig.snapTo(...this.curPos);
    this.controls.resetAim();
    this.updateHud();
  }

  private shootYaw(aimOffset: number): number {
    return this.stage.rig.yaw + aimOffset;
  }

  private shoot(power: number, aimOffset: number): void {
    if (this.sim.shoot(this.shootYaw(aimOffset), power)) {
      this.strokes++;
      this.controls.resetAim();
      this.updateHud();
    }
  }

  private updateHud(): void {
    this.hud.setStrokes(`${this.hole.name}  |  Stroke ${this.strokes}  |  Par ${this.hole.par}`);
  }

  private frame(dt: number): void {
    this.acc += dt;
    while (this.acc >= STEP_DT) {
      this.prevPos = this.sim.position();
      const ev = this.sim.step();
      this.curPos = this.sim.position();
      if (ev.outOfBounds) {
        this.strokes += PHYSICS.outOfBoundsPenalty;
        this.prevPos = this.curPos;
        this.hud.showToast('Out of bounds! +1 stroke');
        this.updateHud();
      }
      this.acc -= STEP_DT;
    }
    const alpha = this.acc / STEP_DT;
    const x = this.prevPos[0] + (this.curPos[0] - this.prevPos[0]) * alpha;
    const y = this.prevPos[1] + (this.curPos[1] - this.prevPos[1]) * alpha;
    const z = this.prevPos[2] + (this.curPos[2] - this.prevPos[2]) * alpha;
    this.ballMesh.position.set(x, y, z);
    const q = this.sim.rotation();
    this.ballMesh.quaternion.copy(new Quaternion(q[0], q[1], q[2], q[3]));
    this.stage.rig.setFollow(x, y, z);

    const canShoot = this.sim.state === 'resting';
    this.controls.setEnabled(canShoot);
    this.controls.update(dt);
    this.hud.setPower(this.controls.charging ? this.controls.power : null);

    if (canShoot) {
      const power = this.controls.charging ? this.controls.power : this.controls.lastPower;
      const yaw = this.shootYaw(this.controls.aimOffset);
      const prev = previewShot(this.scratch, this.sim.position(), yaw, Math.max(power, 0.05));
      this.aim.set(prev.points);
    } else {
      this.aim.hide();
    }

    const p = this.sim.position();
    const v = this.sim.velocity();
    this.stage.debug.update(
      dt,
      this.sim.world,
      `ball ${p.map((n) => n.toFixed(2)).join(', ')}\nspeed ${Math.hypot(...v).toFixed(2)} m/s ${this.sim.state}\nsurface ${this.sim.surface ?? 'air'}`,
    );
  }
}
