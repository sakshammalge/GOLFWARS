// Server load + bandwidth benchmark: starts the real server in-process and connects N bots that
// send random (but plausible) inputs over real WebSockets.
//
//   pnpm --filter @golfwars/server bench                 # 8 players, 15 s
//   pnpm --filter @golfwars/server bench -- 2 20         # 2 players, 20 s
import { matchMaker } from '@colyseus/core';
import { MATCH, MessageType, NO_INPUT, STEP_DT, type WindupInput } from '@golfwars/shared';
import { createGameServer } from '../src/server.js';
import type { GolfRoom } from '../src/GolfRoom.js';
import { TestClient, sleep, waitFor } from '../test/helpers.js';

const players = Number(process.argv[2] ?? 8);
const seconds = Number(process.argv[3] ?? 15);

const server = createGameServer({
  match: { ...MATCH, introSeconds: 0.3, holeTimeSeconds: 3600 },
});
const port = 20000 + Math.floor(Math.random() * 30000);
await server.listen(port);
const url = `ws://localhost:${port}`;

const clients: TestClient[] = [];
const host = await TestClient.create(url, { nickname: 'bot0' });
clients.push(host);
for (let i = 1; i < players; i++) {
  clients.push(await TestClient.join(url, host.room.roomId, { nickname: `bot${i}` }));
}
await waitFor(() => host.state.players.size === players, 'all bots joined');

// Count every byte the server sends each client (all message types, payload only).
const wire = clients.map(() => ({ bytes: 0, msgs: 0 }));
clients.forEach((c, i) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws = (c.room.connection as any).transport.ws;
  ws.addEventListener('message', (e: { data: ArrayBuffer | Uint8Array | string }) => {
    const d = e.data;
    wire[i]!.bytes += typeof d === 'string' ? d.length : (d as ArrayBuffer).byteLength;
    wire[i]!.msgs++;
  });
});

host.room.send(MessageType.Start);
await waitFor(() => host.state.matchPhase === 'playing', 'playing');
const room = matchMaker.getLocalRoomById(host.room.roomId) as GolfRoom;
room.stats.ticks = 0;
room.stats.totalMs = 0;
room.stats.maxMs = 0;
wire.forEach((w) => ((w.bytes = 0), (w.msgs = 0)));
clients.forEach((c) => (c.snapshotBytes = 0));

// Bots: hold a random direction for a random time, sometimes sprint / jump / swing, and shoot
// whenever their ball is at rest.
let running = true;
async function bot(c: TestClient): Promise<void> {
  let input: WindupInput = NO_INPUT;
  let until = 0;
  while (running) {
    const now = Date.now();
    if (now > until) {
      until = now + 300 + Math.random() * 1200;
      const a = Math.random() * Math.PI * 2;
      input = {
        ...NO_INPUT,
        moveX: Math.random() < 0.2 ? 0 : Math.cos(a),
        moveZ: Math.random() < 0.2 ? 0 : Math.sin(a),
        cameraYaw: Math.random() * Math.PI * 2,
        sprint: Math.random() < 0.3,
      };
    }
    const tick: WindupInput = {
      ...input,
      jump: Math.random() < 0.01,
      swing: Math.random() < 0.01,
    };
    const shot =
      Math.random() < 0.02
        ? ([Math.random() * 6, 0, Math.random()] as [number, number, number])
        : undefined;
    c.sendInput(tick, shot);
    await sleep(1000 / 60);
  }
}
const bots = clients.map((c) => bot(c));
await sleep(seconds * 1000);
running = false;
await Promise.all(bots);

const t = room.stats;
const avgMs = t.totalMs / t.ticks;
const budget = STEP_DT * 1000;
const perClient = wire.map((w) => w.bytes / seconds);
const snapPerClient = clients.map((c) => c.snapshotBytes / seconds);
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
console.log(`\n=== bench: ${players} players, ${seconds} s ===`);
console.log(
  `server tick: ${t.ticks} ticks, avg ${avgMs.toFixed(3)} ms, max ${t.maxMs.toFixed(2)} ms  (budget ${budget.toFixed(2)} ms, avg ${((avgMs / budget) * 100).toFixed(1)}% of a core at 60 Hz)`,
);
console.log(
  `per client, all server->client bytes: avg ${(mean(perClient) / 1024).toFixed(2)} KB/s (min ${(Math.min(...perClient) / 1024).toFixed(2)}, max ${(Math.max(...perClient) / 1024).toFixed(2)}), ${(mean(wire.map((w) => w.msgs)) / seconds).toFixed(1)} msgs/s`,
);
console.log(
  `per client, snapshot payload only: avg ${(mean(snapPerClient) / 1024).toFixed(2)} KB/s, ${(mean(clients.map((c) => c.snaps.length)) / (seconds + 1)).toFixed(1)} snapshots/s`,
);
for (const c of clients) await c.close();
await server.stop();
process.exit(0);
