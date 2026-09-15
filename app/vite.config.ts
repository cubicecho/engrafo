import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app talks to a relative /graphql, proxied here in dev so the token never
// crosses origins. In production the server serves dist/ from the same origin.
// Point ENGRAFO_SERVER_URL elsewhere to develop against a remote server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // Listen on all interfaces — dev often runs on a VM or remote docker host,
    // where vite's localhost-only default would be unreachable.
    host: true,
    port: 3000,
    proxy: {
      '/graphql': process.env.ENGRAFO_SERVER_URL ?? 'http://localhost:3004',
    },
  },
});
