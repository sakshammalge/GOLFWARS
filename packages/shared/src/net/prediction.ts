import type { Windup, WindupEvents, WindupInput, WindupState } from '../character/windup.js';
import type { Vec3 } from '../physics/golfSim.js';
import { NET } from './config.js';

export interface PendingInput {
  seq: number;
  input: WindupInput;
}

export interface ReconcileResult {
  /** Position change caused by the correction (new minus old predicted), metres. */
  delta: Vec3;
  /** Length of `delta`. */
  error: number;
  /** The error was too big to smooth: the visual should jump. */
  snapped: boolean;
  /** Number of unacknowledged inputs that were replayed. */
  replayed: number;
}

/**
 * Client-side prediction for the local Windup. Every local tick the input is applied immediately
 * and remembered with its sequence number. When a server snapshot arrives with the last input
 * sequence it has processed (`ack`) and the Windup state after that input, the Windup is rewound
 * to that state and the still-unacknowledged inputs are replayed on top. Because the shared
 * Windup controller is deterministic, with no server-side surprises the replayed result equals
 * the prediction and the correction is zero; a bonk, a respawn or a starved tick shows up as a
 * (smoothed) correction.
 */
export class Predictor {
  private pending: PendingInput[] = [];
  private seq = 0;

  constructor(public windup: Windup) {}

  get lastSeq(): number {
    return this.seq;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Applies one local tick and returns its sequence number. */
  step(input: WindupInput): { seq: number; events: WindupEvents } {
    const seq = ++this.seq;
    this.pending.push({ seq, input });
    return { seq, events: this.windup.step(input) };
  }

  /** Rewinds to the server's state after input `ack` and replays the inputs after it. */
  reconcile(ack: number, state: WindupState): ReconcileResult {
    const before = this.windup.position();
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.seq <= ack) drop++;
    this.pending.splice(0, drop);
    this.windup.setState(state);
    for (const p of this.pending) this.windup.step(p.input);
    const after = this.windup.position();
    const delta: Vec3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
    const error = Math.hypot(delta[0], delta[1], delta[2]);
    return {
      delta,
      error,
      snapped: error > NET.prediction.snapDistance,
      replayed: this.pending.length,
    };
  }

  /**
   * Continues with a different Windup (a new hole's world): sequence numbers keep counting, and the
   * unacknowledged inputs stay queued because the server applies them to the new hole too.
   */
  replaceWindup(windup: Windup): void {
    this.windup = windup;
  }

  /** Forget unacknowledged inputs (a new hole: the old inputs belong to a different world). */
  clearPending(): void {
    this.pending = [];
  }
}

/**
 * Smooths prediction corrections for rendering: the Windup itself jumps to the corrected state,
 * but what is drawn is `position + offset`, where the offset starts at minus the correction and
 * decays to zero within about 100 ms.
 */
export class VisualSmoother {
  readonly offset: Vec3 = [0, 0, 0];

  /** Registers a correction (`delta` = new position minus old predicted position). */
  correct(r: ReconcileResult): void {
    if (r.snapped) {
      this.offset[0] = this.offset[1] = this.offset[2] = 0;
    } else if (r.error > NET.prediction.deadZone) {
      this.offset[0] -= r.delta[0];
      this.offset[1] -= r.delta[1];
      this.offset[2] -= r.delta[2];
    }
  }

  update(dt: number): void {
    const k = Math.exp(-NET.prediction.smoothRate * dt);
    this.offset[0] *= k;
    this.offset[1] *= k;
    this.offset[2] *= k;
  }

  reset(): void {
    this.offset[0] = this.offset[1] = this.offset[2] = 0;
  }
}
