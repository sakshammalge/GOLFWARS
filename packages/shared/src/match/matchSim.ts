import type { Hole } from '@golfwars/courses';
import type { World } from '@dimforge/rapier3d-compat';
import type { LoadedHole } from '@golfwars/courses';
import {
  Windup,
  inBallReach,
  resolveBonks,
  type WindupInput,
  NO_INPUT,
} from '../character/windup.js';
import { STEP_DT, PHYSICS } from '../physics/config.js';
import { Ball, createCourseWorld, type CourseWorld, type Vec3 } from '../physics/golfSim.js';
import {
  advance,
  beginPlay,
  createRound,
  recordHoled,
  recordPenalty,
  recordStroke,
  recordTimeout,
  type HoleResult,
  type RoundState,
} from '../rules.js';
import { MATCH, NET, type MatchConfig } from '../net/config.js';
import { fromEntry, MAX_FINE_AIM, type InputEntry, type ShotTuple } from '../net/input.js';
import type { MatchPhase, NetPlayer, Snapshot } from '../net/snapshot.js';
import type { GameEvent } from '../protocol.js';

/** One input being applied to a player this tick. */
export interface TickInput {
  seq: number;
  /** Server tick the sender's screen was showing (lag compensation). */
  viewTick: number;
  entry: InputEntry;
}

export interface MatchPlayer {
  /** 0..7: seat index, also the Windup id. */
  readonly slot: number;
  round: RoundState;
  windup: Windup | null;
  /** The Windup's private movement world (see `MatchSim`). */
  lane: CourseWorld | null;
  ball: Ball | null;
  /** Highest input sequence number applied. */
  ackSeq: number;
  connected: boolean;
  /** Left for good: every remaining hole scores par + extra, and the Windup is gone. */
  abandoned: boolean;
  /** Holed on the current hole. */
  holed: boolean;
  /** How far (ticks) the current swing's victims are rewound, fixed when the swing starts. */
  lagTicks: number;
}

export interface ScoreRow {
  slot: number;
  /** Strokes on each finished hole (including the current one once it is over). */
  holes: number[];
  /** Strokes on the current hole so far. */
  strokes: number;
  holed: boolean;
  total: number;
}

type Frame = (Vec3 | null)[];

const FACING_STEP = Math.PI / 4;

/**
 * The authoritative simulation of an online match on one hole at a time. All golf balls share ONE
 * Rapier world (`createCourseWorld`); balls only collide with the course, never each other (see
 * `character/groups.ts`). Each Windup walks in its own private course-only world (a "lane"): Windups
 * never collide with anything but the course, so nothing is lost, and a lane is built exactly like
 * the client's prediction world, which makes client prediction bit-identical to the server (a single
 * shared world made contact resolution at wall seams differ by millimetres, because Rapier's
 * broad-phase order depends on what else is in the world). Players interfere only through club
 * bonks, which are plain geometry. Plays the holes in order; a hole ends when all
 * connected players have holed or the hole timer runs out (unfinished players score par + 3).
 *
 * Per sim tick call `tick(inputs)` once. Inputs are consumed by the caller (see `InputBuffer`);
 * a player with no input this tick is simply not stepped (disconnected or starved).
 * No networking and no browser APIs, so it is unit-testable and benchmarkable on its own.
 */
export class MatchSim {
  readonly players = new Map<number, MatchPlayer>();
  phase: MatchPhase = 'hole-intro';
  holeIndex = 0;
  /** Sim ticks since the match started (never reset). */
  tickCount = 0;
  /** Seconds left in the current phase (intro / hole-end), or on the hole timer while playing. */
  timeLeft = 0;

  private world!: World;
  private loaded!: LoadedHole;
  private history: Frame[] = [];

  /** `initPhysics()` must have resolved. `slots` are the occupied seats. */
  constructor(
    readonly holes: readonly Hole[],
    slots: readonly number[],
    readonly config: MatchConfig = MATCH,
  ) {
    if (holes.length === 0) throw new Error('a match needs at least one hole');
    const specs = holes.map((h) => ({ id: h.id, name: h.name, par: h.par }));
    for (const slot of slots) {
      this.players.set(slot, {
        slot,
        round: createRound(specs),
        windup: null,
        lane: null,
        ball: null,
        ackSeq: 0,
        connected: true,
        abandoned: false,
        holed: false,
        lagTicks: 0,
      });
    }
    this.startHole(0);
  }

  get hole(): Hole {
    return this.holes[this.holeIndex]!;
  }

  get finished(): boolean {
    return this.phase === 'finished';
  }

  // ---------------------------------------------------------------- lifecycle

  private startHole(index: number): void {
    this.holeIndex = index;
    for (const p of this.players.values()) this.releasePlayer(p);
    this.world?.free();
    const cw = createCourseWorld(this.hole);
    this.world = cw.world;
    this.loaded = cw.loaded;
    this.history = [];

    const [tx, , tz] = this.hole.tee;
    const [cx, , cz] = this.hole.cup.position;
    const facing =
      this.hole.startYaw === undefined
        ? Math.atan2(-(cx - tx), -(cz - tz))
        : (this.hole.startYaw * Math.PI) / 180;

    for (const p of this.players.values()) {
      p.holed = false;
      p.lagTicks = 0;
      if (p.abandoned) {
        p.round = recordTimeout(beginPlay(p.round), this.config.timeoutExtraStrokes);
        continue;
      }
      p.ball = new Ball(this.world, this.loaded);
      // Everyone starts on the tee; Windups fan out around the ball (they cannot collide).
      p.lane = createCourseWorld(this.hole);
      p.windup = new Windup(p.slot, p.lane.world, p.lane.loaded, [0, 0, 0]);
      p.windup.respawnNear(p.ball.position(), facing + p.slot * FACING_STEP);
      p.windup.yaw = facing;
    }
    this.phase = 'hole-intro';
    this.timeLeft = this.config.introSeconds;
  }

  /** A player left for good: scored par + 3 on this hole and all remaining ones. */
  abandon(slot: number): void {
    const p = this.players.get(slot);
    if (!p || p.abandoned) return;
    p.abandoned = true;
    p.connected = false;
    this.releasePlayer(p);
    if (p.round.phase === 'playing') {
      p.round = recordTimeout(p.round, this.config.timeoutExtraStrokes);
    }
  }

  private releasePlayer(p: MatchPlayer): void {
    p.windup?.dispose();
    p.ball?.dispose();
    p.lane?.world.free();
    p.windup = null;
    p.lane = null;
    p.ball = null;
  }

  /** Forget the input sequence of a reconnected player (its client restarts numbering). */
  resetAck(slot: number): void {
    const p = this.players.get(slot);
    if (p) p.ackSeq = 0;
  }

  setConnected(slot: number, connected: boolean): void {
    const p = this.players.get(slot);
    if (p && !p.abandoned) p.connected = connected;
  }

  // --------------------------------------------------------------------- tick

  /** Advances one fixed 1/60 s step. Returns the events that happened. */
  tick(inputs: ReadonlyMap<number, readonly TickInput[]> = new Map()): GameEvent[] {
    const events: GameEvent[] = [];
    this.tickCount++;
    this.stepClock(events);

    const live = [...this.players.values()].filter((p) => p.windup);
    for (const p of live) {
      for (const inp of inputs.get(p.slot) ?? []) this.applyInput(p, inp, events);
    }
    this.recordFrame();
    const windups = live.map((p) => p.windup!);
    const hits = resolveBonks(windups, (a, v) => this.rewoundPosition(a, v));
    for (const h of hits) events.push({ k: 'bonk', a: h.attacker, v: h.victim });

    for (const p of live) p.ball!.prepare();
    this.world.step();
    for (const p of live) {
      const ev = p.ball!.afterStep();
      if (ev.outOfBounds && p.round.phase === 'playing') {
        p.round = recordPenalty(p.round, PHYSICS.outOfBoundsPenalty);
        events.push({ k: 'oob', p: p.slot });
      }
      if (ev.holed && p.round.phase === 'playing') {
        p.round = recordHoled(p.round);
        p.holed = true;
        events.push({ k: 'holed', p: p.slot, s: p.round.results.at(-1)!.strokes });
      }
    }
    this.checkHoleEnd(events);
    return events;
  }

  private stepClock(events: GameEvent[]): void {
    if (this.phase === 'finished') return;
    // Frozen while nobody is connected (everyone dropped; waiting for reconnects).
    if (![...this.players.values()].some((p) => p.connected && !p.abandoned)) return;
    this.timeLeft -= STEP_DT;
    if (this.phase === 'hole-intro' && this.timeLeft <= 0) {
      this.phase = 'playing';
      this.timeLeft = this.config.holeTimeSeconds;
      for (const p of this.players.values()) if (!p.abandoned) p.round = beginPlay(p.round);
    } else if (this.phase === 'playing' && this.timeLeft <= 0) {
      this.endHole(events, true);
    } else if (this.phase === 'hole-end' && this.timeLeft <= 0) {
      this.nextHole(events);
    }
  }

  private checkHoleEnd(events: GameEvent[]): void {
    if (this.phase !== 'playing') return;
    const active = [...this.players.values()].filter((p) => !p.abandoned && p.connected);
    if (active.length > 0 && active.every((p) => p.holed)) this.endHole(events, false);
  }

  private endHole(events: GameEvent[], timedOut: boolean): void {
    for (const p of this.players.values()) {
      if (p.round.phase !== 'playing') continue;
      p.round = recordTimeout(p.round, this.config.timeoutExtraStrokes);
      if (timedOut) events.push({ k: 'timeout', p: p.slot });
    }
    this.phase = 'hole-end';
    this.timeLeft = this.config.holeEndSeconds;
  }

  private nextHole(events: GameEvent[]): void {
    for (const p of this.players.values()) p.round = advance(p.round);
    if (this.holeIndex + 1 >= this.holes.length) {
      this.phase = 'finished';
      this.timeLeft = 0;
      return;
    }
    this.startHole(this.holeIndex + 1);
    events.push({ k: 'hole', i: this.holeIndex });
  }

  // ------------------------------------------------------------------- inputs

  private applyInput(p: MatchPlayer, inp: TickInput, events: GameEvent[]): void {
    const w = p.windup!;
    p.ackSeq = inp.seq;
    const playing = this.phase === 'playing';
    const input: WindupInput = playing
      ? fromEntry(inp.entry)
      : { ...NO_INPUT, cameraYaw: inp.entry[2] };
    const shot = inp.entry[5];
    if (shot && playing && this.tryShot(p, shot)) events.push({ k: 'shot', p: p.slot });
    const ev = w.step(input);
    if (ev.swung) {
      const lag = this.tickCount - inp.viewTick;
      p.lagTicks = Math.min(NET.lagMaxRewindTicks, Math.max(0, Math.floor(lag)));
    }
    if (ev.fell) {
      w.respawnNear(p.ball!.position(), w.yaw);
      events.push({ k: 'fell', p: p.slot });
    }
  }

  /**
   * Server-side shot validation: the hole is in play, this player has not holed, the ball is at
   * rest, the Windup is on its feet, not frozen and within reach of the ball.
   */
  private tryShot(p: MatchPlayer, shot: ShotTuple): boolean {
    const w = p.windup!;
    const ball = p.ball!;
    if (p.round.phase !== 'playing' || ball.state !== 'resting') return false;
    if (w.key.frozen || w.status === 'topple') return false;
    if (!inBallReach(w.position(), ball.position())) return false;
    const [aimYaw, fine, power] = shot;
    const yaw = aimYaw + Math.max(-MAX_FINE_AIM, Math.min(MAX_FINE_AIM, fine));
    if (!ball.shoot(yaw, power)) return false;
    p.round = recordStroke(p.round);
    return true;
  }

  // ----------------------------------------------------------- lag compensation

  private recordFrame(): void {
    const frame: Frame = [];
    for (const p of this.players.values()) frame[p.slot] = p.windup ? p.windup.position() : null;
    this.history.push(frame);
    if (this.history.length > NET.lagHistoryTicks + 1) this.history.shift();
  }

  /** Where the attacker's screen showed `victim`: its position `attacker.lagTicks` ago. */
  private rewoundPosition(attacker: Windup, victim: Windup): Vec3 {
    const lag = this.players.get(attacker.id)?.lagTicks ?? 0;
    const frame = this.history[this.history.length - 1 - lag] ?? this.history[0];
    return frame?.[victim.id] ?? victim.position();
  }

  // ----------------------------------------------------------------- read-out

  windupOf(slot: number): Windup | null {
    return this.players.get(slot)?.windup ?? null;
  }

  ballOf(slot: number): Ball | null {
    return this.players.get(slot)?.ball ?? null;
  }

  /** Strokes on the current hole, or the final strokes once the player is done with it. */
  strokesThisHole(p: MatchPlayer): number {
    return p.round.phase === 'hole-end' || p.round.phase === 'finished'
      ? (p.round.results.at(-1)?.strokes ?? 0)
      : p.round.strokes;
  }

  scoreboard(): ScoreRow[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => {
        const done: HoleResult[] =
          this.phase === 'hole-intro' || this.phase === 'playing'
            ? p.round.results.filter((_, i) => i < this.holeIndex)
            : [...p.round.results];
        const holes = done.map((r) => r.strokes);
        return {
          slot: p.slot,
          holes,
          strokes: this.strokesThisHole(p),
          holed: p.holed,
          total: holes.reduce((n, s) => n + s, 0),
        };
      });
  }

  /** Visible state of every Windup and ball, for snapshots. */
  netPlayers(): NetPlayer[] {
    const out: NetPlayer[] = [];
    for (const p of this.players.values()) {
      const w = p.windup;
      const b = p.ball;
      if (!w || !b) continue;
      const status = w.status;
      out.push({
        slot: p.slot,
        windup: {
          pos: w.position(),
          yaw: w.yaw,
          status,
          immune: w.immune,
          anim:
            (status === 'swing' ? w.swingProgress : status === 'topple' ? w.toppleProgress : 0) ??
            0,
          key: w.key.key,
        },
        ball: { pos: b.position(), phase: b.state },
      });
    }
    return out;
  }

  /** The snapshot for one receiving player (their own full state + ack included). */
  snapshotFor(slot: number, players: NetPlayer[] = this.netPlayers()): Snapshot {
    const me = this.players.get(slot);
    return {
      tick: this.tickCount,
      holeIndex: this.holeIndex,
      phase: this.phase,
      ack: me?.ackSeq ?? 0,
      own: me?.windup?.getState() ?? null,
      players,
    };
  }

  dispose(): void {
    for (const p of this.players.values()) this.releasePlayer(p);
    this.world.free();
  }
}
