import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Colyseus (via pm2 io) talks over process.send, which breaks vitest's default forks pool.
  test: { pool: 'threads' },
});
