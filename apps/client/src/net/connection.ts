import { Client, type Room } from 'colyseus.js';
import {
  ClockSync,
  DEFAULT_SERVER_PORT,
  GOLF_ROOM,
  LagSim,
  MessageType,
  NET,
  PROTOCOL_VERSION,
  SnapshotBuffer,
  SnapshotClock,
  SnapshotDecoder,
  type GameEvent,
  type InputPacket,
  type JoinOptions,
  type LagConfig,
  type PongMessage,
  type Snapshot,
} from '@golfwars/shared';

/** The Colyseus server. On a LAN the default (same host as the page, port 2567) just works. */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `ws://${location.hostname || 'localhost'}:${DEFAULT_SERVER_PORT}`;

const SESSION_KEY = 'golfwars.session';

interface SavedSession {
  token: string;
  roomId: string;
}

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

/** Live numbers for the F3 panel. */
export interface NetStats {
  rttMs: number;
  rttLastMs: number;
  snapshotHz: number;
  snapshotBytesPerSec: number;
  bufferedSnapshots: number;
  /** Local estimate of the server tick (from pings), and the tick being rendered for remotes. */
  serverTick: number;
  renderTick: number;
}

// `any`: the room state is reflected from the server at runtime and has no static type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RoomState = any;

/**
 * Owns the Colyseus room: join/create/reconnect, the simulated-lag wrapper, ping/pong clock sync,
 * snapshot decoding and the interpolation buffer. Everything that arrives over the wire except the
 * schema state goes through `lag` (when active), so the whole netcode can be tested at 150 ms RTT
 * on localhost.
 */
export class Connection {
  readonly client = new Client(SERVER_URL);
  readonly lag: LagSim;
  readonly clockSync = new ClockSync();
  readonly snapClock = new SnapshotClock();
  readonly buffer = new SnapshotBuffer();
  private readonly decoder = new SnapshotDecoder();

  room: Room | null = null;
  connState: ConnState = 'idle';

  onSnapshot: (s: Snapshot) => void = () => {};
  onEvents: (e: GameEvent[]) => void = () => {};
  onStateChange: () => void = () => {};
  /** The connection ended for good (left, kicked, or reconnecting failed). */
  onClosed: (reason: string) => void = () => {};
  onConnState: (s: ConnState) => void = () => {};

  private pingTimer = 0;
  private snapTimes: number[] = [];
  private snapBytes: { t: number; n: number }[] = [];
  private leaving = false;

  constructor(lag: LagConfig) {
    this.lag = new LagSim(
      lag,
      () => performance.now(),
      (fn, ms) => setTimeout(fn, ms),
    );
  }

  get state(): RoomState {
    return this.room?.state;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  async create(opts: JoinOptions): Promise<void> {
    this.setConn('connecting');
    try {
      this.attach(await this.client.create(GOLF_ROOM, { ...opts, protocol: PROTOCOL_VERSION }));
    } catch (e) {
      this.setConn('idle');
      throw e;
    }
  }

  async join(code: string, opts: JoinOptions): Promise<void> {
    this.setConn('connecting');
    try {
      this.attach(await this.client.joinById(code, { ...opts, protocol: PROTOCOL_VERSION }));
    } catch (e) {
      this.setConn('idle');
      throw e;
    }
  }

  /** Re-joins with the token saved in sessionStorage (a page refresh). */
  async resume(): Promise<boolean> {
    const saved = loadSession();
    if (!saved) return false;
    this.setConn('reconnecting');
    try {
      this.attach(await this.client.reconnect(saved.token));
      return true;
    } catch {
      clearSession();
      this.setConn('idle');
      return false;
    }
  }

  leave(): void {
    this.leaving = true;
    clearSession();
    clearInterval(this.pingTimer);
    void this.room?.leave();
    this.room = null;
    this.setConn('idle');
  }

  private setConn(s: ConnState): void {
    this.connState = s;
    this.onConnState(s);
  }

  private attach(room: Room): void {
    this.room = room;
    this.leaving = false;
    this.decoder.reset();
    this.buffer.clear();
    this.snapClock.reset();
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: room.reconnectionToken, roomId: room.roomId } satisfies SavedSession),
    );

    room.onStateChange(() => this.onStateChange());
    room.onMessage(MessageType.Snapshot, (data: Uint8Array | ArrayBuffer) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      this.lag.schedule('in', () => this.receiveSnapshot(bytes));
    });
    room.onMessage(MessageType.Event, (events: GameEvent[]) => {
      this.lag.schedule('in', () => this.onEvents(events));
    });
    room.onMessage(MessageType.Pong, (msg: PongMessage) => {
      this.lag.schedule('in', () => {
        this.clockSync.addSample(msg.t, performance.now(), msg.tick);
      });
    });
    room.onLeave((code) => this.onRoomLeave(room, code));
    room.onError((code, message) => console.warn('room error', code, message));

    clearInterval(this.pingTimer);
    const ping = (): void => this.send(MessageType.Ping, { t: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, NET.pingIntervalMs);
    this.setConn('connected');
    this.onStateChange();
  }

  private receiveSnapshot(bytes: Uint8Array): void {
    const now = performance.now();
    const snap = this.decoder.decode(bytes);
    this.snapTimes.push(now);
    this.snapBytes.push({ t: now, n: bytes.length });
    this.snapClock.observe(snap.tick, now);
    this.buffer.push(snap);
    this.onSnapshot(snap);
  }

  private async onRoomLeave(room: Room, code: number): Promise<void> {
    if (room !== this.room) return; // a stale room object after a reconnect
    clearInterval(this.pingTimer);
    // 1000 / 4000: the client or server ended it on purpose; anything else is a dropped socket.
    if (this.leaving || code === 1000 || code === 4000) {
      this.setConn('idle');
      this.onClosed('left');
      return;
    }
    await this.reconnectLoop();
  }

  /** Tries to rejoin with the reconnection token once a second for the whole grace period. */
  private async reconnectLoop(): Promise<void> {
    this.setConn('reconnecting');
    const saved = loadSession();
    const deadline = performance.now() + NET.reconnectSeconds * 1000;
    while (saved && performance.now() < deadline && !this.leaving) {
      try {
        this.attach(await this.client.reconnect(saved.token));
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    clearSession();
    this.setConn('idle');
    this.onClosed('The connection was lost and the seat could not be restored.');
  }

  // ------------------------------------------------------------------ sending

  /** Sends through the lag simulator. */
  send(type: string, message?: unknown): void {
    const room = this.room;
    if (!room || this.connState !== 'connected') return;
    this.lag.schedule('out', () => {
      // The socket may have dropped while the message sat in the lag queue: just lose it.
      if (this.room === room && this.connState === 'connected' && room.connection.isOpen) {
        try {
          room.send(type, message);
        } catch {
          // closed mid-send; the reconnect loop takes over
        }
      }
    });
  }

  sendInput(packet: InputPacket): void {
    this.send(MessageType.Input, packet);
  }

  // -------------------------------------------------------------------- stats

  stats(now = performance.now()): NetStats {
    const cutoff = now - 2000;
    this.snapTimes = this.snapTimes.filter((t) => t >= cutoff);
    this.snapBytes = this.snapBytes.filter((s) => s.t >= cutoff);
    return {
      rttMs: this.clockSync.smoothedRtt,
      rttLastMs: this.clockSync.lastRtt,
      snapshotHz: this.snapTimes.length / 2,
      snapshotBytesPerSec: this.snapBytes.reduce((s, x) => s + x.n, 0) / 2,
      bufferedSnapshots: this.buffer.length,
      serverTick: this.clockSync.serverTickAt(now),
      renderTick: this.snapClock.renderTick(now),
    };
  }
}
