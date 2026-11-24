/**
 * Rapier interaction groups: `(memberships << 16) | filter`. Two colliders interact only if each
 * one's memberships overlap the other's filter. Course pieces keep Rapier's default (everything).
 *
 * Design choice: Windups and balls never collide. A Windup can walk straight through its (or
 * anyone's) ball, so the ball can only be moved by a shot, never nudged by walking; the Windup
 * capsule is also a sensor so it cannot generate contacts at all. Windups do not collide with
 * each other either (they are bonked with the club, not shoved by walking into them).
 */
export const GROUP_COURSE = 0x0001;
export const GROUP_WINDUP = 0x0002;
export const GROUP_BALL = 0x0004;

/** Windups see (and are blocked by) the course only. */
export const WINDUP_GROUPS = (GROUP_WINDUP << 16) | GROUP_COURSE;
/** Balls see the course only, so Windups are invisible to ball contacts, rest rays and queries. */
export const BALL_GROUPS = (GROUP_BALL << 16) | GROUP_COURSE;
