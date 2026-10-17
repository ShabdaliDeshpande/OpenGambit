import type { Server } from 'node:http';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Runs the account API and the online-play WebSocket server inside `vite` and `vite preview`. */
function backend(): Plugin {
  // loaded on demand, so tests and builds never open the database
  const start = async () => (await import('./server/backend.ts')).startBackend();
  return {
    name: 'chess-backend',
    async configureServer(server) {
      if (!server.httpServer || process.env.VITEST) return;
      const b = await start();
      server.middlewares.use((req, res, next) => b.api(req, res, next));
      b.attach(server.httpServer as Server);
    },
    async configurePreviewServer(server) {
      const b = await start();
      server.middlewares.use((req, res, next) => b.api(req, res, next));
      b.attach(server.httpServer as Server);
    },
  };
}

export default defineConfig({
  plugins: [react(), backend()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
