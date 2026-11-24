import { STEP_DT } from '../physics/config.js';
import { NET } from './config.js';

const TICK_MS = STEP_DT * 1000;

/**
 * Ping-based estimate of the server's sim tick, plus the round-trip time. Each pong carries the
 * server tick when it handled the ping; assuming a symmetric path, the server was at
 * `tick + rtt / 2` ticks when the pong arrived. The sample with the lowest RTT among the recent
 * ones is the least distorted by queuing and wins.
 */
export class ClockSync {
  private samples: { rtt: number; base: number }[] = [];
  /** Exponentially smoothed RTT in ms (0 until the first pong). */
  smoothedRtt = 0;
  lastRtt = 0;

  constructor(private readonly window = 8) {}

  /** `sentMs`/`recvMs` are local clock readings; `serverTick` is from the pong. */
  addSample(sentMs: number, recvMs: number, serverTick: number): void {
    const rtt = Math.max(0, recvMs - sentMs);
    this.lastRtt = rtt;
    this.smoothedRtt = this.smoothedRtt === 0 ? rtt : this.smoothedRtt * 0.8 + rtt * 0.2;
    // base: local time (ms) at which the server's tick counter was 0.
    const base = recvMs - (serverTick * TICK_MS + rtt / 2);
    this.samples.push({ rtt, base });
    if (this.samples.length > this.window) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** Best guess of the server's current tick (fractional) at local time `nowMs`. */
  serverTickAt(nowMs: number): number {
    if (this.samples.length === 0) return 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    return (nowMs - best.base) / TICK_MS;
  }
}

/**
 * Maps local time to the server tick that should be on screen. Remote entities are drawn
 * `interpDelayTicks` behind the newest data: the offset between local arrival time and server
 * tick time is tracked as a windowed minimum (the fastest recent packets), so the rendered time
 * stays about 100 ms behind what has actually arrived, independent of the RTT. The result never
 * moves backwards.
 */
export class SnapshotClock {
  private window: number[] = [];
  private offset: number | null = null;
  private last = 0;

  constructor(
    private readonly delayTicks: number = NET.interpDelayTicks,
    private readonly windowSize = 40,
  ) {}

  observe(serverTick: number, recvMs: number): void {
    const sample = recvMs - serverTick * TICK_MS;
    this.window.push(sample);
    if (this.window.length > this.windowSize) this.window.shift();
    const target = Math.min(...this.window);
    if (this.offset === null) {
      this.offset = target;
    } else if (target < this.offset) {
      this.offset = Math.max(target, this.offset - 4);
    } else {
      this.offset = Math.min(target, this.offset + 0.5);
    }
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  /** Server tick (fractional) to display at local time `nowMs`. */
  renderTick(nowMs: number): number {
    if (this.offset === null) return 0;
    const t = (nowMs - this.offset) / TICK_MS - this.delayTicks;
    this.last = Math.max(this.last, t);
    return this.last;
  }

  /** Forget everything (a new connection). */
  reset(): void {
    this.window = [];
    this.offset = null;
    this.last = 0;
  }
}
