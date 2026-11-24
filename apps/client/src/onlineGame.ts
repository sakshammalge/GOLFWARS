import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { KITCHEN_TABLE, KITCHEN_TABLE_NAME, type Hole } from '@golfwars/courses';
import {
  GolfSim,
  NET,
  NO_INPUT,
  PHYSICS,
  PLAYER_COLORS,
  STEP_DT,
  VisualSmoother,
  WINDUP,
  Windup,
  Predictor,
  createCourseWorld,
  holeIntroText,
  ordinal,
  inBallReach,
  previewShot,
  toEntry,
  type CourseWorld,
  type GameEvent,
  type InputEntry,
  type MatchPhase,
  type ReconcileResult,
  type RenderPlayer,
  type ShotTuple,
  type Snapshot,
  type Vec3,
  type WindupInput,
} from '@golfwars/shared';
import { AimPreview } from './aimPreview.js';
import { buildHoleMeshes } from './courseMeshes.js';
import { Hud } from './hud.js';
import type { Connection } from './net/connection.js';
import type { Stage } from './scene.js';
import { ShotControls } from './shotControls.js';
import { HoleResults, Leaderboard, MatchBoard, readPlayers, type PlayerRow } from './ui/matchUi.js';
import { Nameplates } from './ui/nameplates.js';
import type { NetPanel } from './ui/netPanel.js';
import { WindupModel } from './windupModel.js';

const TABLE_COLOR = 0x6f8fb5;
const RING_COLOR_READY = 0x7ddc6b;
const RING_COLOR_FAR = 0xffffff;
/** The camera looks at this height above the Windup's feet. */
const CAMERA_HEIGHT = 0.6;
/** Height above the feet where nicknames float. */
const NAMEPLATE_HEIGHT = 1.45;
/** After taking a shot the client waits this long (ms) for the server before allowing another. */
const SHOT_LOCKOUT_MS = 700;

const colorHex = (i: number): number => PLAYER_COLORS[i]?.hex ?? 0xffffff;

/** A remote player's Windup model and ball mesh. */
class RemoteActor {
  readonly model: WindupModel;
  readonly ball: Mesh;
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private readonly dq = new Quaternion();

  constructor(
    color: number,
    private readonly scene: Group,
    ballScale = 1,
  ) {
    this.model = new WindupModel(color);
    this.ball = new Mesh(
      new IcosahedronGeometry(PHYSICS.ball.radius, 1),
      new MeshStandardMaterial({
        color: new Color(color).lerp(new Color(0xffffff), 0.55),
        flatShading: true,
        roughness: 0.6,
      }),
    );
    this.ball.castShadow = true;
    // Balls never collide, so on the shared tee they overlap: others' are a bit smaller so your
    // own ball is always the one you see.
    this.ball.scale.setScalar(ballScale);
    scene.add(this.model.group, this.ball);
  }

  /** Rolls the ball mesh along its velocity (the server sends no rotation). */
  roll(vel: Vec3, dt: number): void {
    const hs = Math.hypot(vel[0], vel[2]);
    if (hs < 0.02) return;
    this.axis.set(vel[2], 0, -vel[0]).normalize();
    this.dq.setFromAxisAngle(this.axis, (hs * dt) / PHYSICS.ball.radius);
    this.q.premultiply(this.dq);
    this.ball.quaternion.copy(this.q);
  }

  dispose(): void {
    this.scene.remove(this.model.group, this.ball);
    this.model.dispose();
    this.ball.geometry.dispose();
    (this.ball.material as MeshStandardMaterial).dispose();
  }
}

/**
 * One online match from the client's side. Own Windup: the shared character controller runs
 * locally on each input (client-side prediction) and is rewound and replayed on every server
 * snapshot (reconciliation). Everything else (other Windups, every ball) is drawn from the
 * snapshot buffer about 100 ms in the past. Shots and bonks are requests: the server decides.
 */
export class OnlineGame {
  private readonly hud = new Hud();
  private readonly aim = new AimPreview();
  private readonly controls: ShotControls;
  private readonly leaderboard = new Leaderboard();
  private readonly board = new MatchBoard();
  private readonly results = new HoleResults();
  private readonly plates = new Nameplates();
  private readonly table = new Mesh(
    new BoxGeometry(120, 1, 120),
    new MeshStandardMaterial({ color: TABLE_COLOR, flatShading: true, roughness: 1 }),
  );
  private readonly sceneGroup = new Group();
  private readonly ring = new Mesh(
    new RingGeometry(0.3, 0.38, 32),
    new MeshBasicMaterial({
      color: RING_COLOR_FAR,
      transparent: true,
      opacity: 0.7,
      side: DoubleSide,
    }),
  );
  private readonly smoother = new VisualSmoother();
  private readonly remotes = new Map<number, RemoteActor>();
  private courseGroup: Group | null = null;

  private active = false;
  private holeIndex = -1;
  private hole: Hole | null = null;
  private course: CourseWorld | null = null;
  private scratch: GolfSim | null = null;
  private predictor: Predictor | null = null;
  private ownModel: WindupModel | null = null;
  /** The predictor's Windup lives in `course.world` (false once that world is freed). */
  private windupLive = false;
  private ready = false;
  private slot = -1;
  private players: PlayerRow[] = [];
  private latest: Snapshot | null = null;
  private phase: MatchPhase = 'hole-intro';

  private acc = 0;
  private prevPos: Vec3 = [0, 0, 0];
  private curPos: Vec3 = [0, 0, 0];
  private outbox: { seq: number; entry: InputEntry }[] = [];
  private pendingShot: ShotTuple | null = null;
  private shotLockUntil = 0;
  private swingQueued = false;
  private sprintingNow = false;

  // Prediction error stats for the F3 panel.
  private lastErrCm = 0;
  private errWindow: { t: number; cm: number }[] = [];
  private corrections = 0;

  private conn!: Connection;

  constructor(
    private readonly stage: Stage,
    private readonly panel: NetPanel,
  ) {
    this.table.receiveShadow = true;
    this.ring.rotation.x = -Math.PI / 2;
    this.sceneGroup.add(this.table, this.ring, this.aim.object);
    this.stage.scene.add(this.sceneGroup);
    this.stage.rig.onRightClick = () => (this.swingQueued = this.active);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat && this.active) this.swingQueued = true;
    });
    this.controls = new ShotControls(stage.renderer.domElement, stage.keys, {
      onShoot: (power, aimOffset) => this.shoot(power, aimOffset),
    });
    this.hud.setVisible(false);
    this.sceneGroup.visible = false;

    this.installCheats();
  }

  /** Hooks this game up to a (new) connection's snapshots and events. */
  bind(conn: Connection): void {
    this.conn = conn;
    conn.onSnapshot = (s) => this.onSnapshot(s);
    conn.onEvents = (e) => this.onEvents(e);
  }

  // ------------------------------------------------------------- lifecycle

  /** The room switched to the match phase. */
  begin(): void {
    if (this.active) return;
    this.active = true;
    this.hud.setVisible(true);
    this.sceneGroup.visible = true;
    this.holeIndex = -1;
    this.ready = false;
    this.latest = null;
    this.phase = 'hole-intro';
    this.outbox = [];
    this.pendingShot = null;
    this.acc = 0;
    this.readSlot();
    this.onStateChange();
  }

  /** Back to the lobby (rematch) or the connection ended. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.hud.setVisible(false);
    this.sceneGroup.visible = false;
    this.leaderboard.hide();
    this.board.hide();
    this.results.hide();
    this.plates.clear();
    this.disposeHole();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.controls.setEnabled(false);
    this.hud.setBanner(null);
  }

  private readSlot(): void {
    const me = this.conn.state?.players?.get(this.conn.sessionId);
    if (me) this.slot = me.slot;
  }

  private disposeHole(): void {
    if (this.courseGroup) this.stage.scene.remove(this.courseGroup);
    this.courseGroup = null;
    if (this.ownModel) {
      this.sceneGroup.remove(this.ownModel.group);
      this.ownModel.dispose();
      this.ownModel = null;
    }
    if (this.windupLive) this.predictor?.windup.dispose();
    this.windupLive = false;
    this.course?.world.free();
    this.course = null;
    this.scratch?.dispose();
    this.scratch = null;
  }

  /** Builds the local prediction world, meshes and camera for a hole. */
  private loadHole(index: number): void {
    this.disposeHole();
    this.holeIndex = index;
    const hole = KITCHEN_TABLE[index] ?? KITCHEN_TABLE[0]!;
    this.hole = hole;
    this.course = createCourseWorld(hole);
    this.scratch = new GolfSim(hole);
    const windup = new Windup(this.slot, this.course.world, this.course.loaded, [0, 0, 0]);
    // Sequence numbers must keep counting across holes (the server drops old ones).
    if (this.predictor) this.predictor.replaceWindup(windup);
    else this.predictor = new Predictor(windup);
    this.windupLive = true;
    this.ownModel = new WindupModel(colorHex(this.myColor()));
    this.sceneGroup.add(this.ownModel.group);
    this.ready = false;
    this.smoother.reset();

    this.courseGroup = buildHoleMeshes(hole);
    this.stage.scene.add(this.courseGroup);
    const b = this.course.loaded.bounds;
    this.table.position.set((b.minX + b.maxX) / 2, b.minY - 0.5 - 0.01, (b.minZ + b.maxZ) / 2);
    this.stage.fitShadows(
      (b.minX + b.maxX) / 2,
      (b.minZ + b.maxZ) / 2,
      (b.maxX - b.minX) / 2,
      (b.maxZ - b.minZ) / 2,
    );
    const [tx, , tz] = hole.tee;
    const [cx, , cz] = hole.cup.position;
    this.stage.rig.yaw =
      hole.startYaw === undefined
        ? Math.atan2(-(cx - tx), -(cz - tz))
        : (hole.startYaw * Math.PI) / 180;
    this.controls.resetAim();
    this.swingQueued = false;
  }

  private myColor(): number {
    return this.players.find((p) => p.slot === this.slot)?.color ?? 0;
  }

  // --------------------------------------------------------------- network

  /** Room state changed: roster, scores, phase, timer. */
  onStateChange(): void {
    if (!this.active) return;
    const state = this.conn.state;
    if (!state?.players) return;
    this.readSlot();
    this.players = readPlayers(state);
    const holes = KITCHEN_TABLE;
    const pars = holes.map((h) => h.par);
    this.leaderboard.update(this.players, this.conn.sessionId);

    const mp = state.matchPhase as MatchPhase;
    const idx = state.holeIndex as number;
    const hole = holes[idx] ?? holes[0]!;
    const left = state.timeLeft as number;
    if (mp === 'hole-intro') {
      this.hud.setBanner(
        holeIntroText({ holes, index: idx, phase: 'hole-intro', strokes: 0, results: [] }),
        `Hole ${idx + 1} of ${holes.length}  -  starting in ${left}`,
      );
    } else {
      this.hud.setBanner(null);
    }
    if (mp === 'hole-end') this.results.show(this.players, idx, hole.name, hole.par, left);
    else this.results.hide();
    if (mp === 'results') {
      this.board.show(
        this.players,
        KITCHEN_TABLE_NAME,
        holes.map((h) => h.name),
        pars,
        this.conn.sessionId,
        state.hostId === this.conn.sessionId,
        {
          vote: (v) => this.conn.send('rvote', { v }),
          again: () => this.conn.send('rematch', { mode: 'again' }),
          lobby: () => this.conn.send('rematch', { mode: 'lobby' }),
          leave: () => this.conn.leave(),
        },
      );
    } else {
      this.board.hide();
    }
    this.updateStrokesText(mp, idx);
  }

  private updateStrokesText(mp: MatchPhase, idx: number): void {
    const state = this.conn.state;
    const hole = KITCHEN_TABLE[idx] ?? KITCHEN_TABLE[0]!;
    const me = this.players.find((p) => p.slot === this.slot);
    const left = state?.timeLeft as number;
    const clock =
      mp === 'playing' ? `  |  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    this.hud.setStrokes(
      `Hole ${idx + 1}: ${hole.name}  |  Strokes ${me?.strokes ?? 0}  |  Par ${hole.par}${clock}`,
    );
  }

  private onSnapshot(snap: Snapshot): void {
    if (!this.active) return;
    if (snap.holeIndex !== this.holeIndex) {
      this.readSlot();
      this.players = readPlayers(this.conn.state);
      this.loadHole(snap.holeIndex);
    }
    this.latest = snap;
    this.phase = snap.phase;
    if (snap.own && this.predictor) {
      const r = this.predictor.reconcile(snap.ack, snap.own);
      this.afterReconcile(r, !this.ready);
      this.ready = true;
    }
  }

  private afterReconcile(r: ReconcileResult, first: boolean): void {
    const pos = this.predictor!.windup.position();
    if (first || r.snapped) {
      this.prevPos = pos;
      this.curPos = pos;
      this.smoother.reset();
      if (first) this.stage.rig.snapTo(pos[0], pos[1] + CAMERA_HEIGHT, pos[2]);
    } else {
      this.prevPos = [
        this.prevPos[0] + r.delta[0],
        this.prevPos[1] + r.delta[1],
        this.prevPos[2] + r.delta[2],
      ];
      this.curPos = pos;
      this.smoother.correct(r);
    }
    const cm = r.error * 100;
    this.lastErrCm = cm;
    this.errWindow.push({ t: performance.now(), cm });
    if (r.error > NET.prediction.deadZone) this.corrections++;
  }

  private onEvents(events: GameEvent[]): void {
    if (!this.active) return;
    const name = (slot: number): string =>
      this.players.find((p) => p.slot === slot)?.nickname ?? `Player ${slot + 1}`;
    for (const e of events) {
      switch (e.k) {
        case 'bonk':
          if (e.v === this.slot) this.hud.showToast(`${name(e.a)} bonked you!`);
          else if (e.a === this.slot) this.hud.showToast(`Bonk! ${name(e.v)} is down`);
          break;
        case 'oob':
          if (e.p === this.slot) this.hud.showToast('Out of bounds! +1 stroke');
          break;
        case 'fell':
          if (e.p === this.slot)
            this.hud.showToast('Fell off the table! Back to your ball (no penalty)');
          break;
        case 'holed': {
          const bonus = e.b < 0 ? ` (${e.b} bonus)` : '';
          this.hud.showToast(
            e.p === this.slot
              ? `You holed out in ${e.s} - ${ordinal(e.r)} to finish${bonus}!`
              : `${name(e.p)} holed out in ${e.s} - ${ordinal(e.r)}${bonus}`,
          );
          break;
        }
        case 'timeout':
          if (e.p === this.slot) this.hud.showToast("Time's up! Par + 3 for this hole");
          break;
        case 'shot':
          if (e.p !== this.slot) this.remotes.get(e.p)?.model.playShot();
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ input

  private buildInput(): WindupInput {
    const k = this.stage.keys;
    const base = { ...NO_INPUT, cameraYaw: this.stage.rig.yaw };
    const me = this.players.find((p) => p.slot === this.slot);
    if (this.phase !== 'playing' || me?.abandoned) {
      this.swingQueued = false;
      return base;
    }
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

  private shootYaw(aimOffset: number): number {
    return this.stage.rig.yaw + aimOffset;
  }

  private ownBall(): { pos: Vec3; phase: string } | null {
    const p = this.latest?.players.find((q) => q.slot === this.slot);
    return p ? { pos: p.ball.pos, phase: p.ball.phase } : null;
  }

  private canShoot(): boolean {
    const w = this.predictor?.windup;
    const ball = this.ownBall();
    if (!w || !ball || !this.ready) return false;
    return (
      this.phase === 'playing' &&
      ball.phase === 'resting' &&
      performance.now() > this.shotLockUntil &&
      !w.key.frozen &&
      w.status !== 'topple' &&
      inBallReach(w.position(), ball.pos)
    );
  }

  /** Release of the charge: ask the server for the shot; the swing plays immediately. */
  private shoot(power: number, aimOffset: number): void {
    if (!this.canShoot()) return;
    this.pendingShot = [this.stage.rig.yaw, aimOffset, power];
    this.shotLockUntil = performance.now() + SHOT_LOCKOUT_MS;
    this.ownModel?.playShot();
    this.controls.resetAim();
  }

  /** One fixed 1/60 s tick: predict locally and queue the input for the server. */
  private tick(): void {
    const predictor = this.predictor;
    if (!predictor || !this.ready) return;
    this.prevPos = this.curPos;
    const input = this.buildInput();
    this.sprintingNow = input.sprint && (input.moveX !== 0 || input.moveZ !== 0);
    const shot = this.pendingShot ?? undefined;
    this.pendingShot = null;
    const { seq } = predictor.step(input);
    this.curPos = predictor.windup.position();
    // `fell` is the server's call (it respawns us next to the ball): ignore it locally.
    this.outbox.push({ seq, entry: toEntry(input, shot) });
    if (this.outbox.length >= NET.input.clientBatchTicks || shot || input.swing) this.flush();
  }

  /** Sends the queued per-tick inputs as one packet. */
  private flush(): void {
    if (this.outbox.length === 0) return;
    const viewTick = Math.floor(this.conn.snapClock.renderTick(performance.now()));
    this.conn.sendInput({
      seq: this.outbox[0]!.seq,
      tick: viewTick,
      e: this.outbox.map((o) => o.entry),
    });
    this.outbox = [];
  }

  // ----------------------------------------------------------------- frame

  frame(dt: number): void {
    if (!this.active) return;
    const now = performance.now();
    this.acc += dt;
    while (this.acc >= STEP_DT) {
      this.tick();
      this.acc -= STEP_DT;
    }
    const alpha = this.acc / STEP_DT;
    this.smoother.update(dt);

    // Own Windup: predicted state, interpolated between ticks, plus the correction offset.
    let own: Vec3 | null = null;
    const w = this.predictor?.windup;
    if (w && this.ownModel && this.ready) {
      const o = this.smoother.offset;
      own = [
        this.prevPos[0] + (this.curPos[0] - this.prevPos[0]) * alpha + o[0],
        this.prevPos[1] + (this.curPos[1] - this.prevPos[1]) * alpha + o[1],
        this.prevPos[2] + (this.curPos[2] - this.prevPos[2]) * alpha + o[2],
      ];
      this.ownModel.group.position.set(own[0], own[1], own[2]);
      this.ownModel.group.visible = true;
      this.ownModel.update(dt, {
        status: w.status,
        speed: w.horizontalSpeed,
        yaw: w.yaw,
        key: w.key.key,
        toppleProgress: w.toppleProgress,
        swingProgress: w.swingProgress,
        immune: w.immune,
        sprinting: this.sprintingNow,
      });
    } else if (this.ownModel) {
      this.ownModel.group.visible = false;
    }

    // Everything else: interpolated ~100 ms behind the newest snapshot.
    const renderTick = this.conn.snapClock.renderTick(now);
    const rps = this.conn.buffer.sample(renderTick);
    const seen = new Set<number>();
    let ownBallPos: Vec3 | null = null;
    for (const rp of rps) {
      seen.add(rp.slot);
      if (rp.slot === this.slot) {
        ownBallPos = rp.ball.pos;
        this.renderBall(this.actorFor(rp.slot), rp, dt);
        continue;
      }
      this.renderRemote(rp, dt);
    }
    for (const [slot, actor] of this.remotes) {
      if (!seen.has(slot)) {
        actor.dispose();
        this.remotes.delete(slot);
      }
    }
    this.updatePlates(own, seen);

    // Camera: after a shot follow the ball until it rests, then go back to the Windup.
    const ball = this.ownBall();
    if (own && ball?.phase !== 'moving') {
      this.stage.rig.setFollow(own[0], own[1] + CAMERA_HEIGHT, own[2]);
    } else if (ownBallPos) {
      this.stage.rig.setFollow(ownBallPos[0], ownBallPos[1], ownBallPos[2]);
    }

    const canShoot = this.canShoot();
    this.controls.setEnabled(canShoot);
    this.controls.update(dt);
    this.hud.setPower(this.controls.charging ? this.controls.power : null);
    if (w) this.hud.setKey(w.key.key, w.key.frozen);
    this.hud.setPrompt(this.promptText(canShoot));
    this.updateStrokesText(this.conn.state?.matchPhase, this.conn.state?.holeIndex ?? 0);

    // Ring on the floor around a resting ball: green when the Windup is close enough to hit it.
    const showRing = this.phase === 'playing' && ball?.phase === 'resting' && ownBallPos !== null;
    this.ring.visible = showRing;
    if (showRing && ownBallPos) {
      this.ring.position.set(
        ownBallPos[0],
        ownBallPos[1] - PHYSICS.ball.radius + 0.02,
        ownBallPos[2],
      );
      (this.ring.material as MeshBasicMaterial).color.setHex(
        canShoot ? RING_COLOR_READY : RING_COLOR_FAR,
      );
    }
    if (canShoot && ball && this.scratch) {
      const power = this.controls.charging ? this.controls.power : this.controls.lastPower;
      const yaw = this.shootYaw(this.controls.aimOffset);
      this.aim.set(previewShot(this.scratch, ball.pos, yaw, Math.max(power, 0.05)).points);
    } else {
      this.aim.hide();
    }

    this.updateDebug(dt, now, w);
  }

  private actorFor(slot: number): RemoteActor {
    let a = this.remotes.get(slot);
    if (!a) {
      const color = this.players.find((p) => p.slot === slot)?.color ?? slot;
      a = new RemoteActor(colorHex(color), this.sceneGroup, slot === this.slot ? 1 : 0.88);
      // The own slot only uses the ball: hide its (unused) model.
      if (slot === this.slot) a.model.group.visible = false;
      this.remotes.set(slot, a);
    }
    return a;
  }

  private renderBall(actor: RemoteActor, rp: RenderPlayer, dt: number): void {
    actor.ball.position.set(rp.ball.pos[0], rp.ball.pos[1], rp.ball.pos[2]);
    actor.ball.visible = rp.ball.phase !== 'holed';
    actor.roll(rp.ball.vel, dt);
  }

  private renderRemote(rp: RenderPlayer, dt: number): void {
    const a = this.actorFor(rp.slot);
    const wd = rp.windup;
    a.model.group.position.set(wd.pos[0], wd.pos[1], wd.pos[2]);
    a.model.update(dt, {
      status: wd.status,
      speed: wd.speed,
      yaw: wd.yaw,
      key: wd.key,
      toppleProgress: wd.status === 'topple' ? wd.anim : null,
      swingProgress: wd.status === 'swing' ? wd.anim : null,
      immune: wd.immune,
      sprinting: wd.speed > WINDUP.walkSpeed * 1.25,
    });
    this.renderBall(a, rp, dt);
  }

  private updatePlates(own: Vec3 | null, seen: Set<number>): void {
    const keep = new Set<number>();
    for (const p of this.players) {
      if (p.abandoned) continue;
      let pos: Vec3 | null = null;
      if (p.slot === this.slot) pos = own;
      else if (seen.has(p.slot)) {
        const m = this.remotes.get(p.slot)?.model.group.position;
        if (m) pos = [m.x, m.y, m.z];
      }
      if (!pos) continue;
      keep.add(p.slot);
      this.plates.set(p.slot, p.nickname, colorHex(p.color), !p.connected);
      this.plates.place(p.slot, pos[0], pos[1] + NAMEPLATE_HEIGHT, pos[2], this.stage.camera);
    }
    this.plates.prune(keep);
  }

  private promptText(canShoot: boolean): string | null {
    if (this.phase !== 'playing') return null;
    const w = this.predictor?.windup;
    const ball = this.ownBall();
    const me = this.players.find((p) => p.slot === this.slot);
    if (me?.holed) return 'Holed! Watch the others, or go bonk someone';
    if (!w) return null;
    if (w.status === 'topple') return 'Bonked!';
    if (w.key.frozen) return 'Key unwound! Stand still, or find a Winding Post';
    if (this.controls.charging) return null;
    if (canShoot) return 'Hold left mouse to charge, release to hit';
    if (ball?.phase === 'resting') return 'Walk up to your ball to hit it';
    return null;
  }

  private updateDebug(dt: number, now: number, w: Windup | undefined): void {
    const cutoff = now - 2000;
    this.errWindow = this.errWindow.filter((e) => e.t >= cutoff);
    const maxCm = this.errWindow.reduce((m, e) => Math.max(m, e.cm), 0);
    this.panel.update({
      ...this.conn.stats(now),
      predErrorCm: this.lastErrCm,
      predErrorMaxCm: maxCm,
      pendingInputs: this.predictor?.pendingCount ?? 0,
      corrections: this.corrections,
    });
    const p = w?.position() ?? [0, 0, 0];
    this.stage.debug.update(
      dt,
      this.course?.world ?? null,
      `online slot ${this.slot} | phase ${this.phase} | hole ${this.holeIndex + 1}\n` +
        `windup ${p.map((n) => n.toFixed(2)).join(', ')} ${w?.status ?? ''}${w?.onGround ? '' : ' (air)'}\n` +
        `key ${w ? w.key.key.toFixed(2) : '-'}${w?.key.frozen ? ' FROZEN' : ''}\n` +
        `remotes ${this.remotes.size}  corrections ${this.corrections}`,
    );
  }

  // ----------------------------------------------------------------- tests

  /** Dev builds only: `?cheats` exposes a read-out for the Playwright smoke test. */
  private installCheats(): void {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('cheats')) return;
    const api = {
      state: () => {
        const w = this.predictor?.windup;
        const rps =
          this.conn?.buffer.sample(this.conn.snapClock.renderTick(performance.now())) ?? [];
        return {
          active: this.active,
          ready: this.ready,
          slot: this.slot,
          phase: this.phase,
          hole: this.holeIndex,
          roomPhase: this.conn?.state?.phase,
          roomCode: this.conn?.state?.code,
          strokes: this.players.find((p) => p.slot === this.slot)?.strokes ?? 0,
          players: this.players.map((p) => ({
            slot: p.slot,
            name: p.nickname,
            strokes: p.strokes,
            holed: p.holed,
          })),
          own: w ? { pos: w.position(), status: w.status, key: w.key.key } : null,
          ownBall: this.ownBall(),
          remotes: rps
            .filter((r) => r.slot !== this.slot)
            .map((r) => ({
              slot: r.slot,
              windup: r.windup.pos,
              ball: r.ball.pos,
              ballPhase: r.ball.phase,
            })),
          allBalls: rps.map((r) => ({ slot: r.slot, ball: r.ball.pos })),
          canShoot: this.canShoot(),
          cameraYaw: this.stage.rig.yaw,
          net: this.conn?.stats(),
          predErrorCm: this.lastErrCm,
          corrections: this.corrections,
        };
      },
      /** Kills the socket without leaving, like a network blip (the client must reconnect). */
      drop: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.conn?.room?.connection as any)?.transport?.ws?.close();
      },
      /** Sends a test-hook message (only honoured by a server started with GOLFWARS_CHEATS=1). */
      cheat: (k: string) => this.conn?.send('cheat', { k }),
      aimCameraAt: (x: number, z: number) => {
        const p = this.predictor?.windup.position();
        if (p) this.stage.rig.yaw = Math.atan2(-(x - p[0]), -(z - p[2]));
      },
      orbitCamera: (dYaw: number, dPitch = 0) => this.stage.rig.orbit(dYaw, dPitch),
    };
    (window as unknown as { golfwars: object }).golfwars = api;
  }
}
