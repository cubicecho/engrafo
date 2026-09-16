import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { mockBucket } from './.storybook/mock-bucket.ts';

import viteConfig from './vite.config.ts';

/**
 * Every story is a test.
 *
 * This is the project the root `vitest.config.ts` references as `storybook`, and it is why
 * there is no headless-Chrome script in this repo any more: a story is a rendered component
 * with its data already decided, so the thing that used to need a browser driver and a real
 * login is now a file next to the component.
 *
 * It runs in an actual browser rather than jsdom, because what these stories assert is layout
 * and computed style — a sidebar row that is lit, a body that scrolls while its header does
 * not, a badge that clears 4.5:1 — and a simulated DOM has none of that. The `dom` project in
 * the root config stays on jsdom for the tests that are about behaviour, not pixels.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [
      storybookTest({ configDir: fileURLToPath(new URL('./.storybook', import.meta.url)) }),
      // `viteFinal` in `.storybook/main.ts` is the dev server's copy of this; the addon does not
      // apply it here, so the stories that PUT to the mock bucket need it registered again.
      mockBucket(),
    ],
    test: {
      name: 'storybook',
      // Last, alone. The other two projects run a Postgres per test file; a Chromium next to
      // them starves both, and what it looks like is a database hook timing out.
      sequence: { groupOrder: 1 },
      // Nothing here is a long test — every story renders, asserts and stops. The default 15s
      // is a CPU-starvation threshold rather than a correctness one, and on a two-core runner
      // rendering a page under axe can cross it. A story that is genuinely stuck still fails.
      testTimeout: 30_000,
      // No setup file: since Storybook 10.3 the addon applies `.storybook/preview.tsx` itself,
      // so the stylesheet, the router and the Apollo decorators are already in place here.
      //
      // One browser session at a time. Run in parallel, a session drops its websocket partway
      // through and the run dies with "browser connection was closed" on whichever file lost
      // the race.
      fileParallelism: false,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({
          launchOptions: {
            args: [
              // Chromium's sandbox needs user namespaces, which containers and most CI images
              // do not grant.
              '--no-sandbox',
              // Chromium sizes its shared memory against /dev/shm, 64MB in a default
              // container. The renderer dies mid-run without this, and it presents as
              // "browser connection was closed" on whichever file was unlucky.
              '--disable-dev-shm-usage',
            ],
          },
        }),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
);
