import { createBonk } from '../character/bonk.js';
import type { WindupState, WindupStatus } from '../character/windup.js';
import { createKey } from '../character/stamina.js';
import type { BallPhase, Vec3 } from '../physics/golfSim.js';
import { NET } from './config.js';

/** Where the match is, as carried in every snapshot. */
export const MATCH_PHASES = ['hole-intro', 'playing', 'hole-end', 'finished'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

const STATUSES: readonly WindupStatus[] = ['idle', 'run', 'swing', 'topple', 'frozen'];
const BALL_PHASES: readonly BallPhase[] = ['moving', 'resting', 'holed'];

/** What other players see of a Windup. */
export interface NetWindup {
  pos: Vec3;
  /** Facing, radians. */
  yaw: number;
  status: WindupStatus;
  immune: boolean;
  /** Swing progress (status swing) or topple progress (status topple), 0..1; else 0. */
  anim: number;
  /** Wind-up key 0..1. */
  key: number;
}

export interface NetBall {
  pos: Vec3;
  phase: BallPhase;
}

export interface NetPlayer {
  slot: number;
  windup: NetWindup;
  ball: NetBall;
}

export interface Snapshot {
  /** Server sim tick this snapshot describes. */
  tick: number;
  holeIndex: number;
  phase: MatchPhase;
  /** Highest input sequence number of the receiving client that is reflected in `own`. */
  ack: number;
  /** Full state of the receiving client's own Windup, for prediction. */
  own: WindupState | null;
  players: NetPlayer[];
}

const POS = NET.posScale;
const q = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v * POS)));
const TAU = Math.PI * 2;

class Writer {
  readonly buf = new Uint8Array(1024);
  private readonly dv = new DataView(this.buf.buffer);
  n = 0;
  u8(v: number): void {
    this.buf[this.n++] = v & 255;
  }
  i16(v: number): void {
    this.dv.setInt16(this.n, v);
    this.n += 2;
  }
  u32(v: number): void {
    this.dv.setUint32(this.n, v >>> 0);
    this.n += 4;
  }
  f32(v: number): void {
    this.dv.setFloat32(this.n, v);
    this.n += 4;
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  private readonly dv: DataView;
  n = 0;
  constructor(readonly buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number {
    return this.buf[this.n++]!;
  }
  i16(): number {
    const v = this.dv.getInt16(this.n);
    this.n += 2;
    return v;
  }
  u32(): number {
    const v = this.dv.getUint32(this.n);
    this.n += 4;
    return v;
  }
  f32(): number {
    const v = this.dv.getFloat32(this.n);
    this.n += 4;
    return v;
  }
}

function writeOwn(w: Writer, s: WindupState): void {
  for (const v of s.feet) w.f32(v);
  for (const v of s.vel) w.f32(v);
  w.f32(s.yaw);
  w.f32(s.coyote);
  w.f32(s.key.key);
  w.u8((s.grounded ? 1 : 0) | (s.key.frozen ? 2 : 0));
  w.f32(s.bonk.swingT ?? -1);
  w.f32(s.bonk.cooldown);
  w.f32(s.bonk.toppleT);
  w.f32(s.bonk.immuneT);
  w.u8(s.bonk.hit.length);
  for (const id of s.bonk.hit) w.u8(id);
}

function readOwn(r: Reader): WindupState {
  const feet: Vec3 = [r.f32(), r.f32(), r.f32()];
  const vel: Vec3 = [r.f32(), r.f32(), r.f32()];
  const yaw = r.f32();
  const coyote = r.f32();
  const keyV = r.f32();
  const flags = r.u8();
  const swingT = r.f32();
  const bonk = createBonk();
  bonk.swingT = swingT < 0 ? null : swingT;
  bonk.cooldown = r.f32();
  bonk.toppleT = r.f32();
  bonk.immuneT = r.f32();
  const nHit = r.u8();
  for (let i = 0; i < nHit; i++) bonk.hit.push(r.u8());
  const key = createKey();
  key.key = keyV;
  key.frozen = (flags & 2) !== 0;
  return { feet, vel, yaw, grounded: (flags & 1) !== 0, coyote, key, bonk };
}

/** Last quantised positions sent / received per slot; the basis of delta compression. */
type Basis = Map<number, { w: [number, number, number]; b: [number, number, number] }>;

/**
 * Per-client snapshot encoder. Binary, big-endian. A Windup or ball position is only included
 * when its quantised value changed since the previous snapshot sent to this client (the socket is
 * reliable and ordered, so the receiver always has the previous one); every `keyframeEvery`
 * snapshots everything is sent in full as a safety net. Layout:
 *
 *   u32 tick | u8 holeIndex | u8 phase(3 bits)+hasOwn(bit 6)+keyframe(bit 7) | u32 ack
 *   [own state: 12 f32 + flags + 4 f32 + hitCount + hit ids]    (only when hasOwn)
 *   u8 playerCount, then per player:
 *     u8 slot(3)+hasWindupPos(bit 3)+hasBallPos(bit 4)+ballPhase(bits 5-6)
 *     u8 status(3)+immune(bit 3) | u8 yaw | u8 anim | u8 key | [3 x i16 windup pos] | [3 x i16 ball pos]
 */
export class SnapshotEncoder {
  private basis: Basis = new Map();
  private count = 0;

  constructor(private readonly keyframeEvery = 40) {}

  /** The next snapshot is sent in full (a new or reconnected client). */
  reset(): void {
    this.basis = new Map();
    this.count = 0;
  }

  encode(s: Snapshot): Uint8Array {
    const key = this.count++ % this.keyframeEvery === 0;
    const w = new Writer();
    w.u32(s.tick);
    w.u8(s.holeIndex);
    w.u8(MATCH_PHASES.indexOf(s.phase) | (s.own ? 64 : 0) | (key ? 128 : 0));
    w.u32(s.ack);
    if (s.own) writeOwn(w, s.own);
    w.u8(s.players.length);
    const next: Basis = new Map();
    for (const p of s.players) {
      const wq: [number, number, number] = [
        q(p.windup.pos[0]),
        q(p.windup.pos[1]),
        q(p.windup.pos[2]),
      ];
      const bq: [number, number, number] = [q(p.ball.pos[0]), q(p.ball.pos[1]), q(p.ball.pos[2])];
      const prev = this.basis.get(p.slot);
      const wChanged = key || !prev || wq.some((v, i) => v !== prev.w[i]);
      const bChanged = key || !prev || bq.some((v, i) => v !== prev.b[i]);
      w.u8(
        (p.slot & 7) |
          (wChanged ? 8 : 0) |
          (bChanged ? 16 : 0) |
          (BALL_PHASES.indexOf(p.ball.phase) << 5),
      );
      w.u8(STATUSES.indexOf(p.windup.status) | (p.windup.immune ? 8 : 0));
      w.u8(Math.round((((p.windup.yaw % TAU) + TAU) % TAU) * (256 / TAU)));
      w.u8(Math.round(p.windup.anim * 255));
      w.u8(Math.round(p.windup.key * 255));
      if (wChanged) for (const v of wq) w.i16(v);
      if (bChanged) for (const v of bq) w.i16(v);
      next.set(p.slot, { w: wq, b: bq });
    }
    this.basis = next;
    return w.bytes();
  }
}

/** Per-connection decoder matching `SnapshotEncoder`. */
export class SnapshotDecoder {
  private last: Map<number, NetPlayer> = new Map();

  reset(): void {
    this.last = new Map();
  }

  decode(bytes: Uint8Array): Snapshot {
    const r = new Reader(bytes);
    const tick = r.u32();
    const holeIndex = r.u8();
    const pf = r.u8();
    const phase = MATCH_PHASES[pf & 7] ?? 'playing';
    const ack = r.u32();
    const own = pf & 64 ? readOwn(r) : null;
    const n = r.u8();
    const players: NetPlayer[] = [];
    const next = new Map<number, NetPlayer>();
    for (let i = 0; i < n; i++) {
      const b0 = r.u8();
      const slot = b0 & 7;
      const prev = this.last.get(slot);
      const b1 = r.u8();
      const yaw = (r.u8() * TAU) / 256;
      const anim = r.u8() / 255;
      const key = r.u8() / 255;
      let wpos: Vec3 = prev ? [...prev.windup.pos] : [0, 0, 0];
      let bpos: Vec3 = prev ? [...prev.ball.pos] : [0, 0, 0];
      if (b0 & 8) wpos = [r.i16() / POS, r.i16() / POS, r.i16() / POS];
      if (b0 & 16) bpos = [r.i16() / POS, r.i16() / POS, r.i16() / POS];
      const p: NetPlayer = {
        slot,
        windup: {
          pos: wpos,
          yaw,
          status: STATUSES[b1 & 7] ?? 'idle',
          immune: (b1 & 8) !== 0,
          anim,
          key,
        },
        ball: { pos: bpos, phase: BALL_PHASES[(b0 >> 5) & 3] ?? 'resting' },
      };
      players.push(p);
      next.set(slot, p);
    }
    this.last = next;
    return { tick, holeIndex, phase, ack, own, players };
  }
}
