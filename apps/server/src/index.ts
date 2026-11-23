import { DEFAULT_SERVER_PORT } from '@golfwars/shared';
import { createGameServer } from './server.js';

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const server = createGameServer();

await server.listen(port);
console.log(`GolfWars server listening on :${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.stop().finally(() => process.exit(0));
  });
}
