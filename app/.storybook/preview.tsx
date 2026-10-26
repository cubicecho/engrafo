import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview, ReactRenderer } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { ROUTES } from '../src/lib/routes';
import { type ApolloParameters, withApollo } from './graphql';

// The app's own stylesheet, tokens and all. A harness that renders these components from a
// second set of tokens is not showing the same components, and the drift would be invisible.
import '../src/index.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // Collecting a report nobody reads is not a check. These are the app's own screens, and an
    // unlabelled control or a badge under 4.5:1 is a bug the same way a crash is.
    a11y: { test: 'error' },
  },

  decorators: [
    // Innermost, so a story's own decorators still see the router and the client.
    (Story, context) => {
      // Storybook types every parameter as `any`, so this annotation is where the shape is
      // stated; nothing upstream checks a story against it.
      const parameters: ApolloParameters | undefined = context.parameters.apolloClient;

      // The addon draws its panel from `parameters.apolloClient.mocks` by itself (v11 adds that
      // decorator from main.ts); the provider is still ours, because a `resolvers` story runs a
      // mock server the addon knows nothing about, and every story needs a client either way.
      return withApollo(<Story />, parameters);
    },

    // Every domain component here is somewhere a link can point, so the router is unconditional.
    // `parameters.router.initialEntries` is how a story picks the route it is rendered at —
    // which is the whole subject of the sidebar's stories.
    (Story, context) => (
      <MemoryRouter initialEntries={context.parameters.router?.initialEntries ?? [ROUTES.documents]}>
        <Story />
      </MemoryRouter>
    ),

    withThemeByClassName<ReactRenderer>({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
};

export default preview;
