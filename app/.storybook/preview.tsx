import type { MockLink } from '@apollo/client/testing';
import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview, ReactRenderer } from '@storybook/react-vite';
import { print } from 'graphql';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { addons } from 'storybook/internal/preview-api';
import { type ApolloClientAddonState, EVENTS } from 'storybook-addon-apollo-client';
import { type ApolloParameters, withApollo } from './graphql';

// The app's own stylesheet, tokens and all. A harness that renders these components from a
// second set of tokens is not showing the same components, and the drift would be invisible.
import '../src/index.css';

function mockName(mock: MockLink.MockedResponse): string {
  const operation = mock.request.query.definitions.find((definition) => definition.kind === 'OperationDefinition');
  return operation && 'name' in operation && operation.name ? operation.name.value : 'Unnamed';
}

function stringify(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function panelState(mocks: readonly MockLink.MockedResponse[], activeIndex: number): ApolloClientAddonState {
  const mock = mocks[activeIndex];
  const options = mocks.map(mockName);
  if (!mock) return { options, activeIndex: -1 };
  return {
    options,
    activeIndex,
    query: print(mock.request.query),
    variables: stringify(mock.request.variables),
    result: stringify('result' in mock ? mock.result : undefined),
    error: 'error' in mock && mock.error ? String(mock.error) : undefined,
  };
}

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
      const parameters = context.parameters.apolloClient as ApolloParameters | undefined;

      // The addon ships a panel and no decorator, so the mocks it displays have to be handed to
      // it from here. Only `mocks` has anything to show — a `resolvers` story has no list of
      // canned responses to page through.
      useEffect(() => {
        const mocks = parameters?.mocks ?? [];
        const channel = addons.getChannel();
        const emit = (index: number) => channel.emit(EVENTS.RESULT, panelState(mocks, index));

        emit(mocks.length ? 0 : -1);
        channel.on(EVENTS.REQUEST, emit);
        return () => channel.off(EVENTS.REQUEST, emit);
      }, [parameters]);

      return withApollo(<Story />, parameters);
    },

    // Every domain component here is somewhere a link can point, so the router is unconditional.
    // `parameters.router.initialEntries` is how a story picks the route it is rendered at —
    // which is the whole subject of the sidebar's stories.
    (Story, context) => (
      <MemoryRouter initialEntries={context.parameters.router?.initialEntries ?? ['/']}>
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
