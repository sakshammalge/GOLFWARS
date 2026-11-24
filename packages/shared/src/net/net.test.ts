import { describe, expect, it } from 'vitest';
import { ClockSync, SnapshotClock } from './clock.js';
import { NET } from './config.js';
import { InputBuffer, sanitizeEntry, sanitizePacket, toEntry, fromEntry } from './input.js';
import { SnapshotBuffer } from './interp.js';
import { LagSim, NO_LAG, mulberry32 } from './lagSim.js';
import type { NetPlayer, Snapshot } from './snapshot.js';
import { NO_INPUT } from '../character/windup.js';

const entry = toEntry({ ...NO_INPUT, moveZ: 1 });

describe('input validation', () => {
  it('round-trips an input', () => {
    const i = {
      ...NO_INPUT,
      moveX: 0.5,
      moveZ: -1,
      cameraYaw: 1.25,
      sprint: true,
      jump: true,
      swing: false,
      aimYaw: 0.3,
    };
    expect(fromEntry(toEntry(i))).toEqual(i);
  });
  it('rejects malformed and clamps out-of-range entries', () => {
    expect(sanitizeEntry([0, 0, NaN, 0, null])).toBeNull();
    expect(sanitizeEntry('x')).toBeNull();
    expect(sanitizeEntry([5, -5, 0, 255, null])).toEqual([1, -1, 0, 15, null]);
    expect(sanitizeEntry([0, 0, 0, 0, null, [0, 9, 9]])).toEqual([
      0,
      0,
      0,
      0,
      null,
      [0, (30 * Math.PI) / 180, 1],
    ]);
    expect(sanitizeEntry([0, 0, 0, 0, null, [0, 0]])).toBeNull();
  });
  it('rejects bad packets', () => {
    expect(sanitizePacket({ seq: 0, tick: 0, e: [entry] })).toBeNull();
    expect(sanitizePacket({ seq: 1, tick: 0, e: [] })).toBeNull();
    expect(
      sanitizePacket({ seq: 1, tick: 0, e: new Array(NET.input.maxPerPacket + 1).fill(entry) }),
    ).toBeNull();
    expect(sanitizePacket({ seq: 1.5, tick: 0, e: [entry] })).toBeNull();
    expect(sanitizePacket({ seq: 1, tick: 0, e: [entry, entry] })?.e).toHaveLength(2);
  });
});

describe('InputBuffer', () => {
  it('delivers in order, one per tick, and acks', () => {
    const b = new InputBuffer();
    b.push({ seq: 1, tick: 5, e: [entry, entry] });
    expect(b.take().map((i) => i.seq)).toEqual([1]);
    expect(b.take().map((i) => i.seq)).toEqual([2]);
    expect(b.take()).toEqual([]);
    expect(b.ackSeq).toBe(2);
    expect(b.viewTick).toBe(5);
  });
  it('ignores duplicates and old sequence numbers', () => {
    const b = new InputBuffer();
    b.push({ seq: 1, tick: 0, e: [entry, entry, entry] });
    b.push({ seq: 2, tick: 0, e: [entry, entry] });
    expect(b.depth).toBe(3);
    expect(b.dropped).toBe(2);
  });
  it('catches up after a burst but never runs faster than the credit allows', () => {
    const b = new InputBuffer();
    b.push({ seq: 1, tick: 0, e: new Array(12).fill(entry) });
    const sizes: number[] = [];
    for (let i = 0; i < 12; i++) sizes.push(b.take().length);
    expect(sizes[0]).toBe(3);
    expect(sizes.reduce((a, c) => a + c, 0)).toBe(12);
    // A speed hack: 120 inputs per second queued for 10 s of ticks.
    const h = new InputBuffer();
    let consumed = 0;
    let seq = 1;
    for (let t = 0; t < 600; t++) {
      h.push({ seq, tick: 0, e: [entry, entry] });
      seq += 2;
      consumed += h.take().length;
    }
    expect(consumed).toBeLessThanOrEqual(600 + NET.input.creditCap + 1);
  });
  it('caps the queue', () => {
    const b = new InputBuffer();
    for (let i = 0; i < 20; i++) b.push({ seq: 1 + i * 10, tick: 0, e: new Array(10).fill(entry) });
    expect(b.depth).toBe(NET.input.maxQueue);
  });
});

describe('ClockSync', () => {
  it('estimates the server tick from pongs, preferring the lowest RTT', () => {
    const c = new ClockSync();
    // Server tick = (local time - 1000) / 16.667. Path is 40 ms each way on a good sample.
    const serverTickAt = (local: number) => Math.round((local - 1000) / (1000 / 60));
    c.addSample(2000, 2200, serverTickAt(2100 - 0)); // slow sample: rtt 200, asymmetric
    c.addSample(3000, 3080, serverTickAt(3040));
    expect(c.lastRtt).toBe(80);
    expect(c.serverTickAt(4000)).toBeCloseTo((4000 - 1000) / (1000 / 60), 0);
  });
});

describe('SnapshotClock', () => {
  it('renders ~100 ms behind the newest data and never goes backwards', () => {
    const c = new SnapshotClock();
    const tickMs = 1000 / 60;
    const latency = 80;
    let t = 0;
    let prev = -Infinity;
    for (let tick = 0; tick < 300; tick += 3) {
      t = tick * tickMs + latency + (tick % 2 === 0 ? 15 : 0);
      c.observe(tick, t);
      const r = c.renderTick(t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    // Newest snapshot tick (297) minus the render tick is about the delay plus the arrival lag.
    const behind = 297 - prev;
    expect(behind).toBeGreaterThan(NET.interpDelayTicks - 1);
    expect(behind).toBeLessThan(NET.interpDelayTicks + 4);
  });
});

function snap(tick: number, x: number, bx = 0, hole = 0): Snapshot {
  const p: NetPlayer = {
    slot: 0,
    windup: { pos: [x, 0, 0], yaw: 0, status: 'run', immune: false, anim: 0, key: 1 },
    ball: { pos: [bx, 0, 0], phase: 'moving' },
  };
  return {
    tick,
    holeIndex: hole,
    phase: 'playing',
    ack: 0,
    own: null,
    crates: 0,
    gadget: null,
    players: [p],
  };
}

describe('SnapshotBuffer', () => {
  it('interpolates between snapshots', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 0));
    b.push(snap(3, 3, 2));
    const [p] = b.sample(1.5);
    expect(p!.windup.pos[0]).toBeCloseTo(1.5);
    expect(p!.ball.pos[0]).toBeCloseTo(1);
    expect(p!.windup.speed).toBeCloseTo(3 / (3 / 60));
  });
  it('holds the newest state when starved and ignores out-of-order snapshots', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0));
    b.push(snap(3, 3));
    b.push(snap(2, 99));
    expect(b.length).toBe(2);
    expect(b.sample(50)[0]!.windup.pos[0]).toBe(3);
    expect(b.sample(-5)[0]!.windup.pos[0]).toBe(0);
  });
  it('does not interpolate across a teleport', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0));
    b.push(snap(3, 50));
    expect(b.sample(1)[0]!.windup.pos[0]).toBe(50);
  });
  it('drops old snapshots when the hole changes', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0));
    b.push(snap(3, 1, 0, 1));
    expect(b.length).toBe(1);
  });
});

describe('LagSim', () => {
  function run(cfg: { rttMs: number; jitterMs: number; lossPct: number }, n = 2000) {
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const sim = new LagSim(
      cfg,
      () => now,
      (fn, ms) => timers.push({ at: now + ms, fn }),
      mulberry32(7),
    );
    const delivered: { sent: number; got: number; i: number }[] = [];
    for (let i = 0; i < n; i++) {
      const sent = now;
      sim.schedule('in', () => delivered.push({ sent, got: now, i }));
      now += 16.7;
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0]!.at <= now) {
        const t = timers.shift()!;
        const keep = now;
        now = t.at;
        t.fn();
        now = keep;
      }
    }
    timers.sort((a, b) => a.at - b.at);
    for (const t of timers) {
      now = t.at;
      t.fn();
    }
    return delivered;
  }
  it('delays by half the rtt on average and keeps order', () => {
    const d = run({ rttMs: 150, jitterMs: 20, lossPct: 0 });
    expect(d).toHaveLength(2000);
    const avg = d.reduce((s, x) => s + (x.got - x.sent), 0) / d.length;
    expect(avg).toBeGreaterThan(70);
    expect(avg).toBeLessThan(85);
    for (let i = 1; i < d.length; i++) expect(d[i]!.got).toBeGreaterThanOrEqual(d[i - 1]!.got);
    expect(d.map((x) => x.i)).toEqual([...d.map((x) => x.i)].sort((a, b) => a - b));
  });
  it('turns loss into retransmit delay, never into a missing message', () => {
    const clean = run({ rttMs: 150, jitterMs: 0, lossPct: 0 });
    const lossy = run({ rttMs: 150, jitterMs: 0, lossPct: 2 });
    expect(lossy).toHaveLength(clean.length);
    const worst = Math.max(...lossy.map((x) => x.got - x.sent));
    expect(worst).toBeGreaterThan(75 + 200);
  });
  it('is a pass-through when all zero', () => {
    const sim = new LagSim(
      NO_LAG,
      () => 0,
      () => 0,
    );
    let hit = 0;
    sim.schedule('out', () => hit++);
    expect(hit).toBe(1);
  });
});
