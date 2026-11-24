/** Lag model parameters. `rttMs` is the total round trip; each direction gets half of it. */
export interface LagConfig {
  rttMs: number;
  jitterMs: number;
  /** Percent (0..100) of messages that are "lost" and must be retransmitted. */
  lossPct: number;
}

export const NO_LAG: LagConfig = { rttMs: 0, jitterMs: 0, lossPct: 0 };

export type LagDirection = 'out' | 'in';

/** A small deterministic PRNG (mulberry32) for repeatable tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Message-level network simulator for a reliable, ordered transport (WebSocket over TCP).
 *
 * Model, per message and direction:
 *   delay = rtt / 2 + uniform(-jitter, +jitter)               (never below 0)
 *   loss  : with probability lossPct a packet is lost and TCP retransmits it after a timeout of
 *           max(200 ms, 1.5 x rtt); a retransmit can be lost again (geometric, at most 4 times).
 *           So loss is never a drop, only an extra delay.
 *   order : delivery is in order (TCP head-of-line blocking): a message is never delivered before
 *           an earlier one of the same direction, so a late message holds everything behind it.
 *
 * `schedule` runs the callback after the computed delay (immediately when the config is all zero).
 * Clock and timer are injectable for tests.
 */
export class LagSim {
  config: LagConfig;
  private readonly lastDelivery: Record<LagDirection, number> = { out: 0, in: 0 };

  /** `now` is a millisecond clock (`performance.now`), `setTimer` is `setTimeout`. */
  constructor(
    config: LagConfig,
    private readonly now: () => number,
    private readonly setTimer: (fn: () => void, ms: number) => unknown,
    private readonly rng: () => number = Math.random,
  ) {
    this.config = { ...config };
  }

  get active(): boolean {
    return this.config.rttMs > 0 || this.config.jitterMs > 0 || this.config.lossPct > 0;
  }

  /** Milliseconds until a message sent now in `dir` is delivered. */
  delayFor(dir: LagDirection): number {
    const { rttMs, jitterMs, lossPct } = this.config;
    let delay = rttMs / 2 + (this.rng() * 2 - 1) * jitterMs;
    const rto = Math.max(200, rttMs * 1.5);
    for (let i = 0; i < 4 && this.rng() * 100 < lossPct; i++) delay += rto;
    const at = Math.max(this.now() + Math.max(0, delay), this.lastDelivery[dir]);
    this.lastDelivery[dir] = at;
    return at - this.now();
  }

  schedule(dir: LagDirection, fn: () => void): void {
    // Even with the sim off, messages queued behind earlier delayed ones keep their order.
    if (!this.active && this.lastDelivery[dir] <= this.now()) {
      fn();
      return;
    }
    this.setTimer(fn, this.delayFor(dir));
  }
}
