import type { GadgetType } from './gadgets/types.js';

/** Bump when client and server can no longer talk to each other. */
export const PROTOCOL_VERSION = 3;

/** Name of the game room. A room's id is its 5-letter room code. */
export const GOLF_ROOM = 'golf';

export const DEFAULT_SERVER_PORT = 2567;

/** Message type names, client -> server (c) and server -> client (s). */
export const MessageType = {
  /** c: clock / RTT probe. */
  Ping: 'ping',
  /** s: answer to a ping. */
  Pong: 'pong',
  /** c: a batch of per-tick inputs. */
  Input: 'in',
  /** s: binary world snapshot. */
  Snapshot: 'S',
  /** s: discrete game events (shots, bonks, holed, ...). */
  Event: 'ev',
  /** s: dev only. The balance override in force (`{o: object | null}`); clients apply it. */
  Balance: 'balance',
  /** c: lobby actions. */
  SetNick: 'nick',
  SetColor: 'color',
  Ready: 'ready',
  Start: 'start',
  /** c: host, at the results: `{mode: 'again'}` = new match with the same players, else back to the lobby. */
  Rematch: 'rematch',
  /** c: any player at the results: `{v: boolean}` = "I want another match" (shown to everyone). */
  RematchVote: 'rvote',
} as const;

export interface PingMessage {
  /** Client timestamp (ms), echoed back unchanged in the pong. */
  t: number;
}

export interface PongMessage {
  /** The client timestamp from the matching ping. */
  t: number;
  /** Server sim tick when the ping was handled (0 before a match starts). */
  tick: number;
}

export interface HealthResponse {
  ok: true;
  protocol: number;
}

/** Round-trip time in ms given the echoed ping timestamp. */
export function roundTripMs(sentAt: number, now: number): number {
  return Math.max(0, Math.round(now - sentAt));
}

/** What the player options carry when creating or joining a room. */
export interface JoinOptions {
  nickname?: string;
  /** Preferred colour index (0..7); the server picks a free one if it is taken. */
  color?: number;
  protocol?: number;
}

export type LobbyPhase = 'lobby' | 'match';

/** Discrete things that happen in a match, broadcast reliably (the physics goes in snapshots). */
export type GameEvent =
  | { k: 'shot'; p: number }
  | { k: 'oob'; p: number }
  /** `r` = finish order on this hole (1 = first), `b` = the bonus it earns (-2, -1, 0). */
  | { k: 'holed'; p: number; s: number; r: number; b: number }
  | { k: 'bonk'; a: number; v: number }
  | { k: 'fell'; p: number }
  | { k: 'timeout'; p: number }
  | { k: 'hole'; i: number }
  /** `p` walked into a crate and got gadget `g`. */
  | { k: 'pickup'; p: number; g: GadgetType }
  /** `p` used gadget `g`. */
  | { k: 'use'; p: number; g: GadgetType }
  /** A bubble trapped `p`'s ball (the bubble was fired by `a`). */
  | { k: 'trap'; p: number; a: number }
  /** `p`'s ball stuck in gum. */
  | { k: 'stick'; p: number };
