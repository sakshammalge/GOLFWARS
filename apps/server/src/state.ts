import { schema, type SchemaType } from '@colyseus/schema';

/** One seat in the room: lobby info plus the scoreboard numbers (low-rate data, so schema sync). */
export const PlayerState = schema(
  {
    nickname: 'string',
    /** 0..7, also the Windup id. */
    slot: 'uint8',
    /** Index into `PLAYER_COLORS`. */
    color: 'uint8',
    ready: 'boolean',
    /** False while the socket is down and the seat is held for a reconnect. */
    connected: 'boolean',
    host: 'boolean',
    /** Left for good during a match: scored par + 3 on unfinished holes. */
    abandoned: 'boolean',
    /** Strokes on the current hole. */
    strokes: 'uint8',
    holed: 'boolean',
    /** Strokes on finished holes, in play order. */
    scores: { array: 'uint8' },
    total: 'uint16',
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const GolfState = schema(
  {
    /** The 5-letter room code (also the room id). */
    code: 'string',
    /** lobby | match */
    phase: 'string',
    /** hole-intro | playing | hole-end | finished (while phase is match). */
    matchPhase: 'string',
    holeIndex: 'uint8',
    holeCount: 'uint8',
    /** Whole seconds left on the hole timer / phase banner. */
    timeLeft: 'uint16',
    hostId: 'string',
    players: { map: PlayerState },
  },
  'GolfState',
);
export type GolfState = SchemaType<typeof GolfState>;
