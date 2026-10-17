import type { Server } from 'node:http';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { attachGameServer } from './server/transport.ts';

/** Runs the online-play WebSocket server inside `vite` and `vite preview`. */
function gameServer(): Plugin {
  return {
    name: 'game-server',
    configureServer(server) {
      if (server.httpServer) attachGameServer(server.httpServer as Server);
    },
    configurePreviewServer(server) {
      attachGameServer(server.httpServer as Server);
    },
  };
}

export default defineConfig({
  plugins: [react(), gameServer()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
