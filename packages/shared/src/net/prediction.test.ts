import { KITCHEN_TABLE } from '@golfwars/courses';
import { beforeAll, describe, expect, it } from 'vitest';
import { NO_INPUT, Windup, type WindupInput } from '../character/windup.js';
import { MATCH } from './config.js';
import { MatchSim, type TickInput } from '../match/matchSim.js';
import { createCourseWorld, initPhysics } from '../physics/golfSim.js';
import { Predictor, VisualSmoother } from './prediction.js';
import { fromEntry, toEntry } from './input.js';
import { SnapshotDecoder, SnapshotEncoder } from './snapshot.js';

beforeAll(async () => {
  await initPhysics();
});

/** A scripted walk: forward, strafe, sprint, jump, stop, turn the camera. */
function script(t: number): WindupInput {
  const yaw = t > 150 ? 0.7 : 0;
  if (t < 40) return { ...NO_INPUT, moveZ: 1, cameraYaw: yaw };
  if (t < 90) return { ...NO_INPUT, moveX: 1, moveZ: 1, sprint: true, cameraYaw: yaw };
  if (t < 100) return { ...NO_INPUT, moveZ: 1, jump: true, cameraYaw: yaw };
  if (t < 130) return { ...NO_INPUT, moveX: -1, cameraYaw: yaw };
  if (t < 140) return NO_INPUT;
  return { ...NO_INPUT, moveZ: -1, sprint: t % 20 < 10, cameraYaw: yaw };
}

const FAST = { ...MATCH, introSeconds: 0.01 };

/** Client with its own course-only world, joined to the server's state via snapshots. */
function makeClient(hole = KITCHEN_TABLE[0]!) {
  const { world, loaded } = createCourseWorld(hole);
  const windup = new Windup(0, world, loaded, [0, 0, 0]);
  return new Predictor(windup);
}

describe('prediction and reconciliation', () => {
  it('replaying the same inputs in a fresh world gives bit-identical positions', () => {
    const a = makeClient();
    const b = makeClient();
    const start = a.windup.getState();
    b.windup.setState(start);
    for (let t = 0; t < 300; t++) {
      a.step(script(t));
      b.step(script(t));
      expect(b.windup.position()).toEqual(a.windup.position());
    }
  });

  it('client prediction matches the server and reconciliation error is exactly zero at 150 ms RTT', () => {
    const server = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    for (let i = 0; i < 5; i++) server.tick();
    expect(server.phase).toBe('playing');

    const client = makeClient();
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    const smoother = new VisualSmoother();
    client.windup.setState(server.windupOf(0)!.getState());

    const oneWay = 5; // ticks (~83 ms)
    const toServer: { at: number; inp: TickInput }[] = [];
    const toClient: { at: number; bytes: Uint8Array }[] = [];
    let maxError = 0;
    let reconciles = 0;

    for (let t = 0; t < 360; t++) {
      // Client tick: predict and send.
      const input = script(t);
      const { seq } = client.step(input);
      toServer.push({ at: t + oneWay, inp: { seq, viewTick: 0, entry: toEntry(input) } });
      // Server tick: apply what arrived.
      const arrived = toServer.filter((m) => m.at <= t).map((m) => m.inp);
      for (const m of toServer.filter((m) => m.at <= t)) toServer.splice(toServer.indexOf(m), 1);
      server.tick(new Map([[0, arrived]]));
      if (t % 3 === 0) toClient.push({ at: t + oneWay, bytes: enc.encode(server.snapshotFor(0)) });
      // Client receives snapshots.
      for (const m of toClient.filter((m) => m.at <= t)) {
        toClient.splice(toClient.indexOf(m), 1);
        const snap = dec.decode(m.bytes);
        const r = client.reconcile(snap.ack, snap.own!);
        smoother.correct(r);
        maxError = Math.max(maxError, r.error);
        reconciles++;
      }
    }
    expect(reconciles).toBeGreaterThan(100);
    expect(maxError).toBe(0);
    // Final state: server position after the last acked input equals the client's.
    expect(client.windup.position()[0]).toBeCloseTo(server.windupOf(0)!.position()[0] + 0, 1);
    expect(smoother.offset.every((v) => Math.abs(v) < 1e-3)).toBe(true);
    // And the Windup actually moved (the script is not a no-op).
    expect(Math.hypot(...client.windup.position())).toBeGreaterThan(1);
  });

  it('server and client agree exactly when no latency is involved', () => {
    const server = new MatchSim(KITCHEN_TABLE, [0], FAST);
    for (let i = 0; i < 5; i++) server.tick();
    const client = makeClient();
    client.windup.setState(server.windupOf(0)!.getState());
    for (let t = 0; t < 300; t++) {
      const input = script(t);
      const { seq } = client.step(input);
      server.tick(new Map([[0, [{ seq, viewTick: 0, entry: toEntry(input) }]]]));
      expect(fromEntry(toEntry(input))).toEqual(input);
      expect(server.windupOf(0)!.position()).toEqual(client.windup.position());
    }
  });

  it('corrects towards the server after a bonk the client could not predict', () => {
    const server = new MatchSim(KITCHEN_TABLE, [0, 1], FAST);
    for (let i = 0; i < 5; i++) server.tick();
    const client = makeClient();
    client.windup.setState(server.windupOf(0)!.getState());
    // The server shoves player 0 away (as a bonk would); the client does not know.
    server
      .windupOf(0)!
      .receiveBonk([server.windupOf(0)!.position()[0] + 1, 0, server.windupOf(0)!.position()[2]]);
    for (let i = 0; i < 3; i++) {
      const { seq } = client.step(NO_INPUT);
      server.tick(new Map([[0, [{ seq, viewTick: 0, entry: toEntry(NO_INPUT) }]]]));
    }
    const snap = server.snapshotFor(0);
    const r = client.reconcile(snap.ack, snap.own!);
    expect(client.windup.status).toBe('topple');
    expect(r.error).toBeGreaterThan(0.001);
    expect(r.snapped).toBe(false);
    const smoother = new VisualSmoother();
    smoother.correct(r);
    // The visual offset starts at minus the correction and decays.
    expect(Math.abs(smoother.offset[0])).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) smoother.update(1 / 60);
    expect(Math.abs(smoother.offset[0])).toBeLessThan(0.1 * Math.abs(r.delta[0]));
  });

  it('snaps (no smoothing) for huge errors such as a respawn', () => {
    const client = makeClient();
    const st = client.windup.getState();
    client.step(NO_INPUT);
    const far = {
      ...st,
      feet: [st.feet[0] + 10, st.feet[1], st.feet[2]] as [number, number, number],
    };
    const r = client.reconcile(1, far);
    expect(r.snapped).toBe(true);
    const s = new VisualSmoother();
    s.correct(r);
    expect(s.offset).toEqual([0, 0, 0]);
  });
});
