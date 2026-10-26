import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { expect, fn, waitFor } from 'storybook/test';
import { PageLayout } from '@/components/page-layout';
import { clearToken, getToken, setToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { archiveServer, document } from '../../../.storybook/archive.ts';
import { RequireAuth } from './require-auth';

/**
 * The gate in front of every signed-in page: no token is the sign-in page, a token is the page
 * inside the shell, and a server that says the session is over takes the token away.
 *
 * The last one runs the app's own session link (`sessionOverLink`), which every `resolvers`
 * story's client has in front of its mock server. Where the app reloads into sign-in, the story
 * records the call instead, since a reload would take the story with it.
 */

const TOKEN = 'a-session-token';

/** Where the app would reload into sign-in. */
const sessionOver = fn();

function Framed() {
  return (
    <div className="h-screen">
      <Routes>
        <Route path={ROUTES.login} element={<h1>The sign-in page</h1>} />
        <Route
          path={ROUTES.documents}
          element={<RequireAuth contentSlot={<PageLayout title="Inbox" contentSlot={<p>Behind the gate</p>} />} />}
        />
      </Routes>
    </div>
  );
}

const ARCHIVE = archiveServer({ folders: [], documents: [document({ title: 'Tax return' })] });

const meta = {
  title: 'Layouts/RequireAuth',
  component: RequireAuth,
  render: () => <Framed />,
  args: { contentSlot: null },
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: [ROUTES.documents] },
    apolloClient: { resolvers: ARCHIVE, onSessionOver: sessionOver },
  },
  beforeEach: () => {
    sessionOver.mockClear();
    // Everything a story leaves in storage is there for the next file.
    return () => clearToken();
  },
} satisfies Meta<typeof RequireAuth>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No token: straight to sign-in, without the shell and without asking the server anything. */
export const SignedOut: Story = {
  beforeEach: () => clearToken(),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'The sign-in page' })).toBeInTheDocument();
    await expect(canvas.queryByRole('navigation')).not.toBeInTheDocument();
    await expect(canvas.queryByText('Behind the gate')).not.toBeInTheDocument();
  },
};

/** A token: the page, inside the shell with its sidebar. */
export const SignedIn: Story = {
  beforeEach: () => setToken(TOKEN),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    await expect(canvas.getByText('Behind the gate')).toBeInTheDocument();
    await expect(canvas.getAllByRole('link', { name: 'Documents' }).length).toBeGreaterThan(0);
    await expect(sessionOver).not.toHaveBeenCalled();
    await expect(getToken()).toBe(TOKEN);
  },
};

/** The server no longer knows the session: the token is dropped and the app goes to sign-in. */
export const SessionOver: Story = {
  beforeEach: () => setToken(TOKEN),
  parameters: {
    apolloClient: {
      onSessionOver: sessionOver,
      resolvers: {
        ...ARCHIVE,
        Query: {
          ...ARCHIVE.Query,
          folders: () => {
            throw new GraphQLError('Sign in again', { extensions: { code: 'UNAUTHENTICATED' } });
          },
        },
      },
    },
  },
  play: async () => {
    await waitFor(() => expect(sessionOver).toHaveBeenCalled());
    await expect(getToken()).toBeNull();
  },
};
