/** Bump when client and server can no longer talk to each other. */
export const PROTOCOL_VERSION = 1;

/** Name of the M0 connectivity-test room. */
export const LOBBY_TEST_ROOM = 'lobby_test';

export const DEFAULT_SERVER_PORT = 2567;

/** Message type names, client -> server and server -> client. */
export const MessageType = {
  Ping: 'ping',
  Pong: 'pong',
} as const;

export interface PingMessage {
  /** Client timestamp (ms), echoed back unchanged in the pong. */
  t: number;
}

export interface PongMessage {
  /** The client timestamp from the matching ping. */
  t: number;
}

export interface HealthResponse {
  ok: true;
  protocol: number;
}

/** Round-trip time in ms given the echoed ping timestamp. */
export function roundTripMs(sentAt: number, now: number): number {
  return Math.max(0, Math.round(now - sentAt));
}
