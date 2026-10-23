import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app talks to a relative /graphql, proxied here in dev so the token never
// crosses origins. /sso and /api/auth are the two legs of an OIDC sign-in,
// which the server answers over plain HTTP. In production the server serves dist/ from the same origin.
// Point ENGRAFO_SERVER_URL elsewhere to develop against a remote server.
const SERVER_URL = process.env.ENGRAFO_SERVER_URL ?? 'http://localhost:3004';

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
      '/graphql': SERVER_URL,
      '/sso': SERVER_URL,
      '/api/auth': SERVER_URL,
      '/mcp': SERVER_URL,
    },
  },
});
