import {
  BoxGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
} from 'three';
import { KITCHEN_TABLE, type Hole } from '@golfwars/courses';
import {
  GolfSim,
  NO_INPUT,
  PHYSICS,
  STEP_DT,
  Windup,
  inBallReach,
  resolveBonks,
  type WindupInput,
  advance,
  beginPlay,
  createRound,
  currentHole,
  holeEndText,
  holeIntroText,
  initPhysics,
  previewShot,
  recordHoled,
  recordPenalty,
  recordStroke,
  restartRound,
  scorecard,
  type RoundState,
  type Vec3,
} from '@golfwars/shared';
import { AimPreview } from './aimPreview.js';
import { buildHoleMeshes } from './courseMeshes.js';
import { Hud } from './hud.js';
import type { Stage } from './scene.js';
import { ShotControls } from './shotControls.js';
import { WindupModel } from './windupModel.js';

const TABLE_COLOR = 0x6f8fb5;
const PLAYER_COLOR = 0x3d7bff;
const DUMMY_COLORS = [0xf2a33a, 0xa65fd6];
/** Practice dummies standing on hole 1 (feet positions), see T2.3. */
const DUMMY_SPOTS: [number, number, number][] = [
  [-0.6, 0, 2.6],
  [0.7, 0, 0.9],
];
const RING_COLOR_READY = 0x7ddc6b;
const RING_COLOR_FAR = 0xffffff;
/** The camera looks at this height above the Windup's feet. */
const CAMERA_HEIGHT = 0.6;
const INTRO_SECONDS = 2.4;
const HOLE_END_SECONDS = 3;

/** A Windup plus its mesh, with the last two physics positions for smooth rendering. */
class Actor {
  readonly model: WindupModel;
  prev: Vec3;
  cur: Vec3;

  constructor(
    readonly windup: Windup,
    color: number,
    scene: Group,
  ) {
    this.model = new WindupModel(color);
    scene.add(this.model.group);
    this.prev = this.cur = windup.position();
  }

  /** Call before stepping the Windup. */
  begin(): void {
    this.prev = this.cur;
  }

  /** Call after stepping the Windup. */
  end(): void {
    this.cur = this.windup.position();
  }

  /** Teleported (respawn): do not interpolate across the jump. */
  snap(): void {
    this.prev = this.cur = this.windup.position();
  }

  render(alpha: number, dt: number, sprinting: boolean): Vec3 {
    const x = this.prev[0] + (this.cur[0] - this.prev[0]) * alpha;
    const y = this.prev[1] + (this.cur[1] - this.prev[1]) * alpha;
    const z = this.prev[2] + (this.cur[2] - this.prev[2]) * alpha;
    this.model.group.position.set(x, y, z);
    const w = this.windup;
    this.model.update(dt, {
      status: w.status,
      speed: w.horizontalSpeed,
      yaw: w.yaw,
      key: w.key.key,
      toppleProgress: w.toppleProgress,
      swingProgress: w.swingProgress,
      immune: w.immune,
      sprinting,
    });
    return [x, y, z];
  }

  dispose(scene: Group): void {
    scene.remove(this.model.group);
    this.model.dispose();
    this.windup.dispose();
  }
}

/** Orchestrates one offline round: physics sim, the Windup and dummies, meshes, input, HUD. */
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
  private readonly actorsGroup = new Group();
  private readonly ring = new Mesh(
    new RingGeometry(0.3, 0.38, 32),
    new MeshBasicMaterial({
      color: RING_COLOR_FAR,
      transparent: true,
      opacity: 0.7,
      side: DoubleSide,
    }),
  );
  private player!: Actor;
  private dummies: Actor[] = [];
  private nextId = 1;
  private swingQueued = false;
  private sprintingNow = false;
  private courseGroup: Group | null = null;
  private sim!: GolfSim;
  private scratch!: GolfSim;
  private hole!: Hole;
  private round: RoundState = createRound(KITCHEN_TABLE);
  /** Seconds until the current banner phase ends (intro / hole-end). */
  private phaseTimer = 0;
  private acc = 0;
  private prevPos: Vec3 = [0, 0, 0];
  private curPos: Vec3 = [0, 0, 0];

  constructor(private readonly stage: Stage) {
    this.ballMesh.castShadow = true;
    this.table.receiveShadow = true;
    this.ring.rotation.x = -Math.PI / 2;
    this.stage.scene.add(this.ballMesh, this.aim.object, this.table, this.actorsGroup, this.ring);
    this.stage.rig.onRightClick = () => (this.swingQueued = true);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat) this.swingQueued = true;
    });
    this.controls = new ShotControls(stage.renderer.domElement, stage.keys, {
      onShoot: (power, aimOffset) => this.shoot(power, aimOffset),
    });
  }

  async start(): Promise<void> {
    await initPhysics();
    this.enterHole();
    // Dev builds only (stripped from production): `?cheats` exposes a test hook on `window`.
    // Written inline (not as a method) so the whole block is dead-code-eliminated in production.
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('cheats')) {
      const actorInfo = (a: Actor) => ({
        id: a.windup.id,
        pos: a.windup.position(),
        status: a.windup.status,
        key: a.windup.key.key,
        frozen: a.windup.key.frozen,
        immune: a.windup.immune,
        toppleProgress: a.windup.toppleProgress,
      });
      (window as unknown as { golfwars: object }).golfwars = {
        /** Completes the current hole with the given total strokes. */
        holeOut: (strokes: number) => {
          if (this.round.phase !== 'playing') return false;
          while (this.round.strokes < strokes) this.round = recordStroke(this.round);
          this.onHoled();
          return true;
        },
        state: () => ({
          phase: this.round.phase,
          hole: this.round.index,
          strokes: this.round.strokes,
          ball: this.sim.position(),
          ballState: this.sim.state,
          player: actorInfo(this.player),
          dummies: this.dummies.map(actorInfo),
          cameraYaw: this.stage.rig.yaw,
          canShoot: this.canShoot(),
        }),
        /** Orbits the camera by the given yaw / pitch offsets (radians). */
        orbitCamera: (dYaw: number, dPitch = 0) => this.stage.rig.orbit(dYaw, dPitch),
        /** Turns the camera (and so the aim) to look at a world point from the Windup. */
        aimCameraAt: (x: number, z: number) => {
          const p = this.player.windup.position();
          this.stage.rig.yaw = Math.atan2(-(x - p[0]), -(z - p[2]));
        },
      };
    }
    this.stage.start((dt) => this.frame(dt));
  }

  /** Loads the round's current hole and shows its intro banner. */
  private enterHole(): void {
    this.hole = KITCHEN_TABLE[this.round.index]!;
    this.player?.dispose(this.actorsGroup);
    for (const d of this.dummies) d.dispose(this.actorsGroup);
    this.dummies = [];
    this.sim?.dispose();
    this.scratch?.dispose();
    this.sim = new GolfSim(this.hole);
    this.scratch = new GolfSim(this.hole);

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
    // Face the cup from the tee (or the hole's own startYaw, for doglegs).
    const [tx, , tz] = this.hole.tee;
    const [cx, , cz] = this.hole.cup.position;
    this.stage.rig.yaw =
      this.hole.startYaw === undefined
        ? Math.atan2(-(cx - tx), -(cz - tz))
        : (this.hole.startYaw * Math.PI) / 180;
    this.controls.resetAim();
    this.spawnActors();
    this.swingQueued = false;
    const [px, py, pz] = this.player.cur;
    this.stage.rig.snapTo(px, py + CAMERA_HEIGHT, pz);
    this.phaseTimer = INTRO_SECONDS;
    this.hud.setBanner(
      holeIntroText(this.round),
      `Hole ${this.round.index + 1} of ${this.round.holes.length}`,
    );
    this.updateHud();
  }

  /** The player (beside the ball, facing the aim direction) and, on hole 1, the practice dummies. */
  private spawnActors(): void {
    const win = new Windup(this.nextId++, this.sim.world, this.sim.loaded, [0, 0, 0]);
    win.respawnNear(this.sim.position(), this.stage.rig.yaw);
    this.player = new Actor(win, PLAYER_COLOR, this.actorsGroup);
    if (this.round.index !== 0) return;
    DUMMY_SPOTS.forEach((spot, i) => {
      const d = new Windup(this.nextId++, this.sim.world, this.sim.loaded, spot, 0);
      this.dummies.push(new Actor(d, DUMMY_COLORS[i % DUMMY_COLORS.length]!, this.actorsGroup));
    });
  }

  private shootYaw(aimOffset: number): number {
    return this.stage.rig.yaw + aimOffset;
  }

  private shoot(power: number, aimOffset: number): void {
    if (
      this.round.phase === 'playing' &&
      this.canShoot() &&
      this.sim.shoot(this.shootYaw(aimOffset), power)
    ) {
      this.player.model.playShot();
      this.round = recordStroke(this.round);
      this.controls.resetAim();
      this.updateHud();
    }
  }

  /** Shots need: round in play, ball at rest, the Windup within reach and on its feet. */
  private canShoot(): boolean {
    const w = this.player.windup;
    return (
      this.round.phase === 'playing' &&
      this.sim.state === 'resting' &&
      !w.key.frozen &&
      w.status !== 'topple' &&
      inBallReach(w.position(), this.sim.position())
    );
  }

  private updateHud(): void {
    const h = currentHole(this.round);
    this.hud.setStrokes(
      `Hole ${this.round.index + 1}: ${h.name}  |  Strokes ${this.round.strokes}  |  Par ${h.par}`,
    );
  }

  private onHoled(): void {
    this.round = recordHoled(this.round);
    const result = this.round.results.at(-1)!;
    this.hud.setBanner(holeEndText(result), `${this.hole.name} complete`);
    this.phaseTimer = HOLE_END_SECONDS;
    this.updateHud();
  }

  /** Advances the intro / hole-end banner phases; shows the scorecard at the end. */
  private tickPhase(dt: number): void {
    const { phase } = this.round;
    if (phase !== 'hole-intro' && phase !== 'hole-end') return;
    this.phaseTimer -= dt;
    if (this.phaseTimer > 0) return;
    if (phase === 'hole-intro') {
      this.round = beginPlay(this.round);
      this.hud.setBanner(null);
    } else {
      this.round = advance(this.round);
      if (this.round.phase === 'finished') {
        this.hud.setBanner(null);
        this.hud.showScorecard(scorecard(this.round), () => this.playAgain());
      } else {
        this.enterHole();
      }
    }
  }

  private playAgain(): void {
    this.round = restartRound(this.round);
    this.hud.showScorecard(null);
    this.enterHole();
  }

  private buildInput(): WindupInput {
    const k = this.stage.keys;
    const playing = this.round.phase === 'playing';
    if (!playing) return NO_INPUT;
    const input: WindupInput = {
      moveX: k.axis('KeyA', 'KeyD'),
      moveZ: k.axis('KeyS', 'KeyW'),
      cameraYaw: this.stage.rig.yaw,
      sprint: k.isDown('ShiftLeft') || k.isDown('ShiftRight'),
      jump: k.isDown('Space'),
      swing: this.swingQueued,
      aimYaw: this.controls.charging ? this.shootYaw(this.controls.aimOffset) : null,
    };
    this.swingQueued = false;
    return input;
  }

  /** One fixed 1/60 s tick: Windups, bonks, then the ball. */
  private tick(): void {
    const actors = [this.player, ...this.dummies];
    for (const a of actors) a.begin();
    this.prevPos = this.sim.position();

    const input = this.buildInput();
    this.sprintingNow = input.sprint && (input.moveX !== 0 || input.moveZ !== 0);
    const ev = this.player.windup.step(input);
    for (const d of this.dummies) d.windup.step();
    resolveBonks(actors.map((a) => a.windup));
    for (const a of actors) a.end();
    if (ev.fell) this.respawnPlayer();

    const sev = this.sim.step();
    this.curPos = this.sim.position();
    if (sev.outOfBounds) {
      this.round = recordPenalty(this.round, PHYSICS.outOfBoundsPenalty);
      this.prevPos = this.curPos;
      this.hud.showToast('Out of bounds! +1 stroke');
      this.updateHud();
    }
    if (sev.holed) this.onHoled();
  }

  /** The Windup fell off the table: back beside its ball, no penalty. */
  private respawnPlayer(): void {
    this.player.windup.respawnNear(this.sim.position(), this.stage.rig.yaw);
    this.player.snap();
    this.hud.showToast('Fell off the table! Back to your ball (no penalty)');
  }

  private frame(dt: number): void {
    this.acc += dt;
    while (this.acc >= STEP_DT) {
      this.tick();
      this.acc -= STEP_DT;
    }
    const alpha = this.acc / STEP_DT;
    const x = this.prevPos[0] + (this.curPos[0] - this.prevPos[0]) * alpha;
    const y = this.prevPos[1] + (this.curPos[1] - this.prevPos[1]) * alpha;
    const z = this.prevPos[2] + (this.curPos[2] - this.prevPos[2]) * alpha;
    this.ballMesh.position.set(x, y, z);
    const q = this.sim.rotation();
    this.ballMesh.quaternion.copy(new Quaternion(q[0], q[1], q[2], q[3]));

    const [px, py, pz] = this.player.render(alpha, dt, this.sprintingNow);
    for (const d of this.dummies) d.render(alpha, dt, false);

    // Camera: after a shot follow the ball until it rests, then go back to the Windup.
    if (this.sim.state === 'resting') this.stage.rig.setFollow(px, py + CAMERA_HEIGHT, pz);
    else this.stage.rig.setFollow(x, y, z);

    this.tickPhase(dt);
    const canShoot = this.canShoot();
    this.controls.setEnabled(canShoot);
    this.controls.update(dt);
    this.hud.setPower(this.controls.charging ? this.controls.power : null);

    const w = this.player.windup;
    this.hud.setKey(w.key.key, w.key.frozen);
    this.hud.setPrompt(this.promptText(canShoot));

    // Ring on the floor around a resting ball: green when the Windup is close enough to hit it.
    const showRing = this.round.phase === 'playing' && this.sim.state === 'resting';
    this.ring.visible = showRing;
    if (showRing) {
      this.ring.position.set(x, y - PHYSICS.ball.radius + 0.02, z);
      (this.ring.material as MeshBasicMaterial).color.setHex(
        canShoot ? RING_COLOR_READY : RING_COLOR_FAR,
      );
    }

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
    const wp = w.position();
    this.stage.debug.update(
      dt,
      this.sim.world,
      `ball ${p.map((n) => n.toFixed(2)).join(', ')}\nspeed ${Math.hypot(...v).toFixed(2)} m/s ${this.sim.state}\nsurface ${this.sim.surface ?? 'air'}\n` +
        `windup ${wp.map((n) => n.toFixed(2)).join(', ')} ${w.status}${w.onGround ? '' : ' (air)'}\nkey ${w.key.key.toFixed(2)}${w.key.frozen ? ' FROZEN' : ''}`,
    );
  }

  private promptText(canShoot: boolean): string | null {
    if (this.round.phase !== 'playing') return null;
    const w = this.player.windup;
    if (w.status === 'topple') return 'Bonked!';
    if (w.key.frozen) return 'Key unwound! Stand still, or find a Winding Post';
    if (this.controls.charging) return null;
    if (canShoot) return 'Hold left mouse to charge, release to hit';
    if (this.sim.state === 'resting') return 'Walk up to your ball to hit it';
    return null;
  }
}
