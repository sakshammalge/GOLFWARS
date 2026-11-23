import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'colyseus.js';
import { LOBBY_TEST_ROOM, MessageType, PROTOCOL_VERSION, type PongMessage } from '@golfwars/shared';
import { createGameServer, type GameServer } from '../src/server.js';

let server: GameServer;
let port: number;

beforeAll(async () => {
  server = createGameServer();
  port = 20000 + Math.floor(Math.random() * 30000);
  await server.listen(port);
});

afterAll(async () => {
  await server.stop();
});

describe('server', () => {
  it('GET /health returns ok and protocol version', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION });
  });

  it('answers ping with pong echoing the timestamp', async () => {
    const client = new Client(`ws://localhost:${port}`);
    const room = await client.joinOrCreate(LOBBY_TEST_ROOM);
    const pong = await new Promise<PongMessage>((resolve) => {
      room.onMessage(MessageType.Pong, resolve);
      room.send(MessageType.Ping, { t: 12345 });
    });
    expect(pong).toEqual({ t: 12345 });
    await room.leave();
  });
});
