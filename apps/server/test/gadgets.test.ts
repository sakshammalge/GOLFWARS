import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { MATCH, MessageType, NO_INPUT, type GadgetType } from '@golfwars/shared';
import { createGameServer, type GameServer } from '../src/server.js';
import type { GolfRoom } from '../src/GolfRoom.js';
import { TestClient, sleep, waitFor } from './helpers.js';

let server: GameServer;
let url: string;

beforeAll(async () => {
  server = createGameServer({
    match: { ...MATCH, introSeconds: 0.2, holeEndSeconds: 0.4, holeTimeSeconds: 600 },
    reconnectSeconds: 2,
    seed: 42,
  });
  const port = 20000 + Math.floor(Math.random() * 30000);
  url = `ws://localhost:${port}`;
  await server.listen(port);
});

afterAll(async () => {
  await server.stop();
});

const roomOf = (c: TestClient): GolfRoom => matchMaker.getLocalRoomById(c.room.roomId) as GolfRoom;

/** Starts a 2-player match and waits for the playing phase. */
async function startTwo(): Promise<[TestClient, TestClient, GolfRoom]> {
  const a = await TestClient.create(url, { nickname: 'Ada' });
  const b = await TestClient.join(url, a.room.roomId, { nickname: 'Bob' });
  await waitFor(() => a.state.players.size === 2, 'two players');
  a.room.send(MessageType.Start);
  await waitFor(
    () => a.state.matchPhase === 'playing' && b.state.matchPhase === 'playing',
    'playing',
  );
  await waitFor(() => a.latest && b.latest, 'snapshots');
  return [a, b, roomOf(a)];
}

describe('crates and the gadget slot over the network (T4.3)', () => {
  it("A walks into a crate: A gets a gadget, both see the crate gone, B does not see A's gadget", async () => {
    const [a, b, room] = await startTwo();
    const sim = room.matchSim!;
    const c = sim.gadgets.crates[0]!.pos;
    expect(a.latest!.crates & 1).toBe(1);
    // Stand 1.4 m before the crate and walk into it with real input (camera yaw 0: +x = moveX 1).
    sim.windupOf(a.me.slot)!.setPosition([c[0] - 1.4, c[1] - 0.3, c[2]]);
    await a.hold({ ...NO_INPUT, moveX: 1 }, 40);
    await waitFor(() => a.latest!.gadget !== null, 'A holds a gadget');
    expect(a.events.some((e) => e.k === 'pickup' && e.p === a.me.slot)).toBe(true);
    expect(b.events.some((e) => e.k === 'pickup' && e.p === a.me.slot)).toBe(true);
    await waitFor(() => (b.latest!.crates & 1) === 0 && (a.latest!.crates & 1) === 0, 'crate gone');
    expect(b.latest!.gadget).toBeNull();
    await a.close();
    await b.close();
  });

  it('Q is server-validated: no gadget, no use; with one, it is used once and the slot empties', async () => {
    const [a, b, room] = await startTwo();
    // Nothing held: the use input does nothing.
    a.sendInput({ ...NO_INPUT, gadget: true });
    await sleep(150);
    expect(a.events.some((e) => e.k === 'use')).toBe(false);

    const g: GadgetType = 'gum';
    room.matchSim!.grantGadget(a.me.slot, g);
    await waitFor(() => a.latest!.gadget === g, 'gadget in snapshot');
    await sleep(700); // cooldown
    a.sendInput({ ...NO_INPUT, gadget: true });
    await waitFor(() => a.events.some((e) => e.k === 'use'), 'use event');
    expect(b.events).toContainEqual({ k: 'use', p: a.me.slot, g });
    await waitFor(() => a.latest!.gadget === null, 'slot empty');
    await a.close();
    await b.close();
  });
});

describe('gadget effects reach the other player in snapshots (T4.4)', () => {
  /** A holds `g`, stands at `feet` facing -z, and presses Q. Returns once the use event arrived. */
  async function fire(
    a: TestClient,
    room: GolfRoom,
    g: GadgetType,
    feet: [number, number, number] = [0, 0, 4],
  ): Promise<void> {
    const sim = room.matchSim!;
    const w = sim.windupOf(a.me.slot)!;
    w.setPosition(feet);
    w.yaw = 0;
    sim.grantGadget(a.me.slot, g);
    await sleep(700); // use cooldown
    a.sendInput({ ...NO_INPUT, gadget: true });
    await waitFor(() => a.events.some((e) => e.k === 'use' && e.g === g), `${g} used`);
  }

  it('Bubble Wand: B sees the bubble fly and its own ball end up trapped', async () => {
    const [a, b, room] = await startTwo();
    room.matchSim!.ballOf(b.me.slot)!.teleport([0, 0.152, -1]);
    await fire(a, room, 'bubble');
    await waitFor(
      () =>
        b.snaps.some((s) => s.effects.some((e) => e.kind === 'bubble' && e.owner === a.me.slot)),
      'bubble in B snapshots',
    );
    await waitFor(
      () => b.latest!.players.find((p) => p.slot === b.me.slot)!.ball.phase === 'trapped',
      'B ball trapped',
    );
    expect(b.events).toContainEqual({ k: 'trap', p: b.me.slot, a: a.me.slot });
    // B cannot hit its trapped ball.
    b.sendInput(NO_INPUT, [0, 0, 0.5]);
    await sleep(200);
    expect(b.me.strokes).toBe(0);
    await a.close();
    await b.close();
  });

  it("Gum Blob: B sees the patch (owner A) and B's ball sticks in it", async () => {
    const [a, b, room] = await startTwo();
    await fire(a, room, 'gum', [0, 0, 3]);
    await waitFor(
      () => b.latest!.effects.some((e) => e.kind === 'gum' && e.owner === a.me.slot),
      'gum in B snapshots',
    );
    const patch = b.latest!.effects.find((e) => e.kind === 'gum')!;
    expect(patch.pos[2]).toBeCloseTo(3 - 1.6, 1);
    const ball = room.matchSim!.ballOf(b.me.slot)!;
    ball.teleport([0, 0.152, patch.pos[2] + 2.5]);
    expect(ball.shoot(0, 0.7)).toBe(true);
    await waitFor(() => b.events.some((e) => e.k === 'stick' && e.p === b.me.slot), 'stick event');
    await a.close();
    await b.close();
  });

  it("Desk Fan: B, standing still in the cone, is pushed away; the effect is in B's snapshots", async () => {
    const [a, b, room] = await startTwo();
    room.matchSim!.windupOf(b.me.slot)!.setPosition([0, 0, 2.5]);
    await b.hold(NO_INPUT, 6);
    await fire(a, room, 'fan', [0, 0, 5]);
    // B keeps sending (idle) inputs: the wind moves it anyway.
    await b.hold(NO_INPUT, 90);
    expect(
      b.snaps.some((s) => s.effects.some((e) => e.kind === 'fan' && e.owner === a.me.slot)),
    ).toBe(true);
    expect(b.latest!.own!.feet[2]).toBeLessThan(2.5 - 1);
    await a.close();
    await b.close();
  });

  it('Fridge Magnet: B sees the magnet effect of A', async () => {
    const [a, b, room] = await startTwo();
    await fire(a, room, 'magnet');
    await waitFor(
      () => b.latest!.effects.some((e) => e.kind === 'magnet' && e.owner === a.me.slot),
      'magnet in B snapshots',
    );
    await a.close();
    await b.close();
  });
});
