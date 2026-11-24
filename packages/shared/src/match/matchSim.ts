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
import {
  createFlow,
  endHoleFlow,
  startFlow,
  stepFlow,
  type FlowState,
  type FlowTransition,
} from './flow.js';
import { finishBonusFor, finishPlace, scoreHole } from '../scoring.js';
import { createRng } from '../rng.js';
import { GadgetInventory } from '../gadgets/inventory.js';
import { GadgetEffects } from '../gadgets/effects.js';
import type { GadgetType } from '../gadgets/types.js';

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
  /** Sim tick at which the ball dropped in the cup on the current hole (null = not yet). */
  holedTick: number | null;
  /** Finish order on the current hole (1 = first to hole out, 0 = not holed yet). */
  finishPlace: number;
  /** Finish-order bonus of each finished hole (-2, -1 or 0), parallel to `round.results`. */
  bonuses: number[];
  /** Placement on each finished hole by points (1 = best, ties share). */
  places: number[];
}

export interface ScoreRow {
  slot: number;
  /** Strokes on each finished hole (including the current one once it is over). */
  holes: number[];
  /** Finish-order bonus of each finished hole. */
  bonuses: number[];
  /** Placement on each finished hole. */
  places: number[];
  /** Strokes on the current hole so far. */
  strokes: number;
  holed: boolean;
  /** Finish order on the current hole (0 = not holed). */
  finish: number;
  /** Total points: strokes + bonuses of the finished holes. */
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
  /** The pure state machine (see `flow.ts`); `phase`, `holeIndex` and `timeLeft` read through it. */
  readonly flow: FlowState;
  /** Sim ticks since the match started (never reset). */
  tickCount = 0;

  private world!: World;
  private loaded!: LoadedHole;
  private history: Frame[] = [];
  private readonly rng: () => number;
  /** Crates and held gadgets of the current hole. */
  gadgets!: GadgetInventory;
  /** Bubbles, gum, fans and magnets active on the current hole. */
  effects!: GadgetEffects;

  /** `initPhysics()` must have resolved. `slots` are the occupied seats. */
  constructor(
    readonly holes: readonly Hole[],
    slots: readonly number[],
    readonly config: MatchConfig = MATCH,
    /** Seeds the crate contents (which gadget a crate gives), so tests and replays are exact. */
    seed = 1,
  ) {
    this.rng = createRng(seed);
    if (holes.length === 0) throw new Error('a match needs at least one hole');
    this.flow = createFlow(holes.length);
    startFlow(this.flow, config);
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
        holedTick: null,
        finishPlace: 0,
        bonuses: [],
        places: [],
      });
    }
    this.startHole();
  }

  get phase(): MatchPhase {
    return this.flow.phase as MatchPhase;
  }

  get holeIndex(): number {
    return this.flow.holeIndex;
  }

  /** Seconds left in the current phase (intro / hole-end), or on the hole timer while playing. */
  get timeLeft(): number {
    return this.flow.timeLeft;
  }

  set timeLeft(v: number) {
    this.flow.timeLeft = v;
  }

  get hole(): Hole {
    return this.holes[this.holeIndex]!;
  }

  get finished(): boolean {
    return this.phase === 'results';
  }

  // ---------------------------------------------------------------- lifecycle

  private startHole(): void {
    for (const p of this.players.values()) this.releasePlayer(p);
    this.world?.free();
    const cw = createCourseWorld(this.hole);
    this.world = cw.world;
    this.loaded = cw.loaded;
    this.history = [];
    this.gadgets = new GadgetInventory(this.loaded.crates, this.rng);
    this.effects = new GadgetEffects(this.world);

    const [tx, , tz] = this.hole.tee;
    const [cx, , cz] = this.hole.cup.position;
    const facing =
      this.hole.startYaw === undefined
        ? Math.atan2(-(cx - tx), -(cz - tz))
        : (this.hole.startYaw * Math.PI) / 180;

    for (const p of this.players.values()) {
      p.holed = false;
      p.holedTick = null;
      p.finishPlace = 0;
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
  }

  /** A player left for good: scored par + 3 on this hole and all remaining ones. */
  abandon(slot: number): void {
    const p = this.players.get(slot);
    if (!p || p.abandoned) return;
    p.abandoned = true;
    p.connected = false;
    this.gadgets.clear(slot);
    this.releasePlayer(p);
    // Mid-intro or mid-hole: this hole scores par + 3 at once (a hole already holed keeps its strokes).
    if (p.round.phase === 'hole-intro' || p.round.phase === 'playing') {
      p.round = recordTimeout(beginPlay(p.round), this.config.timeoutExtraStrokes);
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
    if (this.phase === 'playing') this.pickUpCrates(live, events);
    const windups = live.map((p) => p.windup!);
    const hits = resolveBonks(windups, (a, v) => this.rewoundPosition(a, v));
    for (const h of hits) events.push({ k: 'bonk', a: h.attacker, v: h.victim });

    this.effects.step(this.tickCount, this.ballMap(live), events);
    for (const p of live) p.ball!.prepare();
    this.world.step();
    const holedNow: MatchPlayer[] = [];
    for (const p of live) {
      const ev = p.ball!.afterStep();
      if (ev.outOfBounds && p.round.phase === 'playing') {
        p.round = recordPenalty(p.round, PHYSICS.outOfBoundsPenalty);
        events.push({ k: 'oob', p: p.slot });
      }
      if (ev.holed && p.round.phase === 'playing') {
        p.round = recordHoled(p.round);
        p.holed = true;
        p.holedTick = this.tickCount;
        holedNow.push(p);
      }
    }
    // Finish order: players holing out on the same tick tie for the better place.
    if (holedNow.length > 0) {
      const ticks = [...this.players.values()].map((q) => q.holedTick);
      for (const p of holedNow) {
        p.finishPlace = finishPlace(p.holedTick!, ticks);
        events.push({
          k: 'holed',
          p: p.slot,
          s: p.round.results.at(-1)!.strokes,
          r: p.finishPlace,
          b: finishBonusFor(p.finishPlace),
        });
      }
    }
    this.checkHoleEnd(events);
    return events;
  }

  private stepClock(events: GameEvent[]): void {
    if (this.flow.phase === 'results') return;
    // Frozen while nobody is connected (everyone dropped; waiting for reconnects).
    if (![...this.players.values()].some((p) => p.connected && !p.abandoned)) return;
    this.handle(stepFlow(this.flow, STEP_DT, this.config, false), events);
  }

  private handle(t: FlowTransition | null, events: GameEvent[]): void {
    if (!t) return;
    switch (t.kind) {
      case 'play':
        for (const p of this.players.values()) if (!p.abandoned) p.round = beginPlay(p.round);
        break;
      case 'hole-over':
        this.finishHole(events, t.timedOut);
        break;
      case 'next-hole':
        for (const p of this.players.values()) p.round = advance(p.round);
        this.startHole();
        events.push({ k: 'hole', i: t.holeIndex });
        break;
      case 'results':
        for (const p of this.players.values()) p.round = advance(p.round);
        break;
    }
  }

  private checkHoleEnd(events: GameEvent[]): void {
    if (this.phase !== 'playing') return;
    const active = [...this.players.values()].filter((p) => !p.abandoned && p.connected);
    if (active.length > 0 && active.every((p) => p.holed)) {
      this.handle(endHoleFlow(this.flow, this.config, false), events);
    }
  }

  /** The hole is over: unfinished players score par + 3, then the hole is scored for everyone. */
  private finishHole(events: GameEvent[], timedOut: boolean): void {
    for (const p of this.players.values()) {
      if (p.round.phase !== 'playing') continue;
      p.round = recordTimeout(p.round, this.config.timeoutExtraStrokes);
      if (timedOut) events.push({ k: 'timeout', p: p.slot });
    }
    const scores = scoreHole(
      [...this.players.values()].map((p) => ({
        slot: p.slot,
        strokes: p.round.results.at(-1)?.strokes ?? 0,
        holedTick: p.holedTick,
      })),
    );
    for (const sc of scores) {
      const p = this.players.get(sc.slot)!;
      p.bonuses.push(sc.bonus);
      p.places.push(sc.place);
    }
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
    if (input.gadget && playing) this.useGadget(p, events);
    const ev = w.step(input, this.effects.windupEnv(p.slot, w.position()));
    if (ev.swung) {
      const lag = this.tickCount - inp.viewTick;
      p.lagTicks = Math.min(NET.lagMaxRewindTicks, Math.max(0, Math.floor(lag)));
    }
    if (ev.fell) {
      w.respawnNear(p.ball!.position(), w.yaw);
      events.push({ k: 'fell', p: p.slot });
    }
  }

  // ------------------------------------------------------------------ gadgets

  private pickUpCrates(live: MatchPlayer[], events: GameEvent[]): void {
    for (const p of live) {
      const got = this.gadgets.pickup(p.slot, p.windup!.position(), this.tickCount);
      if (got) events.push({ k: 'pickup', p: p.slot, g: got });
    }
  }

  /** Gives a player a gadget directly (unit tests and the dev cheat hook). */
  grantGadget(slot: number, gadget: GadgetType): void {
    this.gadgets.grant(slot, gadget, this.tickCount);
  }

  /** Server-side validation of "use gadget": holding one, off cooldown, on its feet. */
  private useGadget(p: MatchPlayer, events: GameEvent[]): void {
    const w = p.windup!;
    if (w.key.frozen || w.status === 'topple') return;
    const g = this.gadgets.take(p.slot, this.tickCount);
    if (!g) return;
    events.push({ k: 'use', p: p.slot, g });
    const live = [...this.players.values()].filter((q) => q.windup);
    this.effects.activate(
      g,
      { slot: p.slot, feet: w.position(), yaw: w.yaw },
      this.tickCount,
      this.ballMap(live),
    );
  }

  private ballMap(live: readonly MatchPlayer[]): Map<number, Ball> {
    return new Map(live.map((p) => [p.slot, p.ball!]));
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
        const bonuses = p.bonuses.slice(0, holes.length);
        return {
          slot: p.slot,
          holes,
          bonuses,
          places: p.places.slice(0, holes.length),
          strokes: this.strokesThisHole(p),
          holed: p.holed,
          finish: p.finishPlace,
          total: holes.reduce((n, s, i) => n + s + (bonuses[i] ?? 0), 0),
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
      crates: this.gadgets.crateMask(this.tickCount),
      effects: this.effects.net(),
      gadget: this.gadgets.heldBy(slot),
      players,
    };
  }

  dispose(): void {
    for (const p of this.players.values()) this.releasePlayer(p);
    this.world.free();
  }
}
