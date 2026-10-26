import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { expect, fn } from 'storybook/test';
import { clearToken, getToken, setToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { VerifyPage } from './verify';

/**
 * Where a magic link lands: it trades the token in the URL for a session, once. A link that is
 * bad or spent says so and signs no one out, since whoever follows an old link may well be
 * signed in already.
 */

const LINK_TOKEN = 'link-token';
const SESSION = 'a-new-session';
const EXISTING = 'an-existing-session';
/** Long enough for a request the page should not have made to have been made. */
const SETTLE_MS = 100;

const verifyCalls = fn();
/** Where the app would reload into sign-in. Never, on this page. */
const sessionOver = fn();

function Framed() {
  return (
    <Routes>
      <Route path={ROUTES.verify} element={<VerifyPage />} />
      <Route path={ROUTES.documents} element={<h1>The archive</h1>} />
    </Routes>
  );
}

function resolvers(verifyMagicLink: (_parent: unknown, args: { token: string }) => unknown) {
  return {
    Mutation: {
      verifyMagicLink: (parent: unknown, args: { token: string }) => {
        verifyCalls(args.token);
        return verifyMagicLink(parent, args);
      },
    },
  };
}

const meta = {
  title: 'Routes/Verify',
  component: VerifyPage,
  render: () => <Framed />,
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: [`${ROUTES.verify}?token=${LINK_TOKEN}`] },
    apolloClient: { resolvers: resolvers(() => ({ token: SESSION })), onSessionOver: sessionOver },
  },
  beforeEach: () => {
    verifyCalls.mockClear();
    sessionOver.mockClear();
    clearToken();
    return () => clearToken();
  },
} satisfies Meta<typeof VerifyPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** While the server checks the link. */
export const Verifying: Story = {
  parameters: {
    apolloClient: { resolvers: resolvers(() => ({ token: SESSION })), delay: 100_000 },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Signing you in…' })).toBeInTheDocument();
    await expect(canvas.getByRole('status', { name: 'Signing you in' })).toBeInTheDocument();
  },
};

/** A good link: the session is kept, and the reader lands on the archive with the link out of the URL. */
export const Verified: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'The archive' })).toBeInTheDocument();
    await expect(getToken()).toBe(SESSION);
    await expect(verifyCalls).toHaveBeenCalledOnce();
    await expect(verifyCalls).toHaveBeenCalledWith(LINK_TOKEN);
  },
};

/** A spent or expired link is `BAD_USER_INPUT`: the page says so, and the session already here stays. */
export const BadLink: Story = {
  beforeEach: () => setToken(EXISTING),
  parameters: {
    apolloClient: {
      onSessionOver: sessionOver,
      resolvers: resolvers(() => {
        throw new GraphQLError('This link has expired', { extensions: { code: 'BAD_USER_INPUT' } });
      }),
    },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'This sign-in link is invalid or has expired' }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Request a new one' })).toHaveAttribute('href', ROUTES.login);
    await expect(getToken()).toBe(EXISTING);
    await expect(sessionOver).not.toHaveBeenCalled();
  },
};

/** A link with its token cut off: nothing to send, so nothing is sent. */
export const NoToken: Story = {
  parameters: { router: { initialEntries: [ROUTES.verify] } },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'This sign-in link is invalid or has expired' }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await expect(verifyCalls).not.toHaveBeenCalled();
  },
};
