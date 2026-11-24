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

export const roomOf = (c: TestClient): GolfRoom =>
  matchMaker.getLocalRoomById(c.room.roomId) as GolfRoom;

/** Starts a 2-player match and waits for the playing phase. */
export async function startTwo(): Promise<[TestClient, TestClient, GolfRoom]> {
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
