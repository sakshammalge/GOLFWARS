import { Client } from 'colyseus.js';
import {
  DEFAULT_SERVER_PORT,
  LOBBY_TEST_ROOM,
  MessageType,
  roundTripMs,
  type PingMessage,
  type PongMessage,
} from '@golfwars/shared';

export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `ws://localhost:${DEFAULT_SERVER_PORT}`;

export type NetStatus =
  | { state: 'connecting' }
  | { state: 'connected'; pingMs: number | null }
  | { state: 'disconnected' };

/** Joins the lobby_test room, pings once a second and reports status. */
export async function connect(onStatus: (s: NetStatus) => void): Promise<void> {
  onStatus({ state: 'connecting' });
  try {
    const room = await new Client(SERVER_URL).joinOrCreate(LOBBY_TEST_ROOM);
    let pingMs: number | null = null;
    onStatus({ state: 'connected', pingMs });

    room.onMessage(MessageType.Pong, (msg: PongMessage) => {
      pingMs = roundTripMs(msg.t, performance.now());
      onStatus({ state: 'connected', pingMs });
    });
    room.onLeave(() => {
      clearInterval(timer);
      onStatus({ state: 'disconnected' });
    });
    const timer = setInterval(() => {
      const ping: PingMessage = { t: performance.now() };
      room.send(MessageType.Ping, ping);
    }, 1000);
    room.send(MessageType.Ping, { t: performance.now() } satisfies PingMessage);
  } catch (err) {
    console.error('Could not connect to server', err);
    onStatus({ state: 'disconnected' });
  }
}
