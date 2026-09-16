import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { SettingsRoute } from './settings';

/**
 * The settings screen against a mock server built from the real SDL.
 *
 * This is the `resolvers` half of the Apollo parameter rather than a list of canned responses,
 * and the difference matters here: the page asks for `me` and `serverConfig` in one query, and
 * the answer is executed against the schema `server/` prints from its own Drizzle models. A
 * field that gets renamed there, or a scalar that changes shape, fails these stories — where a
 * hand-written `MockedProvider` response would happily keep serving the old shape forever.
 */

const RESOLVERS = {
  Query: {
    me: () => ({
      id: '9c1f0a6e-5d33-4f1b-8e27-0a9b8c7d6e5f',
      email: 'archivist@example.com',
      createdAt: '2026-01-14T09:30:00.000Z',
    }),
    serverConfig: () => ({
      version: '1.4.2',
      maxUploadBytes: 100 * 1024 * 1024,
      acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'],
      ocrAvailable: true,
      ocrDefault: true,
    }),
  },
};

/** Bounded height, because `PageLayout` is a sticky chassis that scrolls its own body. */
function Framed() {
  return (
    <div className="h-screen">
      <SettingsRoute />
    </div>
  );
}

const meta = {
  title: 'Routes/Settings',
  component: SettingsRoute,
  render: () => <Framed />,
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: ['/settings'] },
    apolloClient: { resolvers: RESOLVERS },
  },
} satisfies Meta<typeof SettingsRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Everything the page has to say, with OCR installed and turned on. */
export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('archivist@example.com')).toBeInTheDocument();
    await expect(canvas.getByText('1.4.2')).toBeInTheDocument();
    await expect(canvas.getByText('100.0 MB')).toBeInTheDocument();
    await expect(canvas.getByText('Available, on by default')).toBeInTheDocument();
  },
};

/**
 * The same instance without `ocrmypdf`. The card has to say so in words — "Unavailable" is the
 * difference between "this scan will get searchable text" and "it will not", and the upload
 * panel's disabled switch is not visible from here.
 */
export const WithoutOcr: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          ...RESOLVERS.Query,
          serverConfig: () => ({ ...RESOLVERS.Query.serverConfig(), ocrAvailable: false, ocrDefault: false }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/Unavailable — ocrmypdf is not installed/)).toBeInTheDocument();
  },
};

/** Before the answer lands. The skeleton stands in for the cards rather than the page being blank. */
export const Loading: Story = {
  parameters: { apolloClient: { resolvers: RESOLVERS, delay: 100_000 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading');
    await expect(canvas.queryByText('archivist@example.com')).not.toBeInTheDocument();
  },
};

/**
 * The server answered with an error. A page that renders a failure as an absence tells someone
 * whose server has gone away that they have no settings, so the rung has to be its own state
 * with the reason and a way to ask again.
 */
export const Unreachable: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          ...RESOLVERS.Query,
          me: () => {
            throw new Error('Unauthenticated');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Could not load your settings')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  },
};
