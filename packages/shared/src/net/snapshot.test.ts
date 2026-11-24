import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchSim } from '../match/matchSim.js';
import { initPhysics } from '../physics/golfSim.js';
import { SnapshotDecoder, SnapshotEncoder, type Snapshot } from './snapshot.js';

beforeAll(async () => {
  await initPhysics();
});

function sample(tick: number, x = 1.234): Snapshot {
  return {
    tick,
    holeIndex: 1,
    phase: 'playing',
    ack: 77,
    own: {
      feet: [x, 0.5, -2],
      vel: [1, 0, 2],
      yaw: 1.5,
      grounded: true,
      coyote: 0.1,
      key: { key: 0.75, frozen: false },
      bonk: { swingT: 0.2, cooldown: 0.5, toppleT: 0, immuneT: 1.5, hit: [3, 5] },
    },
    players: [
      {
        slot: 2,
        windup: { pos: [x, 0.5, -2], yaw: 3, status: 'swing', immune: true, anim: 0.5, key: 0.4 },
        ball: { pos: [0.5, 0.2, 3], phase: 'moving' },
      },
      {
        slot: 7,
        windup: { pos: [-3, 0, 4], yaw: 6, status: 'idle', immune: false, anim: 0, key: 1 },
        ball: { pos: [0, 0.15, 0], phase: 'holed' },
      },
    ],
  };
}

describe('snapshot codec', () => {
  it('round-trips within quantisation error', () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    const s = sample(100);
    const d = dec.decode(enc.encode(s));
    expect(d.tick).toBe(100);
    expect(d.holeIndex).toBe(1);
    expect(d.phase).toBe('playing');
    expect(d.ack).toBe(77);
    expect(d.own!.feet[0]).toBeCloseTo(1.234, 5);
    expect(d.own!.bonk.hit).toEqual([3, 5]);
    expect(d.own!.bonk.swingT).toBeCloseTo(0.2, 5);
    expect(d.own!.key.key).toBeCloseTo(0.75, 5);
    expect(d.players).toHaveLength(2);
    const p = d.players[0]!;
    expect(p.slot).toBe(2);
    expect(p.windup.pos[0]).toBeCloseTo(1.234, 1);
    expect(p.windup.status).toBe('swing');
    expect(p.windup.immune).toBe(true);
    expect(p.windup.yaw).toBeCloseTo(3, 1);
    expect(p.ball.phase).toBe('moving');
    expect(d.players[1]!.ball.phase).toBe('holed');
  });

  it('omits unchanged positions in delta snapshots and the decoder fills them in', () => {
    const enc = new SnapshotEncoder(1000);
    const dec = new SnapshotDecoder();
    const first = enc.encode(sample(1));
    const second = enc.encode(sample(2)); // nothing moved
    expect(second.length).toBeLessThan(first.length - 20);
    dec.decode(first);
    const d = dec.decode(second);
    expect(d.players[0]!.windup.pos[0]).toBeCloseTo(1.234, 1);
    expect(d.players[1]!.ball.pos[1]).toBeCloseTo(0.15, 2);
    // Moving one Windup re-sends only that position.
    const third = enc.encode(sample(3, 2.0));
    expect(dec.decode(third).players[0]!.windup.pos[0]).toBeCloseTo(2.0, 1);
  });

  it('sends everything again after reset() and on keyframes', () => {
    const enc = new SnapshotEncoder(3);
    const sizes = [1, 2, 3, 4].map((t) => enc.encode(sample(t)).length);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[3]).toBe(sizes[0]);
    enc.reset();
    expect(enc.encode(sample(5)).length).toBe(sizes[0]);
  });

  it('encodes a real 8-player match snapshot compactly', () => {
    const m = new MatchSim(KITCHEN_TABLE, [0, 1, 2, 3, 4, 5, 6, 7]);
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    const full = enc.encode(m.snapshotFor(0));
    expect(full.length).toBeLessThan(250);
    const d = dec.decode(full);
    expect(d.players).toHaveLength(8);
    m.dispose();
  });
});
