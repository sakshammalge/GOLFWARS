import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LOBBY_TEST_ROOM, PROTOCOL_VERSION, type HealthResponse } from '@golfwars/shared';
import { LobbyTestRoom } from './LobbyTestRoom.js';

export interface GameServer {
  http: HttpServer;
  colyseus: Server;
  listen(port: number): Promise<void>;
  stop(): Promise<void>;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export function createGameServer(): GameServer {
  const http = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS).end();
    } else if (req.method === 'GET' && path === '/health') {
      const body: HealthResponse = { ok: true, protocol: PROTOCOL_VERSION };
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
  });

  const colyseus = new Server({
    transport: new WebSocketTransport({ server: http }),
    gracefullyShutdown: false,
  });
  colyseus.define(LOBBY_TEST_ROOM, LobbyTestRoom);

  return {
    http,
    colyseus,
    listen: (port) => colyseus.listen(port),
    stop: () => colyseus.gracefullyShutdown(false),
  };
}
