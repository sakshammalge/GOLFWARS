import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import {
  MATCH,
  MessageType,
  NO_INPUT,
  STEP_DT,
  type Snapshot,
} from '@golfwars/shared';
import { KITCHEN_TABLE } from '@golfwars/courses';
import { createGameServer, type GameServer } from '../src/server.js';
import type { GolfRoom } from '../src/GolfRoom.js';
import { TestClient, sleep, waitFor } from './helpers.js';

let server: GameServer;
let url: string;

beforeAll(async () => {
  server = createGameServer({
    match: { ...MATCH, introSeconds: 0.2, holeEndSeconds: 0.4, holeTimeSeconds: 60 },
    reconnectSeconds: 2,
  });
  const port = 20000 + Math.floor(Math.random() * 30000);
  url = `ws://localhost:${port}`;
  await server.listen(port);
});

afterAll(async () => {
  await server.stop();
});

const roomOf = (c: TestClient): GolfRoom => matchMaker.getLocalRoomById(c.room.roomId) as GolfRoom;

/** Starts a 2-player match and waits for the playing phase. */
async function startTwo(): Promise<[TestClient, TestClient]> {
  const a = await TestClient.create(url, { nickname: 'Ada' });
  const b = await TestClient.join(url, a.room.roomId, { nickname: 'Bob' });
  await waitFor(() => a.state.players.size === 2, 'two players');
  a.room.send(MessageType.Start);
  await waitFor(
    () => a.state.matchPhase === 'playing' && b.state.matchPhase === 'playing',
    'playing',
  );
  return [a, b];
}

describe('match over the network (T3.4a)', () => {
  it('A walks to its ball and shoots: the server counts the stroke and both clients see the ball move', async () => {
    const [a, b] = await startTwo();
    const slot = a.me.slot;
    await waitFor(() => a.latest && b.latest, 'snapshots');
    const start = a.ballPos(slot)!;

    // Walk away from the ball (camera yaw 0: moveZ 1 = towards -z), then walk back to it.
    await a.hold({ ...NO_INPUT, moveZ: 1 }, 45);
    const far = (): number => {
      const own = a.latest!.own!;
      return Math.hypot(own.feet[0] - start[0], own.feet[2] - start[2]);
    };
    await waitFor(() => far() > 1.5, 'Windup away from the ball');
    for (let i = 0; i < 300 && far() > 0.6; i++) {
      const own = a.latest!.own!;
      const dx = start[0] - own.feet[0];
      const dz = start[2] - own.feet[2];
      const len = Math.hypot(dx, dz);
      a.sendInput({ ...NO_INPUT, moveX: dx / len, moveZ: -dz / len });
      await sleep(1000 / 60);
    }
    // Stand still for a moment so the server has the latest position, then shoot towards the cup.
    await a.hold(NO_INPUT, 6);
    expect(far()).toBeLessThanOrEqual(1.0);
    a.sendInput(NO_INPUT, [0, 0, 0.6]);

    await waitFor(() => a.me.strokes === 1, 'server stroke count');
    expect(b.state.players.get(a.sessionId).strokes).toBe(1);
    expect(b.me.strokes).toBe(0);
    expect(a.events).toContainEqual({ k: 'shot', p: slot });

    const moved = (c: TestClient): boolean => {
      const p = c.ballPos(slot);
      return !!p && Math.hypot(p[0] - start[0], p[2] - start[2]) > 1;
    };
    await waitFor(() => moved(a) && moved(b), 'A ball moving in both clients snapshots');
    // B's own ball did not move.
    const bStart = b.snaps[0]!.players.find((p) => p.slot === b.me.slot)!.ball.pos;
    const bNow = b.ballPos()!;
    expect(Math.hypot(bNow[0] - bStart[0], bNow[2] - bStart[2])).toBeLessThan(0.01);
    await a.close();
    await b.close();
  });

  it('rejects invalid shots (before walking into reach, bad power) without counting a stroke', async () => {
    const [a, b] = await startTwo();
    // Walk away so the ball is out of reach, then try to shoot.
    await a.hold({ ...NO_INPUT, moveZ: 1, sprint: true }, 60);
    a.sendInput(NO_INPUT, [0, 0, 1]);
    a.sendInput(NO_INPUT, [0, 0, Number.NaN] as never); // malformed: dropped by validation
    await sleep(300);
    expect(a.me.strokes).toBe(0);
    await a.close();
    await b.close();
  });

  it('sends snapshots at about 20 Hz with an ack for the receiver', async () => {
    const [a, b] = await startTwo();
    a.snaps.length = 0;
    const t0 = Date.now();
    await a.hold(NO_INPUT, 60);
    const hz = a.snaps.length / ((Date.now() - t0) / 1000);
    expect(hz).toBeGreaterThan(14);
    expect(hz).toBeLessThan(26);
    const last = a.latest as Snapshot;
    expect(last.ack).toBeGreaterThan(40);
    expect(last.ack).toBeLessThanOrEqual(a.seq);
    expect(last.own).not.toBeNull();
    expect(last.players).toHaveLength(2);
    await a.close();
    await b.close();
  });

  it('plays all holes: hole ends when everyone holes, timer scores par + 3, then a scoreboard', async () => {
    const [a, b] = await startTwo();
    const room = roomOf(a);
    const holeOut = async (c: TestClient): Promise<void> => {
      const sim = room.matchSim!;
      const cup = sim.hole.cup.position;
      sim.ballOf(c.me.slot)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
      await waitFor(() => c.me.holed, 'holed');
    };
    // Hole 1: both hole out.
    await holeOut(a);
    expect(a.state.matchPhase).toBe('playing');
    await holeOut(b);
    await waitFor(() => a.state.holeIndex === 1 && a.state.matchPhase !== 'hole-end', 'hole 2');
    expect(a.events).toContainEqual({ k: 'hole', i: 1 });
    expect(Array.from(a.me.scores)).toEqual([1]);
    // Hole 2: only A holes; B times out (force the timer).
    await waitFor(() => a.state.matchPhase === 'playing', 'hole 2 playing');
    await holeOut(a);
    room.matchSim!.timeLeft = 0.01;
    await waitFor(() => a.state.holeIndex === 2, 'hole 3');
    expect(Array.from(a.state.players.get(b.sessionId).scores)).toEqual([
      1,
      KITCHEN_TABLE[1]!.par + MATCH.timeoutExtraStrokes,
    ]);
    // Hole 3: both hole out; the scoreboard appears.
    await waitFor(() => a.state.matchPhase === 'playing', 'hole 3 playing');
    await holeOut(a);
    await holeOut(b);
    await waitFor(() => a.state.matchPhase === 'finished', 'finished');
    expect(Array.from(a.me.scores)).toEqual([1, 1, 1]);
    expect(a.me.total).toBe(3);
    expect(b.me.total).toBe(1 + KITCHEN_TABLE[1]!.par + 3 + 1);
    // Host sends everyone back to the lobby.
    a.room.send(MessageType.Rematch);
    await waitFor(() => a.state.phase === 'lobby' && b.state.phase === 'lobby', 'back to lobby');
    expect(a.me.total).toBe(0);
    await a.close();
    await b.close();
  });

  it('keeps the server tick time small and the simulation at 60 Hz', async () => {
    const [a, b] = await startTwo();
    const room = roomOf(a);
    const t0 = room.matchSim!.tickCount;
    await sleep(1000);
    const ticks = room.matchSim!.tickCount - t0;
    expect(ticks).toBeGreaterThan(50);
    expect(ticks).toBeLessThan(70);
    expect(room.stats.totalMs / room.stats.ticks).toBeLessThan(STEP_DT * 1000 * 0.5);
    await a.close();
    await b.close();
  });
});
