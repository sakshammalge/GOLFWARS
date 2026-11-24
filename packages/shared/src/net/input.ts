import { NO_INPUT, type WindupInput } from '../character/windup.js';
import { NET } from './config.js';

/** Fine-aim clamp (radians) applied by both client controls (30 deg) and the server. */
export const MAX_FINE_AIM = (30 * Math.PI) / 180;

/** A shot request riding on an input entry: camera yaw at release, fine aim offset, power 0..1. */
export type ShotTuple = [aimYaw: number, fineAim: number, power: number];

export const FLAG_SPRINT = 1;
export const FLAG_JUMP = 2;
export const FLAG_SWING = 4;
export const FLAG_GADGET = 8;

/**
 * One 1/60 s tick of input on the wire: [moveX, moveZ, cameraYaw, flags, aimYaw | null, shot?].
 * Numbers go over msgpack as exact doubles so client prediction and the server replay identically.
 */
export type InputEntry =
  | [number, number, number, number, number | null]
  | [number, number, number, number, number | null, ShotTuple];

/** A batch of consecutive ticks. Entry `i` has sequence number `seq + i`. */
export interface InputPacket {
  /** Sequence number of the first entry (starts at 1, +1 per tick, never reused). */
  seq: number;
  /** Server tick the sender's screen was showing (for lag compensation of bonks). */
  tick: number;
  e: InputEntry[];
}

export function toEntry(input: WindupInput, shot?: ShotTuple): InputEntry {
  const flags =
    (input.sprint ? FLAG_SPRINT : 0) |
    (input.jump ? FLAG_JUMP : 0) |
    (input.swing ? FLAG_SWING : 0) |
    (input.gadget ? FLAG_GADGET : 0);
  const base: [number, number, number, number, number | null] = [
    input.moveX,
    input.moveZ,
    input.cameraYaw,
    flags,
    input.aimYaw,
  ];
  return shot ? [...base, shot] : base;
}

export function fromEntry(e: InputEntry): WindupInput {
  return {
    moveX: e[0],
    moveZ: e[1],
    cameraYaw: e[2],
    sprint: (e[3] & FLAG_SPRINT) !== 0,
    jump: (e[3] & FLAG_JUMP) !== 0,
    swing: (e[3] & FLAG_SWING) !== 0,
    gadget: (e[3] & FLAG_GADGET) !== 0,
    aimYaw: e[4],
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Validates one entry from the network and clamps it into range; null if malformed. */
export function sanitizeEntry(raw: unknown): InputEntry | null {
  if (!Array.isArray(raw) || (raw.length !== 5 && raw.length !== 6)) return null;
  const [x, z, yaw, flags, aim, shot] = raw as unknown[];
  if (!isNum(x) || !isNum(z) || !isNum(yaw) || !isNum(flags)) return null;
  if (aim !== null && !isNum(aim)) return null;
  const base: [number, number, number, number, number | null] = [
    clamp(x, -1, 1),
    clamp(z, -1, 1),
    yaw,
    flags & 15,
    aim,
  ];
  if (raw.length === 5) return base;
  if (!Array.isArray(shot) || shot.length !== 3) return null;
  const [sy, fine, power] = shot as unknown[];
  if (!isNum(sy) || !isNum(fine) || !isNum(power)) return null;
  return [...base, [sy, clamp(fine, -MAX_FINE_AIM, MAX_FINE_AIM), clamp(power, 0, 1)]];
}

/** Validates a whole packet; null if the packet is malformed in any way. */
export function sanitizePacket(raw: unknown): InputPacket | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (!Number.isInteger(p.seq) || (p.seq as number) < 1 || !isNum(p.tick)) return null;
  if (!Array.isArray(p.e) || p.e.length === 0 || p.e.length > NET.input.maxPerPacket) return null;
  const e: InputEntry[] = [];
  for (const raw of p.e) {
    const entry = sanitizeEntry(raw);
    if (!entry) return null;
    e.push(entry);
  }
  return { seq: p.seq as number, tick: p.tick as number, e };
}

/** What the server applies for a player whose controls are locked (intro, hole end). */
export const LOCKED_INPUT: WindupInput = NO_INPUT;

export interface QueuedInput {
  seq: number;
  viewTick: number;
  entry: InputEntry;
}

/**
 * Server-side per-player input queue. Inputs are consumed in sequence order, normally one per sim
 * tick. When the queue backs up (jitter burst) it catches up by consuming 2 or 3 per tick, paid
 * for from a credit bucket that refills 1 per tick, so a client cannot run faster than real time
 * for longer than `creditCap` ticks. An empty queue means the player's Windup is not stepped
 * that tick (it never invents inputs, so client prediction and server stay in lock-step).
 */
export class InputBuffer {
  private queue: QueuedInput[] = [];
  private lastSeq = 0;
  private credit: number = NET.input.creditCap;
  /** Highest sequence number consumed so far. */
  ackSeq = 0;
  /** `tick` of the newest consumed packet. */
  viewTick = 0;
  /** Entries dropped (duplicates, overflow), for diagnostics. */
  dropped = 0;

  get depth(): number {
    return this.queue.length;
  }

  push(p: InputPacket): void {
    for (let i = 0; i < p.e.length; i++) {
      const seq = p.seq + i;
      if (seq <= this.lastSeq) {
        this.dropped++;
        continue;
      }
      this.lastSeq = seq;
      this.queue.push({ seq, viewTick: p.tick, entry: p.e[i]! });
    }
    const over = this.queue.length - NET.input.maxQueue;
    if (over > 0) {
      this.queue.splice(0, over);
      this.dropped += over;
    }
  }

  /** Called once per sim tick: returns the inputs to apply this tick (0 to 3). */
  take(): QueuedInput[] {
    this.credit = Math.min(this.credit + 1, NET.input.creditCap);
    const depth = this.queue.length;
    if (depth === 0) return [];
    const a = NET.input.catchUpAbove;
    const want = depth > a * 2 ? 3 : depth > a ? 2 : 1;
    const n = Math.min(want, depth, Math.max(1, Math.floor(this.credit)));
    this.credit -= n;
    const out = this.queue.splice(0, n);
    const last = out[out.length - 1]!;
    this.ackSeq = last.seq;
    this.viewTick = last.viewTick;
    return out;
  }

  clear(): void {
    this.queue = [];
  }
}
