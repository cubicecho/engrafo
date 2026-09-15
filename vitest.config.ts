import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = [
  { find: '@', replacement: path.resolve(__dirname, './app/src') },
  // graphql ships no exports map: Vite follows `module` to index.mjs while
  // Node follows `main` to index.js, so a schema built on one copy fails the
  // instanceof checks of the other. Pin the bare specifier to Node's copy.
  { find: /^graphql$/, replacement: path.resolve(__dirname, './node_modules/graphql/index.js') },
];

// Two projects: server and db tests run a real Postgres in-process (PGlite) and
// must not pay for a DOM; component tests are a DOM and nothing else.
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
    // A test that forgets to build its own throwaway database gets an empty URL
    // and fails loudly, rather than quietly writing to the developer's Postgres.
    env: { DATABASE_URL: '' },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['db/**/*.test.ts', 'server/**/*.test.ts', 'app/src/lib/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['app/**/*.test.tsx'],
        },
      },
    ],
  },
});
