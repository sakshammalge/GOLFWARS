import { DEFAULT_SERVER_PORT } from '@golfwars/shared';
import { startBalanceWatcher } from './balanceWatcher.js';
import { createGameServer } from './server.js';

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
// Dev only: balance.dev.json is hot-reloaded into running rooms (ignored when NODE_ENV=production).
const balance = startBalanceWatcher();
const server = createGameServer({ balance });

await server.listen(port);
console.log(`GolfWars server listening on :${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    balance.stop();
    void server.stop().finally(() => process.exit(0));
  });
}
