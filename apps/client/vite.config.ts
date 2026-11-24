import { defineConfig } from 'vite';

export default defineConfig({
  // host: true so friends on the LAN can open http://<your-ip>:5173
  server: { port: 5173, host: true },
  build: {
    // Rapier's compat build embeds its WASM as base64 (about 4 MB raw, 1.6 MB gzipped).
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks so a game-code change does not re-download them.
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier';
          if (id.includes('/three/')) return 'three';
        },
      },
    },
  },
});
