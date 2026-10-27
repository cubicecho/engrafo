import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { clientId } from '@/lib/id';
import { ROUTES } from '@/lib/routes';
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

const MAX_UPLOAD_BYTES = 104_857_600;

/** How many times `visionSettings` was asked, across the stories in this file. */
let visionSettingsReads = 0;

/** The page at one tab, as a link to it would open it. */
function at(tab: string) {
  return { initialEntries: [`${ROUTES.settings}?tab=${tab}`] };
}

const RESOLVERS = {
  Query: {
    me: () => ({
      id: '9c1f0a6e-5d33-4f1b-8e27-0a9b8c7d6e5f',
      email: 'archivist@example.com',
      createdAt: '2026-01-14T09:30:00.000Z',
      isAdmin: false,
    }),
    ssoSetup: () => ({
      source: 'NONE',
      issuer: null,
      name: null,
      canPair: true,
      redirectUri: 'http://localhost:3004/sso/oidc/callback',
    }),
    serverConfig: () => ({
      version: '1.4.2',
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxImportBytes: 5_368_709_120,
      acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'],
      ocrAvailable: true,
      ocrDefault: true,
      visionAvailable: true,
      visionAuto: true,
    }),
    apiKeys: () => [],
    latestImport: () => null,
    visionSettings: () => {
      // The page must never ask this for anyone but the admin: the real server answers FORBIDDEN.
      visionSettingsReads += 1;
      return {
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5vl:7b',
        hasApiKey: false,
        auto: true,
        requestTimeoutSeconds: 600,
        maxResponseTokens: 4096,
        imageDetail: 'AUTO',
        temperature: 0.6,
        textFormat: 'PLAIN',
        configured: true,
      };
    },
    visionModels: () => [{ id: 'qwen2.5vl:7b', contextLength: null }],
  },
};

/** The same server, signed in as the admin. */
const ADMIN_RESOLVERS = {
  Query: { ...RESOLVERS.Query, me: () => ({ ...RESOLVERS.Query.me(), isAdmin: true }) },
};

/** A key as `apiKeys` answers it. */
interface ApiKeyFixture {
  id: string;
  name: string;
  start: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const CLAUDE_CODE_KEY: ApiKeyFixture = {
  id: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  name: 'Claude Code on my laptop',
  start: 'engr_Ab12Cd34',
  lastUsedAt: '2026-10-20T08:00:00.000Z',
  expiresAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
};

/** A server whose keys can be made and revoked, so a story sees the list change. */
function keyServer(start: ApiKeyFixture[]) {
  const keys = [...start];
  return {
    Query: { ...RESOLVERS.Query, apiKeys: () => keys },
    Mutation: {
      createApiKey: (_parent: unknown, args: { name: string }) => {
        const apiKey = { ...CLAUDE_CODE_KEY, id: clientId(), name: args.name, lastUsedAt: null };
        keys.unshift(apiKey);
        return { apiKey, key: 'engr_Ab12Cd34TheRestOfTheSecretKey' };
      },
      revokeApiKey: (_parent: unknown, args: { id: string }) => {
        keys.splice(
          keys.findIndex((key) => key.id === args.id),
          1,
        );
        return true;
      },
    },
  };
}

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
    router: { initialEntries: [ROUTES.settings] },
    apolloClient: { resolvers: RESOLVERS },
  },
} satisfies Meta<typeof SettingsRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first tab, which is where the page opens: the account, and the theme on this device. */
export const Ready: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('archivist@example.com')).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
    // The one control on this page that is not read-only. It is a device preference, so it has
    // no mutation behind it and no server state to wait for — it is here because settings is
    // where someone looks for it, not because the query supplies it.
    await expect(canvas.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    // How people sign in is the instance's, so an account that is not the admin is not shown it.
    await expect(canvas.queryByRole('tab', { name: 'Sign-in' })).not.toBeInTheDocument();
    await expect(canvas.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Account',
      'Processing',
      'MCP',
      'Backup',
      'About',
    ]);
  },
};

/** A tab is a link: pressing one opens it, and the URL carries it, so a reload lands there too. */
export const SwitchesTabs: Story = {
  play: async ({ canvas }) => {
    await canvas.findByText('archivist@example.com');
    const about = canvas.getByRole('tab', { name: 'About' });
    await expect(about).toHaveAttribute('href', '/settings?tab=about');
    await userEvent.click(about);
    await expect(await canvas.findByText('1.4.2')).toBeInTheDocument();
    await expect(canvas.queryByText('archivist@example.com')).not.toBeInTheDocument();
  },
};

/** What the server accepts and does with it, with OCR installed and turned on, for someone who is not the admin. */
export const Processing: Story = {
  parameters: { router: at('processing') },
  play: async ({ canvas }) => {
    const readsBefore = visionSettingsReads;
    await expect(await canvas.findByText('100.0 MB')).toBeInTheDocument();
    await expect(canvas.getByText('Available, on by default')).toBeInTheDocument();
    await expect(canvas.getByText('On, reads every OCR’d document automatically')).toBeInTheDocument();
    await expect(canvas.queryByRole('textbox', { name: 'Base URL' })).not.toBeInTheDocument();
    await expect(visionSettingsReads).toBe(readsBefore);
  },
};

/** The admin sets the vision model up on the same tab. */
export const ProcessingAdmin: Story = {
  parameters: { router: at('processing'), apolloClient: { resolvers: ADMIN_RESOLVERS } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('textbox', { name: 'Base URL' })).toHaveValue('http://localhost:11434/v1');
    await expect(await canvas.findByText('Connected')).toBeInTheDocument();
    await expect(canvas.getByText('100.0 MB')).toBeInTheDocument();
  },
};

/** The version, worth quoting in a bug report. */
export const About: Story = {
  parameters: { router: at('about') },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1.4.2')).toBeInTheDocument();
  },
};

/** A tab that does not exist opens the first, rather than an empty page. */
export const UnknownTab: Story = {
  parameters: { router: at('nonsense') },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('archivist@example.com')).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
  },
};

/** A link to the sign-in tab, opened by someone who is not the admin, opens the first tab instead. */
export const SignInTabForOthers: Story = {
  parameters: { router: at('sign-in') },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('archivist@example.com')).toBeInTheDocument();
    await expect(canvas.queryByRole('tab', { name: 'Sign-in' })).not.toBeInTheDocument();
  },
};

/** The admin also gets the sign-in tab, here with nothing paired yet, so it offers the form. */
export const Admin: Story = {
  parameters: { apolloClient: { resolvers: ADMIN_RESOLVERS } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Sign-in' }));
    await expect(await canvas.findByRole('heading', { name: 'Sign-in' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: /setup url/i })).toBeInTheDocument();
  },
};

/**
 * The same instance without `ocrmypdf`. The card has to say so in words — "Unavailable" is the
 * difference between "this scan will get searchable text" and "it will not", and the upload
 * panel's disabled switch is not visible from here.
 */
export const WithoutOcr: Story = {
  parameters: {
    router: at('processing'),
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
    await expect(canvas.getByRole('status')).toHaveAccessibleName('Loading');
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
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load your settings');
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  },
};

/** The MCP card: where an agent connects, and the keys it connects with, none shown whole. */
export const McpKeys: Story = {
  parameters: { router: at('mcp'), apolloClient: { resolvers: keyServer([CLAUDE_CODE_KEY]) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Claude Code on my laptop')).toBeInTheDocument();
    await expect(canvas.getByText(/\/mcp$/)).toBeInTheDocument();
    await expect(canvas.getByText('engr_Ab12Cd34…')).toBeInTheDocument();
    await expect(canvas.getByText(/Never expires/)).toBeInTheDocument();
  },
};

/** A new key is shown once, with what to paste into Claude Code, then listed by its start alone. */
export const MakesAKey: Story = {
  parameters: { router: at('mcp'), apolloClient: { resolvers: keyServer([]) } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByText(/No keys yet/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'New key' }));

    const form = within(await page.findByRole('dialog', { name: 'New API key' }));
    await userEvent.type(form.getByRole('textbox', { name: /Name/ }), 'Claude Desktop');
    await userEvent.click(form.getByRole('button', { name: 'Make key' }));

    const shown = within(await page.findByRole('dialog', { name: 'Your new API key' }));
    await expect(shown.getAllByText(/engr_Ab12Cd34TheRestOfTheSecretKey/).length).toBeGreaterThan(0);
    await expect(shown.getByText(/claude mcp add --transport http engrafo/)).toBeInTheDocument();
    await userEvent.click(shown.getByRole('button', { name: 'Done' }));

    await expect(await canvas.findByText('Claude Desktop')).toBeInTheDocument();
    await expect(canvas.queryByText(/TheRestOfTheSecretKey/)).not.toBeInTheDocument();
  },
};

/** Revoking asks first, saying what stops working, and the key leaves the list. */
export const RevokesAKey: Story = {
  parameters: { router: at('mcp'), apolloClient: { resolvers: keyServer([CLAUDE_CODE_KEY]) } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke' }));
    const dialog = within(await page.findByRole('alertdialog'));
    await expect(dialog.getByText(/refused from its next call/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(canvas.queryByText('Claude Code on my laptop')).not.toBeInTheDocument());
  },
};
