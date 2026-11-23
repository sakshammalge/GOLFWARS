/**
 * Every tuning number for the Windup (the wind-up toy you control): movement, the wind-up key
 * (stamina) and the club bonk. Units: metres, seconds, radians unless a name says otherwise.
 * Pure data, shared by the client, the tests and (from M3) the server.
 */
export const WINDUP = {
  /** Capsule collider: a cylinder of `2 * halfHeight` capped with two spheres of `radius`. */
  radius: 0.3,
  halfHeight: 0.25,

  walkSpeed: 4.5,
  sprintSpeed: 8,
  /** Horizontal acceleration towards the wanted velocity (m/s^2), on the ground and in the air. */
  groundAccel: 45,
  airAccel: 12,
  /** Take-off speed. With the world gravity this is a ~1.05 m jump. */
  jumpSpeed: 6.5,
  /** A jump is still allowed this long (s) after walking off a ledge. */
  coyoteTime: 0.1,
  /** Clamp on falling speed (m/s). */
  terminalSpeed: 30,
  /** How fast the body turns to face its wanted direction (rad/s). */
  turnSpeed: 14,
  /** Horizontal deceleration while toppled (the shove from a bonk slides to a stop). */
  toppledDecel: 10,

  /** Kinematic character controller tuning (degrees where named so). */
  controller: {
    /** Gap kept between the capsule and walls (m). */
    skin: 0.01,
    /** Steepest slope that can be walked up; steeper ones are slid down. Slopes up to ~40 deg work. */
    maxClimbSlopeDeg: 45,
    minSlideSlopeDeg: 50,
    /** Ledges up to this high are stepped over without jumping, if there is room to stand on top. */
    stepMaxHeight: 0.35,
    stepMinWidth: 0.15,
    /** Sticks to the ground when walking down slopes / over seams. */
    snapDistance: 0.3,
  },

  /** Shots can only be started when the Windup is this close (XZ) to a resting ball. */
  ballReach: 1.0,
  /** Where a Windup is put next to its ball on spawn / respawn. */
  respawnDistance: 0.8,
  /** A Windup has fallen off the course when its feet are this far below the lowest piece. */
  fallBelowMargin: 0.5,
  /** ...or when it leaves the course's XZ bounds by more than this. */
  boundsMargin: 1.5,
} as const;

/** The wind-up key: stamina in 0..1. */
export const STAMINA = {
  /** Key lost per second while sprinting (about 5 s from full to empty). */
  sprintDrain: 0.2,
  /** Key lost by one jump. */
  jumpCost: 0.08,
  /** Key regained per second standing still. */
  idleRewind: 0.08,
  /** Key regained per second standing within `postRadius` of a Winding Post. */
  postRewind: 0.6,
  /** Horizontal distance (m) to a Winding Post's centre that counts as "next to it". */
  postRadius: 1.6,
  /** At 0 the Windup freezes until the key is back at this level. */
  unfreezeAt: 0.25,
  /** Moving slower than this (m/s) counts as standing still. */
  idleSpeed: 0.4,
} as const;

/** The club bonk: a short arc swing that topples other Windups. */
export const BONK = {
  /** Time from the start of a swing until the next swing may start. */
  cooldown: 0.8,
  /** Length of the swing animation, and the window within it in which the club can hit. */
  swingDuration: 0.45,
  hitStart: 0.12,
  hitEnd: 0.3,
  /** Hitbox: a sector in front of the attacker, measured to the victim's centre minus its radius. */
  range: 1.6,
  halfAngleDeg: 65,
  /** Max vertical distance (m) between attacker and victim body centres. */
  height: 1.3,
  /** Walking speed multiplier while swinging. */
  swingMoveScale: 0.3,

  toppleSeconds: 1.5,
  /** Share of the full key (0..1) removed from a bonked Windup. */
  keyLoss: 0.4,
  /** No new bonk can land for this long after getting back up. */
  immunitySeconds: 2,
  /** Horizontal speed (m/s) a victim is shoved away from the attacker. */
  knockSpeed: 4.5,
} as const;
