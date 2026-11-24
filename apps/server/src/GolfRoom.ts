import { Room, ServerError, type Client } from '@colyseus/core';
import { KITCHEN_TABLE, type Hole } from '@golfwars/courses';
import {
  GADGETS,
  GOLF_ROOM,
  InputBuffer,
  MATCH,
  MatchSim,
  MessageType,
  NET,
  rematchTarget,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  SnapshotEncoder,
  STEP_DT,
  cleanNickname,
  generateRoomCode,
  initPhysics,
  isColorIndex,
  sanitizePacket,
  type GadgetType,
  type GameEvent,
  type JoinOptions,
  type MatchConfig,
  type PingMessage,
  type PongMessage,
  type TickInput,
} from '@golfwars/shared';
import type { BalanceWatcher } from './balanceWatcher.js';
import { GolfState, PlayerState } from './state.js';

export interface GolfRoomConfig {
  match: MatchConfig;
  holes: Hole[];
  /** Seconds a dropped player's seat is held (tests shorten it). */
  reconnectSeconds: number;
  /** Fixes the crate RNG (tests); by default every match gets a random seed. */
  seed?: number;
  /** Dev only: hot-reloadable balance override (see `balanceWatcher.ts`). */
  balance?: BalanceWatcher;
}

export const DEFAULT_ROOM_CONFIG: GolfRoomConfig = {
  match: MATCH,
  holes: KITCHEN_TABLE,
  reconnectSeconds: NET.reconnectSeconds,
};

/** Per-connection server bookkeeping (kept across a reconnect: it is keyed by session id). */
interface Seat {
  slot: number;
  input: InputBuffer;
  encoder: SnapshotEncoder;
  /** Rate limiting of input packets. */
  windowStart: number;
  windowCount: number;
  /** Bytes of snapshot payload sent (diagnostics). */
  snapshotBytes: number;
  snapshots: number;
}

export interface TickStats {
  ticks: number;
  totalMs: number;
  maxMs: number;
}

/** Room codes in use in this process (a code is the room id, so it must be unique). */
const usedCodes = new Set<string>();

/**
 * One game: a lobby (nicknames, colours, ready) and then a match on the shared `MatchSim`. The
 * server runs the simulation at 60 Hz, clients only send inputs, and world snapshots go out at
 * 20 Hz as plain binary messages. Low-rate data (lobby, scores) is schema state.
 */
export class GolfRoom extends Room<GolfState> {
  override maxClients = NET.maxPlayers;
  protected config: GolfRoomConfig = DEFAULT_ROOM_CONFIG;

  readonly stats: TickStats = { ticks: 0, totalMs: 0, maxMs: 0 };
  private seats = new Map<string, Seat>();
  private joinOrder: string[] = [];
  private sim: MatchSim | null = null;
  private lastPump = 0;
  private acc = 0;
  private lastScoreKey = '';
  private stopBalanceWatch: (() => void) | null = null;

  /** A room class with a custom config (tests use short intros and holes). */
  static withConfig(config: Partial<GolfRoomConfig>): typeof GolfRoom {
    const merged = { ...DEFAULT_ROOM_CONFIG, ...config };
    return class extends GolfRoom {
      protected override config = merged;
    };
  }

  override async onCreate(): Promise<void> {
    await initPhysics();
    let code = generateRoomCode();
    while (usedCodes.has(code)) code = generateRoomCode();
    usedCodes.add(code);
    this.roomId = code;
    await this.setMetadata({ code });

    const state = new GolfState();
    state.code = code;
    state.phase = 'lobby';
    state.matchPhase = 'hole-intro';
    state.holeCount = this.config.holes.length;
    this.setState(state);

    this.onMessage(MessageType.Ping, (client, msg: PingMessage) => {
      if (typeof msg?.t !== 'number') return;
      client.send(MessageType.Pong, {
        t: msg.t,
        tick: this.sim?.tickCount ?? 0,
      } satisfies PongMessage);
    });
    this.onMessage(MessageType.SetNick, (client, msg: { nickname?: unknown }) => {
      const p = this.player(client);
      if (p && this.state.phase === 'lobby') p.nickname = cleanNickname(msg?.nickname, p.slot + 1);
    });
    this.onMessage(MessageType.SetColor, (client, msg: { color?: unknown }) => {
      const p = this.player(client);
      const color = msg?.color;
      if (!p || this.state.phase !== 'lobby' || !isColorIndex(color)) return;
      if (!this.colorTaken(color, client.sessionId)) p.color = color;
    });
    this.onMessage(MessageType.Ready, (client, msg: { ready?: unknown }) => {
      const p = this.player(client);
      if (p && this.state.phase === 'lobby') p.ready = msg?.ready === true;
    });
    this.onMessage(MessageType.Start, (client) => {
      if (client.sessionId === this.state.hostId && this.state.phase === 'lobby') this.startMatch();
    });
    this.onMessage(MessageType.Rematch, (client, msg: { mode?: unknown } | undefined) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'match' || !this.sim) {
        return;
      }
      const target = rematchTarget(this.sim.phase, msg?.mode);
      if (target === 'restart') this.restartMatch();
      else if (target === 'lobby') this.backToLobby();
    });
    this.onMessage(MessageType.RematchVote, (client, msg: { v?: unknown } | undefined) => {
      const p = this.player(client);
      if (p && !p.abandoned && this.sim?.phase === 'results') p.vote = msg?.v === true;
    });
    this.onMessage(MessageType.Input, (client, raw: unknown) => this.onInput(client, raw));
    // Test hook for the local browser e2e: only exists when the server is started with
    // GOLFWARS_CHEATS=1 (never in production).
    if (process.env.GOLFWARS_CHEATS === '1') {
      this.onMessage('cheat', (client, msg: { k?: unknown }) => {
        const p = this.player(client);
        const ball = p && this.sim?.ballOf(p.slot);
        if (msg?.k === 'holeout' && ball && this.sim?.phase === 'playing') {
          const cup = this.sim.hole.cup.position;
          ball.teleport([cup[0], cup[1] + 0.2, cup[2]]);
        }
        const m = msg as { k?: unknown; g?: unknown; i?: unknown; dx?: unknown };
        // {k:'gadget', g}: hand out a gadget. {k:'crate', i, dx}: stand `dx` m beside crate i.
        if (
          m.k === 'gadget' &&
          p &&
          typeof m.g === 'string' &&
          (GADGETS as readonly string[]).includes(m.g)
        ) {
          this.sim?.grantGadget(p.slot, m.g as GadgetType);
        }
        if (m.k === 'crate' && p && this.sim && typeof m.i === 'number') {
          const c = this.sim.gadgets.crates[m.i]?.pos;
          const dx = typeof m.dx === 'number' ? m.dx : 0;
          if (c) this.sim.windupOf(p.slot)?.setPosition([c[0] + dx, c[1] - 0.3, c[2]]);
        }
      });
    }

    // Dev balance hot reload: tell every client of this room when the override changes.
    const off = this.config.balance?.onChange((o) => this.broadcast(MessageType.Balance, { o }));
    if (off) this.stopBalanceWatch = off;

    this.lastPump = performance.now();
    this.setSimulationInterval(() => this.pump(), 8);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    if (options.protocol !== undefined && options.protocol !== PROTOCOL_VERSION) {
      throw new ServerError(4000, 'Game version mismatch: reload the page.');
    }
    if (this.state.phase !== 'lobby')
      throw new ServerError(4001, 'This match has already started.');
    const slot = this.freeSlot();
    if (slot < 0) throw new ServerError(4002, 'Room is full.');
    const p = new PlayerState();
    p.slot = slot;
    p.nickname = cleanNickname(options.nickname, slot + 1);
    p.color = this.pickColor(options.color);
    p.ready = false;
    p.connected = true;
    this.state.players.set(client.sessionId, p);
    this.joinOrder.push(client.sessionId);
    const override = this.config.balance?.current();
    if (override) client.send(MessageType.Balance, { o: override });
    this.seats.set(client.sessionId, {
      slot,
      input: new InputBuffer(),
      encoder: new SnapshotEncoder(),
      windowStart: 0,
      windowCount: 0,
      snapshotBytes: 0,
      snapshots: 0,
    });
    this.updateHost();
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    this.sim?.setConnected(p.slot, false);
    if (!consented) {
      try {
        await this.allowReconnection(client, this.config.reconnectSeconds);
        p.connected = true;
        this.sim?.setConnected(p.slot, true);
        const seat = this.seats.get(client.sessionId);
        if (seat) {
          // A fresh page starts numbering inputs from 1 again, so forget the old sequence.
          seat.input = new InputBuffer();
          seat.encoder.reset();
        }
        this.sim?.resetAck(p.slot);
        return;
      } catch {
        // The grace period ran out (or the room is closing): fall through and drop the seat.
      }
    }
    this.removePlayer(client.sessionId);
  }

  override onDispose(): void {
    this.stopBalanceWatch?.();
    usedCodes.delete(this.roomId);
    this.sim?.dispose();
    this.sim = null;
  }

  // ----------------------------------------------------------------- lobby

  private player(client: Client): PlayerState | undefined {
    return this.state.players.get(client.sessionId);
  }

  private freeSlot(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.slot));
    for (let i = 0; i < NET.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  private colorTaken(color: number, except?: string): boolean {
    let taken = false;
    this.state.players.forEach((p, id) => {
      if (id !== except && p.color === color) taken = true;
    });
    return taken;
  }

  /** The preferred colour if free, else the first free one. */
  private pickColor(preferred: unknown): number {
    if (isColorIndex(preferred) && !this.colorTaken(preferred)) return preferred;
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!this.colorTaken(i)) return i;
    return 0;
  }

  /** Host = the longest-standing player still in the room. */
  private updateHost(): void {
    const host = this.joinOrder.find((id) => this.state.players.has(id)) ?? '';
    this.state.hostId = host;
    this.state.players.forEach((p, id) => (p.host = id === host));
  }

  private removePlayer(sessionId: string): void {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    if (this.state.phase === 'match' && this.sim) {
      // The seat stays on the scoreboard; unfinished holes count par + 3.
      this.sim.abandon(p.slot);
      p.abandoned = true;
      p.connected = false;
      this.seats.delete(sessionId);
      this.syncScores(true);
      return;
    }
    this.state.players.delete(sessionId);
    this.seats.delete(sessionId);
    this.joinOrder = this.joinOrder.filter((id) => id !== sessionId);
    this.updateHost();
  }

  // ----------------------------------------------------------------- match

  private startMatch(): void {
    const slots = [...this.state.players.values()].map((p) => p.slot);
    if (slots.length === 0) return;
    const seed = this.config.seed ?? Math.floor(Math.random() * 0x100000000);
    this.sim = new MatchSim(this.config.holes, slots, this.config.match, seed);
    this.state.phase = 'match';
    this.state.matchPhase = this.sim.phase;
    this.state.holeIndex = 0;
    this.resetScores();
    this.seats.forEach((s) => s.encoder.reset());
    void this.lock();
    this.acc = 0;
    this.lastPump = performance.now();
    this.lastScoreKey = '';
    this.syncScores(true);
  }

  private resetScores(): void {
    this.state.players.forEach((p) => {
      p.ready = false;
      p.strokes = 0;
      p.holed = false;
      p.finish = 0;
      p.total = 0;
      p.vote = false;
      p.abandoned = false;
      p.scores.splice(0, p.scores.length);
      p.bonus.splice(0, p.bonus.length);
      p.places.splice(0, p.places.length);
    });
  }

  /** Players who left for good during the match lose their seat. */
  private dropAbandoned(): void {
    for (const [id, p] of [...this.state.players.entries()]) {
      if (p.abandoned) {
        this.state.players.delete(id);
        this.joinOrder = this.joinOrder.filter((j) => j !== id);
        this.seats.delete(id);
      }
    }
    this.updateHost();
  }

  /** "Play again" at the results: a fresh match with the same players, no lobby in between. */
  private restartMatch(): void {
    this.sim?.dispose();
    this.sim = null;
    this.dropAbandoned();
    this.startMatch();
  }

  private backToLobby(): void {
    this.sim?.dispose();
    this.sim = null;
    this.dropAbandoned();
    this.state.phase = 'lobby';
    this.state.matchPhase = 'hole-intro';
    this.resetScores();
    void this.unlock();
  }

  private onInput(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !this.sim) return;
    const now = performance.now();
    if (now - seat.windowStart > 1000) {
      seat.windowStart = now;
      seat.windowCount = 0;
    }
    if (++seat.windowCount > NET.input.maxPacketsPerSecond) return;
    const packet = sanitizePacket(raw);
    if (packet) seat.input.push(packet);
  }

  /** Called by the simulation interval: runs as many fixed 1/60 s ticks as real time demands. */
  private pump(): void {
    const now = performance.now();
    this.acc += Math.min((now - this.lastPump) / 1000, 0.25);
    this.lastPump = now;
    while (this.acc >= STEP_DT) {
      this.acc -= STEP_DT;
      if (this.sim) this.tickOnce(this.sim);
    }
  }

  private tickOnce(sim: MatchSim): void {
    const t0 = performance.now();
    const inputs = new Map<number, TickInput[]>();
    for (const seat of this.seats.values()) {
      const taken = seat.input.take();
      if (taken.length > 0) inputs.set(seat.slot, taken);
    }
    const events = sim.tick(inputs);
    if (events.length > 0) this.onEvents(events);
    this.syncScores(false);
    if (sim.tickCount % NET.snapshotEveryTicks === 0) this.sendSnapshots(sim);
    const ms = performance.now() - t0;
    this.stats.ticks++;
    this.stats.totalMs += ms;
    this.stats.maxMs = Math.max(this.stats.maxMs, ms);
  }

  private onEvents(events: GameEvent[]): void {
    this.broadcast(MessageType.Event, events);
    this.syncScores(true);
  }

  private sendSnapshots(sim: MatchSim): void {
    const players = sim.netPlayers();
    for (const client of this.clients) {
      const seat = this.seats.get(client.sessionId);
      if (!seat) continue;
      const bytes = seat.encoder.encode(sim.snapshotFor(seat.slot, players));
      client.sendBytes(MessageType.Snapshot, bytes);
      seat.snapshotBytes += bytes.length;
      seat.snapshots++;
    }
  }

  /** Copies the sim's scoreboard into the schema (only writes values that changed). */
  private syncScores(force: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    const secs = Math.max(0, Math.ceil(sim.timeLeft));
    const key = `${sim.phase}|${sim.holeIndex}|${secs}`;
    if (!force && key === this.lastScoreKey) return;
    this.lastScoreKey = key;
    this.state.matchPhase = sim.phase;
    this.state.holeIndex = sim.holeIndex;
    this.state.timeLeft = secs;
    const board = new Map(sim.scoreboard().map((r) => [r.slot, r]));
    this.state.players.forEach((p) => {
      const r = board.get(p.slot);
      if (!r) return;
      p.strokes = Math.min(255, r.strokes);
      p.holed = r.holed;
      p.finish = r.finish;
      p.total = r.total;
      syncArray(
        p.scores,
        r.holes.map((s) => Math.min(255, s)),
      );
      syncArray(p.bonus, r.bonuses);
      syncArray(p.places, r.places);
    });
  }

  // ----------------------------------------------------- diagnostics (bench/tests)

  /** The live simulation, if a match is running. */
  get matchSim(): MatchSim | null {
    return this.sim;
  }

  seatStats(sessionId: string): { snapshots: number; snapshotBytes: number } | undefined {
    const s = this.seats.get(sessionId);
    return s && { snapshots: s.snapshots, snapshotBytes: s.snapshotBytes };
  }
}

/** Rewrites a schema array only if its content differs (avoids needless patches). */
function syncArray(
  target: {
    length: number;
    [i: number]: number;
    splice: (a: number, b: number) => unknown;
    push: (...v: number[]) => unknown;
  },
  values: number[],
): void {
  if (target.length === values.length && values.every((v, i) => target[i] === v)) return;
  target.splice(0, target.length);
  for (const v of values) target.push(v);
}

export { GOLF_ROOM };
