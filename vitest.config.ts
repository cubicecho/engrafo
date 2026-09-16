import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = [
  { find: '@', replacement: path.resolve(__dirname, './app/src') },
  // graphql ships no exports map: Vite follows `module` to index.mjs while
  // Node follows `main` to index.js, so a schema built on one copy fails the
  // instanceof checks of the other. Pin the bare specifier to Node's copy.
  { find: /^graphql$/, replacement: path.resolve(__dirname, './node_modules/graphql/index.js') },
];

// Three projects: server and db tests run a real Postgres in-process (PGlite) and
// must not pay for a DOM; component tests are a DOM and nothing else; the stories
// render in a real browser.
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
          // Group 0 with `dom`, so both finish before the browser starts. Left to run
          // alongside it, PGlite loses: it builds a Postgres per test file, and sharing the
          // machine with a Chromium pushes those `beforeEach` hooks past their 10s timeout.
          // The failure reads as a broken database test, which is the wrong place to look.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['app/**/*.test.tsx'],
          sequence: { groupOrder: 0 },
        },
      },
      // The third project is the stories, and it owns its own config file because it needs the
      // app's Vite plugins — React and Tailwind — which nothing else here does.
      './app/vitest.config.ts',
    ],
  },
});
