import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'colyseus.js';
import {
  GOLF_ROOM,
  MATCH,
  MessageType,
  NET,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  type PongMessage,
} from '@golfwars/shared';
import { createGameServer, type GameServer } from '../src/server.js';
import { TestClient, waitFor } from './helpers.js';

let server: GameServer;
let port: number;
let url: string;

beforeAll(async () => {
  server = createGameServer({
    match: { ...MATCH, introSeconds: 0.2, holeEndSeconds: 0.4 },
    reconnectSeconds: 2,
  });
  port = 20000 + Math.floor(Math.random() * 30000);
  url = `ws://localhost:${port}`;
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
    const a = await TestClient.create(url, { nickname: 'Ping' });
    const pong = await new Promise<PongMessage>((resolve) => {
      a.room.onMessage(MessageType.Pong, resolve);
      a.room.send(MessageType.Ping, { t: 12345 });
    });
    expect(pong.t).toBe(12345);
    expect(typeof pong.tick).toBe('number');
    await a.close();
  });
});

describe('rooms and lobby (T3.1)', () => {
  it('creates a room whose id is a 5-letter code without ambiguous letters', async () => {
    const a = await TestClient.create(url, { nickname: 'Ada' });
    expect(a.room.roomId).toMatch(/^[A-HJ-NP-Z]{5}$/);
    await waitFor(() => a.state?.code, 'state');
    expect(a.state.code).toBe(a.room.roomId);
    expect(a.state.phase).toBe('lobby');
    expect(a.me.nickname).toBe('Ada');
    expect(a.me.host).toBe(true);
    await a.close();
  });

  it('joins by code, lists both players, makes the first player host', async () => {
    const a = await TestClient.create(url, { nickname: 'Ada' });
    const b = await TestClient.join(url, a.room.roomId, { nickname: 'Bob' });
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2, 'two players');
    expect(a.state.hostId).toBe(a.sessionId);
    expect(b.state.players.get(b.sessionId).host).toBe(false);
    expect(b.state.players.get(a.sessionId).nickname).toBe('Ada');
    expect(new Set([a.me.slot, b.me.slot]).size).toBe(2);
    await a.close();
    await b.close();
  });

  it('rejects an unknown room code', async () => {
    await expect(TestClient.join(url, 'ZZZZZ', {})).rejects.toThrow();
  });

  it('keeps colours unique per room', async () => {
    const a = await TestClient.create(url, { nickname: 'A', color: 3 });
    const b = await TestClient.join(url, a.room.roomId, { nickname: 'B', color: 3 });
    await waitFor(() => b.state.players.size === 2, 'joined');
    expect(a.me.color).toBe(3);
    expect(b.me.color).not.toBe(3); // taken: gets the first free colour
    // Taking a taken colour is ignored, a free one works.
    b.room.send(MessageType.SetColor, { color: 3 });
    b.room.send(MessageType.SetColor, { color: 6 });
    await waitFor(() => b.state.players.get(b.sessionId).color === 6, 'colour change');
    a.room.send(MessageType.SetColor, { color: 6 });
    a.room.send(MessageType.SetColor, { color: 99 });
    await new Promise((r) => setTimeout(r, 100));
    expect(a.state.players.get(a.sessionId).color).toBe(3);
    await a.close();
    await b.close();
  });

  it('gives eight players eight distinct colours and refuses the ninth', async () => {
    const host = await TestClient.create(url, { nickname: 'P0' });
    const others: TestClient[] = [];
    for (let i = 1; i < NET.maxPlayers; i++) {
      others.push(await TestClient.join(url, host.room.roomId, { nickname: `P${i}`, color: 0 }));
    }
    await waitFor(() => host.state.players.size === 8, 'eight players');
    const colors = new Set<number>();
    host.state.players.forEach((p: { color: number }) => colors.add(p.color));
    expect(colors.size).toBe(PLAYER_COLORS.length);
    await expect(TestClient.join(url, host.room.roomId, {})).rejects.toThrow();
    for (const c of [host, ...others]) await c.close();
  });

  it('persists nicknames cleanly and handles ready toggles', async () => {
    const a = await TestClient.create(url, { nickname: '  <b>Zed</b>  ' });
    expect(a.me.nickname).toBe('bZed/b');
    a.room.send(MessageType.SetNick, { nickname: 'Zed' });
    a.room.send(MessageType.Ready, { ready: true });
    await waitFor(() => a.me.ready === true && a.me.nickname === 'Zed', 'ready + nick');
    a.room.send(MessageType.Ready, { ready: false });
    await waitFor(() => a.me.ready === false, 'unready');
    await a.close();
  });

  it('transfers the host when the host leaves the lobby', async () => {
    const a = await TestClient.create(url, { nickname: 'A' });
    const b = await TestClient.join(url, a.room.roomId, { nickname: 'B' });
    await waitFor(() => b.state.players.size === 2, 'joined');
    await a.close();
    await waitFor(() => b.state.hostId === b.sessionId && b.state.players.size === 1, 'new host');
    expect(b.me.host).toBe(true);
    await b.close();
  });

  it('only the host can start; solo start works; late joins are refused', async () => {
    const a = await TestClient.create(url, { nickname: 'A' });
    const b = await TestClient.join(url, a.room.roomId, { nickname: 'B' });
    await waitFor(() => b.state.players.size === 2, 'joined');
    b.room.send(MessageType.Start);
    await new Promise((r) => setTimeout(r, 150));
    expect(a.state.phase).toBe('lobby');
    a.room.send(MessageType.Start);
    await waitFor(() => a.state.phase === 'match' && b.state.phase === 'match', 'match start');
    await expect(TestClient.join(url, a.room.roomId, {})).rejects.toThrow();
    await a.close();
    await b.close();

    const solo = await TestClient.create(url, { nickname: 'Solo' });
    solo.room.send(MessageType.Start);
    await waitFor(() => solo.state.phase === 'match', 'solo start');
    await solo.close();
  });

  it('rejects a client with a different protocol version', async () => {
    const client = new Client(url);
    await expect(client.create(GOLF_ROOM, { protocol: PROTOCOL_VERSION + 1 })).rejects.toThrow();
  });
});
