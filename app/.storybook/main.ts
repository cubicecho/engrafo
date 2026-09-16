import type { StorybookConfig } from '@storybook/react-vite';
import { mockBucket } from './mock-bucket.ts';

// Stories are colocated with the component they document — `upload-panel.tsx` and
// `upload-panel.stories.tsx` in the same folder — so a component that changes shape and the
// story that claims it still works show up in the same diff.
//
// Nothing under `components/ui/`: that tree is vendored from cubeui (AGENTS.md), and stories
// for it belong upstream where the component is maintained, not in a copy of it.

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],

  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
    '@storybook/addon-vitest',
    // Only a panel: since v10 the addon ships no decorator, so `preview.tsx` provides the
    // MockedProvider and feeds this the mocks it is showing.
    'storybook-addon-apollo-client',
  ],

  framework: { name: '@storybook/react-vite', options: {} },

  // This is a private app, not a library. Nothing here needs to be reported upstream, and CI
  // should not make a network call it does not need.
  core: { disableTelemetry: true },

  // The same plugin `vitest.config.ts` adds, so the upload stories behave the same whether they
  // are being read in the browser or run as tests.
  viteFinal: (config) => {
    config.plugins = [...(config.plugins ?? []), mockBucket()];
    return config;
  },

  typescript: {
    // The prop tables are the TSDoc already on every prop, put in front of a consumer rather
    // than only a reader of the source.
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => !prop.parent || !/node_modules/.test(prop.parent.fileName),
    },
  },
};

export default config;
