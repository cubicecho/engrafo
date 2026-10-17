import type { MockLink } from '@apollo/client/testing';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Route, Routes } from 'react-router';
import { expect } from 'storybook/test';
import { VerifyOneTimeTokenDocument } from '@/__generated__/graphql';
import { clearToken, getToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { SsoPage } from './sso';

/**
 * Where an OIDC sign-in lands. The request is the subject here — this token, sent once — so
 * these use exact mocks rather than a mock server.
 */

const TOKEN = 'ott-abc123';
const SESSION = 'session-token-xyz';

const verified: MockLink.MockedResponse = {
  request: { query: VerifyOneTimeTokenDocument, variables: { token: TOKEN } },
  result: { data: { verifyOneTimeToken: { token: SESSION } } },
};

const refused: MockLink.MockedResponse = {
  request: { query: VerifyOneTimeTokenDocument, variables: { token: TOKEN } },
  result: {
    errors: [{ message: 'Invalid or expired sign-in', extensions: { code: 'BAD_USER_INPUT' } }],
  },
};

/** The page and where it navigates to, so a successful swap has somewhere visible to land. */
function Harness() {
  return (
    <Routes>
      <Route path={ROUTES.sso} element={<SsoPage />} />
      <Route path={ROUTES.documents} element={<p>Archive</p>} />
    </Routes>
  );
}

const meta = {
  title: 'Routes/SSO',
  component: SsoPage,
  render: () => <Harness />,
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: [`${ROUTES.sso}?token=${TOKEN}`] },
  },
  beforeEach: () => {
    clearToken();
    return () => clearToken();
  },
} satisfies Meta<typeof SsoPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The token is swapped for a session, which is kept, and the archive opens. */
export const SignedIn: Story = {
  parameters: { apolloClient: { mocks: [verified] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Archive')).toBeInTheDocument();
    await expect(getToken()).toBe(SESSION);
  },
};

/** A spent or expired token: no session, and a way back to the login page. */
export const Refused: Story = {
  parameters: { apolloClient: { mocks: [refused] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("That sign-in didn't work")).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', ROUTES.login);
    await expect(getToken()).toBeNull();
  },
};

/** Reached with no token at all: nothing is sent, and the page says so at once. */
export const NoToken: Story = {
  parameters: { router: { initialEntries: [ROUTES.sso] }, apolloClient: { mocks: [] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("That sign-in didn't work")).toBeInTheDocument();
  },
};
