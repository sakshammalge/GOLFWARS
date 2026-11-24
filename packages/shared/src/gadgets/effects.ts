import RAPIER from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import { NO_ENV, type WindupEnv } from '../character/windup.js';
import { BALL_GROUPS } from '../character/groups.js';
import { BALANCE } from '../balance.js';
import { PHYSICS, STEP_DT } from '../physics/config.js';
import type { Ball, Vec3 } from '../physics/golfSim.js';
import type { GameEvent } from '../protocol.js';
import type { GadgetType, NetEffect } from './types.js';

/** Position quantisation of effects on the wire (1/128 m): gum positions are rounded to it so the client agrees exactly. */
const POS_STEP = 128;
const q = (v: number): number => Math.round(v * POS_STEP) / POS_STEP;
const ticks = (s: number): number => Math.max(1, Math.round(s / STEP_DT));

/** Horizontal facing vector of a yaw (0 = -z), the same convention as `Ball.shotVelocity`. */
export function facing(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

interface Effect extends NetEffect {
  /** Gum: slots whose ball was inside the patch last tick (a ball is only caught when it enters). */
  inside?: Set<number>;
}

/** Where the user is when activating (all values come from the server's own Windup state). */
export interface GadgetUser {
  slot: number;
  feet: Vec3;
  yaw: number;
}

/**
 * Is (x, z) inside the cone of a fan at `origin` facing `yaw`? Returns the unit push direction
 * (horizontal, away from the fan) and the strength falloff 1..0.5, or null if outside.
 */
export function fanPush(
  origin: readonly number[],
  yaw: number,
  p: readonly number[],
): { dir: [number, number]; falloff: number } | null {
  const cfg = BALANCE.gadgets.fan;
  const dx = p[0]! - origin[0]!;
  const dz = p[2]! - origin[2]!;
  const d = Math.hypot(dx, dz);
  if (d > cfg.range || Math.abs(p[1]! - origin[1]!) > 1.5) return null;
  const f = facing(yaw);
  if (d > 0.2) {
    const cos = (dx * f[0] + dz * f[1]) / d;
    if (cos < Math.cos((cfg.halfAngleDeg * Math.PI) / 180)) return null;
  }
  const dir: [number, number] = d > 0.2 ? [dx / d, dz / d] : f;
  return { dir, falloff: 1 - 0.5 * (d / cfg.range) };
}

/** Walking-speed scale of a Windup at `feet` from the gum patches it stands in (1 = none). */
export function gumScaleAt(
  patches: readonly { pos: readonly number[] }[],
  feet: readonly number[],
): number {
  const cfg = BALANCE.gadgets.gum;
  for (const g of patches) {
    if (
      Math.hypot(g.pos[0]! - feet[0]!, g.pos[2]! - feet[2]!) <= cfg.radius &&
      Math.abs(g.pos[1]! - feet[1]!) <= 0.8
    ) {
      return cfg.windupSpeedScale;
    }
  }
  return 1;
}

/**
 * The live effects of the four gadgets on one hole: bubbles flying, gum patches, fans blowing and
 * magnets pulling. Pure sim: `step` is called once per tick before the balls are stepped and acts on
 * balls directly (`Ball.trap / addVelocity / stopDead`); Windups are influenced through
 * `windupEnv`, which the match passes into `Windup.step` (their private worlds are never touched).
 * Everything is deterministic from the activation tick and the state of the balls.
 */
export class GadgetEffects {
  private effects: Effect[] = [];
  private nextId = 1;

  constructor(private readonly world: World) {}

  get active(): readonly NetEffect[] {
    return this.effects;
  }

  /** Snapshot view (copies, sorted by id). */
  net(): NetEffect[] {
    return this.effects.map((e) => ({
      id: e.id,
      kind: e.kind,
      owner: e.owner,
      pos: [e.pos[0], e.pos[1], e.pos[2]],
      yaw: e.yaw,
      endTick: e.endTick,
    }));
  }

  /** Starts the effect of gadget `g` used by `user` at `tick`. `balls` lets gum catch balls already inside. */
  activate(g: GadgetType, user: GadgetUser, tick: number, balls: ReadonlyMap<number, Ball>): void {
    const cfg = BALANCE.gadgets;
    const [fx, fz] = facing(user.yaw);
    const [x, y, z] = user.feet;
    const base = { id: this.nextId++ & 255, kind: g, owner: user.slot, yaw: user.yaw };
    switch (g) {
      case 'bubble':
        this.effects.push({
          ...base,
          pos: [
            x + fx * cfg.bubble.spawnDistance,
            y + cfg.bubble.height,
            z + fz * cfg.bubble.spawnDistance,
          ],
          endTick: tick + ticks(cfg.bubble.lifetime),
        });
        break;
      case 'gum': {
        // Max one patch per player: a new one replaces the old.
        this.effects = this.effects.filter((e) => !(e.kind === 'gum' && e.owner === user.slot));
        const px = q(x + fx * cfg.gum.placeDistance);
        const pz = q(z + fz * cfg.gum.placeDistance);
        const patch: Effect = {
          ...base,
          pos: [px, q(this.floorY(px, y, pz)), pz],
          endTick: tick + ticks(cfg.gum.lifetime),
          inside: new Set(),
        };
        for (const [slot, b] of balls) if (this.inGum(patch, b)) patch.inside!.add(slot);
        this.effects.push(patch);
        break;
      }
      case 'fan':
        this.effects.push({
          ...base,
          pos: [q(x), q(y), q(z)],
          endTick: tick + ticks(cfg.fan.duration),
        });
        break;
      case 'magnet':
        this.effects.push({ ...base, pos: [0, 0, 0], endTick: tick + ticks(cfg.magnet.duration) });
        break;
    }
  }

  /** Influence on a Windup this step: gum slows everybody inside, a fan pushes the others. */
  windupEnv(slot: number, feet: Vec3): WindupEnv {
    if (this.effects.length === 0) return NO_ENV;
    const speedScale = gumScaleAt(
      this.effects.filter((e) => e.kind === 'gum'),
      feet,
    );
    let dx = 0;
    let dz = 0;
    for (const e of this.effects) {
      if (e.kind !== 'fan' || e.owner === slot) continue;
      const push = fanPush(e.pos, e.yaw, feet);
      if (!push) continue;
      dx += push.dir[0] * BALANCE.gadgets.fan.windupDrift * push.falloff;
      dz += push.dir[1] * BALANCE.gadgets.fan.windupDrift * push.falloff;
    }
    if (speedScale === 1 && dx === 0 && dz === 0) return NO_ENV;
    return { speedScale, drift: [dx, dz] };
  }

  /** Advances every effect one tick. Call before the balls' `prepare()` and the world step. */
  step(tick: number, balls: ReadonlyMap<number, Ball>, events: GameEvent[]): void {
    if (this.effects.length === 0) return;
    this.effects = this.effects.filter((e) => tick < e.endTick);
    const dt = STEP_DT;
    const survivors: Effect[] = [];
    for (const e of this.effects) {
      let keep = true;
      switch (e.kind) {
        case 'bubble':
          keep = this.stepBubble(e, balls, events);
          break;
        case 'gum':
          this.stepGum(e, balls, events);
          break;
        case 'fan':
          for (const b of balls.values()) {
            if (b.state === 'holed' || b.state === 'trapped') continue;
            const push = fanPush(e.pos, e.yaw, b.position());
            if (!push) continue;
            const a = BALANCE.gadgets.fan.ballAccel * push.falloff * dt;
            b.addVelocity([push.dir[0] * a, 0, push.dir[1] * a]);
          }
          break;
        case 'magnet':
          this.stepMagnet(e, balls);
          break;
      }
      if (keep) survivors.push(e);
    }
    this.effects = survivors;
  }

  // ----------------------------------------------------------------- bubble

  private stepBubble(e: Effect, balls: ReadonlyMap<number, Ball>, events: GameEvent[]): boolean {
    const cfg = BALANCE.gadgets.bubble;
    const f = facing(e.yaw);
    const stepLen = cfg.speed * STEP_DT;
    // Pops on walls: a ray along the flight path (the course is the only thing in this world).
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: e.pos[0], y: e.pos[1], z: e.pos[2] }, { x: f[0], y: 0, z: f[1] }),
      stepLen + cfg.radius * 0.6,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      BALL_GROUPS,
    );
    if (hit) return false;
    e.pos = [e.pos[0] + f[0] * stepLen, e.pos[1], e.pos[2] + f[1] * stepLen];
    // The first ball it touches, any player's (including the user's own).
    let best: { slot: number; d: number } | null = null;
    for (const [slot, b] of balls) {
      if (b.state === 'holed' || b.state === 'trapped') continue;
      const p = b.position();
      const d = Math.hypot(p[0] - e.pos[0], p[1] - e.pos[1], p[2] - e.pos[2]);
      if (d <= cfg.radius + PHYSICS.ball.radius && (!best || d < best.d)) best = { slot, d };
    }
    if (best) {
      balls.get(best.slot)!.trap(cfg.trapSeconds);
      events.push({ k: 'trap', p: best.slot, a: e.owner });
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------- gum

  private inGum(e: Effect, b: Ball): boolean {
    const p = b.position();
    return (
      Math.hypot(p[0] - e.pos[0], p[2] - e.pos[2]) <= BALANCE.gadgets.gum.radius &&
      Math.abs(p[1] - e.pos[1]) <= 0.6
    );
  }

  private stepGum(e: Effect, balls: ReadonlyMap<number, Ball>, events: GameEvent[]): void {
    const inside = e.inside!;
    for (const [slot, b] of balls) {
      const now = this.inGum(e, b);
      if (now && !inside.has(slot) && b.state === 'moving' && b.stopDead()) {
        events.push({ k: 'stick', p: slot });
      }
      if (now) inside.add(slot);
      else inside.delete(slot);
    }
  }

  // ----------------------------------------------------------------- magnet

  private stepMagnet(e: Effect, balls: ReadonlyMap<number, Ball>): void {
    const cfg = BALANCE.gadgets.magnet;
    const mine = balls.get(e.owner);
    if (!mine) return;
    const m = mine.position();
    for (const [slot, b] of balls) {
      if (slot === e.owner || b.state !== 'moving') continue;
      const p = b.position();
      const dx = m[0] - p[0];
      const dz = m[2] - p[2];
      const d = Math.hypot(dx, dz);
      if (d > cfg.range || d < 0.05) continue;
      const a = cfg.pullAccel * STEP_DT;
      b.addVelocity([(dx / d) * a, 0, (dz / d) * a]);
    }
  }

  // ------------------------------------------------------------------ misc

  /** Height of the floor under (x, z), searched from just above `y`. */
  private floorY(x: number, y: number, z: number): number {
    const hit = this.world.castRay(
      new RAPIER.Ray({ x, y: y + 1, z }, { x: 0, y: -1, z: 0 }),
      3,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      BALL_GROUPS,
    );
    return hit ? y + 1 - hit.timeOfImpact : y;
  }
}
