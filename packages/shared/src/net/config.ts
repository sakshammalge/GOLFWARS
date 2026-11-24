/**
 * Every networking and match-flow tuning number lives here so the server, the client and the
 * tests agree. Time is in seconds unless a name says otherwise; ticks are 1/60 s sim steps.
 */
export const NET = {
  maxPlayers: 8,
  /** The server sends a snapshot every this many sim ticks (60 / 3 = 20 Hz). */
  snapshotEveryTicks: 3,
  /** Remote players and balls are drawn this many ticks in the past (6 ticks = 100 ms). */
  interpDelayTicks: 6,
  /** Server keeps this many ticks of Windup positions for lag compensation (12 = 200 ms). */
  lagHistoryTicks: 12,
  /** A bonk is never rewound further than this (9 ticks = 150 ms). */
  lagMaxRewindTicks: 9,
  /** Position quantisation in snapshots: 1 / posScale metres (int16, so +-256 m). */
  posScale: 128,
  /** Two consecutive snapshots further apart than this (m) are a teleport: no interpolation. */
  teleportDistance: 3,

  input: {
    /** Max per-tick entries in one input packet. */
    maxPerPacket: 12,
    /** Server-side queue length per player; the oldest entries are dropped beyond it. */
    maxQueue: 60,
    /** Queue depth above which the server consumes 2 inputs per tick to catch up, and 3 above 2x. */
    catchUpAbove: 3,
    /** Credit bucket: extra catch-up steps are paid from credit (+1 per tick) so speed hacks fail. */
    creditCap: 20,
    /** More input packets than this per second get the client dropped. */
    maxPacketsPerSecond: 120,
    /** The client sends one packet per this many local ticks (2 = 30 Hz), or at once on an event. */
    clientBatchTicks: 2,
  },

  reconnectSeconds: 60,
  pingIntervalMs: 1000,
  roomCodeLength: 5,

  prediction: {
    /** A reconcile error above this (m) snaps the visual; below it is smoothed away. */
    snapDistance: 1.5,
    /** Visual correction decay rate (1/s): about 100 ms to absorb an error. */
    smoothRate: 10,
    /** Errors below this (m) are ignored entirely. */
    deadZone: 0.0005,
  },
} as const;

/** Match flow. The server can override these in tests. */
export interface MatchConfig {
  introSeconds: number;
  holeEndSeconds: number;
  /** The hole ends for everyone after this long; unfinished players score par + timeoutExtraStrokes. */
  holeTimeSeconds: number;
  timeoutExtraStrokes: number;
}

export const MATCH: MatchConfig = {
  introSeconds: 3,
  holeEndSeconds: 4,
  holeTimeSeconds: 90,
  timeoutExtraStrokes: 3,
};

/** Eight distinct player colours (hex RGB). */
export const PLAYER_COLORS = [
  { name: 'Red', hex: 0xe5484d },
  { name: 'Blue', hex: 0x3d7bff },
  { name: 'Green', hex: 0x3fae5c },
  { name: 'Yellow', hex: 0xf2c230 },
  { name: 'Purple', hex: 0x9b5de5 },
  { name: 'Orange', hex: 0xf28c28 },
  { name: 'Pink', hex: 0xf06fb3 },
  { name: 'Teal', hex: 0x20b2aa },
] as const;

export const NICKNAME_MAX = 16;
