import type { WindupStatus } from '../character/windup.js';
import type { BallPhase, Vec3 } from '../physics/golfSim.js';
import { STEP_DT } from '../physics/config.js';
import { NET } from './config.js';
import type { NetPlayer, Snapshot } from './snapshot.js';

export interface RenderWindup {
  pos: Vec3;
  yaw: number;
  status: WindupStatus;
  immune: boolean;
  /** Swing or topple progress 0..1. */
  anim: number;
  key: number;
  /** Horizontal speed (m/s) from the interpolated motion, for run animation. */
  speed: number;
}

export interface RenderBall {
  pos: Vec3;
  /** Velocity (m/s) from the interpolated motion, for the roll animation. */
  vel: Vec3;
  phase: BallPhase;
}

export interface RenderPlayer {
  slot: number;
  windup: RenderWindup;
  ball: RenderBall;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number): number =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Buffer of recent snapshots. `sample(tick)` interpolates every player's Windup and ball at a
 * (fractional) server tick, normally ~100 ms behind the newest snapshot. Beyond the newest
 * snapshot it holds the last state (no extrapolation: a Windup that stops on screen is less
 * jarring than one that overshoots). A jump larger than `teleportDistance` between two snapshots
 * (respawn, out of bounds) is not interpolated.
 */
export class SnapshotBuffer {
  private snaps: Snapshot[] = [];

  constructor(private readonly keep = 30) {}

  get latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  get length(): number {
    return this.snaps.length;
  }

  /** Snapshots must be pushed in order; older or equal ticks are ignored. */
  push(s: Snapshot): void {
    const last = this.latest;
    if (last && (s.tick <= last.tick || s.holeIndex !== last.holeIndex)) {
      if (s.holeIndex !== last.holeIndex) this.snaps = [];
      else return;
    }
    this.snaps.push(s);
    if (this.snaps.length > this.keep) this.snaps.shift();
  }

  clear(): void {
    this.snaps = [];
  }

  sample(tick: number): RenderPlayer[] {
    const n = this.snaps.length;
    if (n === 0) return [];
    let hi = this.snaps.findIndex((s) => s.tick >= tick);
    if (hi === -1) hi = n - 1;
    const b = this.snaps[hi]!;
    const a = hi > 0 ? this.snaps[hi - 1]! : b;
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (tick - a.tick) / span)) : 1;
    const dt = Math.max(span * STEP_DT, 1e-3);
    const out: RenderPlayer[] = [];
    for (const pb of b.players) {
      const pa = a.players.find((p) => p.slot === pb.slot) ?? pb;
      out.push(interpolatePlayer(pa, pb, t, dt));
    }
    return out;
  }
}

function interpolatePlayer(a: NetPlayer, b: NetPlayer, t: number, dt: number): RenderPlayer {
  const wJump = dist3(a.windup.pos, b.windup.pos) > NET.teleportDistance;
  const bJump = dist3(a.ball.pos, b.ball.pos) > NET.teleportDistance;
  const wt = wJump ? 1 : t;
  const bt = bJump ? 1 : t;
  const near = t < 0.5 ? a : b;
  const wSpeed = wJump
    ? 0
    : Math.hypot(b.windup.pos[0] - a.windup.pos[0], b.windup.pos[2] - a.windup.pos[2]) / dt;
  const bVel: Vec3 = bJump
    ? [0, 0, 0]
    : [
        (b.ball.pos[0] - a.ball.pos[0]) / dt,
        (b.ball.pos[1] - a.ball.pos[1]) / dt,
        (b.ball.pos[2] - a.ball.pos[2]) / dt,
      ];
  return {
    slot: b.slot,
    windup: {
      pos: lerp3(a.windup.pos, b.windup.pos, wt),
      yaw: lerpAngle(a.windup.yaw, b.windup.yaw, wt),
      status: near.windup.status,
      immune: near.windup.immune,
      anim: lerp(a.windup.anim, b.windup.anim, near.windup.status === a.windup.status ? t : 1),
      key: lerp(a.windup.key, b.windup.key, t),
      speed: wSpeed,
    },
    ball: { pos: lerp3(a.ball.pos, b.ball.pos, bt), vel: bVel, phase: near.ball.phase },
  };
}
