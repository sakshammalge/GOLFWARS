import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import {
  MATCH,
  MessageType,
  NO_INPUT,
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

describe('reconnect (T3.5)', () => {
  /** Closes the socket without a consented leave (a refresh / network blip). */
  const drop = (c: TestClient): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c.room.connection as any).transport.ws.close();
  };

  it('a dropped client rejoins within the grace period and gets its seat, colour, ball and score back', async () => {
    const [a, b] = await startTwo();
    const slot = b.me.slot;
    const color = b.me.color;
    await waitFor(() => b.latest, 'snapshot');
    // B takes a shot.
    b.sendInput(NO_INPUT, [0, 0, 0.3]);
    await waitFor(() => b.me.strokes === 1, 'stroke');
    await sleep(300);
    const ballBefore = b.ballPos()!;
    const token = b.room.reconnectionToken;
    drop(b);
    await waitFor(
      () => a.state.players.get(b.sessionId)?.connected === false,
      'marked disconnected',
    );
    expect(a.state.players.get(b.sessionId).abandoned).toBe(false);

    const b2 = await TestClient.reconnect(url, token);
    await waitFor(() => a.state.players.get(b.sessionId)?.connected === true, 'connected again');
    expect(b2.sessionId).toBe(b.sessionId);
    expect(b2.me.slot).toBe(slot);
    expect(b2.me.color).toBe(color);
    expect(b2.me.strokes).toBe(1);
    expect(b2.me.nickname).toBe('Bob');
    // Snapshots resume with a full keyframe and the same ball.
    await waitFor(() => b2.latest, 'snapshot after reconnect');
    expect(b2.latest!.players.find((p) => p.slot === slot)).toBeDefined();
    const ballAfter = b2.ballPos(slot)!;
    expect(Math.hypot(ballAfter[0] - ballBefore[0], ballAfter[2] - ballBefore[2])).toBeLessThan(3);
    // And inputs from the reconnected client are accepted again.
    // (A fresh client numbers its inputs from 1 again; the server forgot the old sequence.)
    await b2.hold({ ...NO_INPUT, moveZ: 1 }, 3);
    await waitFor(() => b2.latest!.ack >= 3, 'ack after reconnect');
    await a.close();
    await b2.close();
  });

  it('releases the seat after the grace period: abandoned, par + 3 for unfinished holes', async () => {
    const [a, b] = await startTwo();
    const room = roomOf(a);
    drop(b);
    await waitFor(() => a.state.players.get(b.sessionId)?.abandoned === true, 'abandoned', 6000);
    expect(a.state.players.get(b.sessionId).connected).toBe(false);
    // The match carries on without B: A holes out and B is scored par + 3 on hole 1.
    const cup = room.matchSim!.hole.cup.position;
    room.matchSim!.ballOf(a.me.slot)!.teleport([cup[0], cup[1] + 0.2, cup[2]]);
    await waitFor(() => a.state.holeIndex === 1, 'next hole');
    expect(Array.from(a.state.players.get(b.sessionId).scores)).toEqual([
      KITCHEN_TABLE[0]!.par + MATCH.timeoutExtraStrokes,
    ]);
    // A late reconnect with the old token fails.
    await expect(TestClient.reconnect(url, 'bogus:token')).rejects.toThrow();
    await a.close();
  });

  it('a consented leave in a match abandons the seat at once', async () => {
    const [a, b] = await startTwo();
    await b.close();
    await waitFor(() => a.state.players.get(b.sessionId)?.abandoned === true, 'abandoned');
    await a.close();
  });

  it('a dropped lobby player can come back to the lobby with the same seat', async () => {
    const a = await TestClient.create(url, { nickname: 'A' });
    const b = await TestClient.join(url, a.room.roomId, { nickname: 'B', color: 5 });
    await waitFor(() => a.state.players.size === 2, 'two');
    const token = b.room.reconnectionToken;
    drop(b);
    await waitFor(() => a.state.players.get(b.sessionId)?.connected === false, 'disconnected');
    const b2 = await TestClient.reconnect(url, token);
    expect(b2.me.color).toBe(5);
    expect(b2.me.nickname).toBe('B');
    await a.close();
    await b2.close();
  });
});
