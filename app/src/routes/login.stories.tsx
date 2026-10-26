import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphQLError } from 'graphql';
import { Route, Routes } from 'react-router';
import { expect, fn, userEvent, type within } from 'storybook/test';
import { clearToken, getToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { LoginPage } from './login';

/**
 * The sign-in page, with and without an OIDC provider configured. `authConfig` is answered
 * by a mock server built from the real SDL, so a renamed field on `SsoProvider` fails here.
 */

const SSO = { name: 'heautou', signInPath: '/sso/oidc' };

const REDIRECT_URI = 'http://localhost:3004/sso/oidc/callback';

/** An instance that already has accounts, or one whose provider is not the caller's to change. */
const NO_SETUP: { source: string; issuer: string | null; name: string | null; canPair: boolean; redirectUri: string } =
  {
    source: 'NONE',
    issuer: null,
    name: null,
    canPair: false,
    redirectUri: REDIRECT_URI,
  };

function resolvers(sso: typeof SSO | null, setup = NO_SETUP) {
  return { Query: { authConfig: () => ({ sso }), ssoSetup: () => setup } };
}

/** A brand-new instance: no accounts and no provider, so anyone may pair one, and pairing works. */
function newInstance() {
  let sso: typeof SSO | null = null;
  let setup = { ...NO_SETUP, canPair: true };
  return {
    Query: { authConfig: () => ({ sso }), ssoSetup: () => setup },
    Mutation: {
      pairSso: () => {
        sso = SSO;
        setup = { ...setup, source: 'PAIRED', issuer: 'https://id.example.com/oidc', name: SSO.name };
        return setup;
      },
    },
  };
}

const EMAIL = 'archivist@example.com';

const signInRequests = fn();

/** A server whose `requestSignIn` answers with `answer`, recording each address it was asked for. */
function signIn(answer: () => unknown) {
  return {
    Query: resolvers(null).Query,
    Mutation: {
      requestSignIn: (_parent: unknown, args: { email: string }) => {
        signInRequests(args.email);
        return answer();
      },
    },
  };
}

/** The page, and the archive it sends a signed-in reader on to. */
function Framed() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route path={ROUTES.documents} element={<h1>The archive</h1>} />
    </Routes>
  );
}

/** Types the address and asks for a link, as a reader would. */
async function requestLink(canvas: ReturnType<typeof within>, email = EMAIL) {
  await userEvent.type(await canvas.findByRole('textbox', { name: /email/i }), email);
  await userEvent.click(canvas.getByRole('button', { name: 'Send sign-in link' }));
}

const meta = {
  title: 'Routes/Login',
  component: LoginPage,
  render: () => <Framed />,
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: [ROUTES.login] },
    apolloClient: { resolvers: resolvers(null) },
  },
  beforeEach: () => {
    signInRequests.mockClear();
    // A token left by another story would send this page straight on to the archive.
    clearToken();
    return () => clearToken();
  },
} satisfies Meta<typeof LoginPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No provider: email is the only way in, and nothing mentions another. */
export const EmailOnly: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('textbox', { name: /email/i })).toBeInTheDocument();
    await expect(canvas.queryByText(/Sign in with/)).toBeNull();
  },
};

/** A provider: its button comes first, and it is a plain link to the server's start route. */
export const WithProvider: Story = {
  parameters: { apolloClient: { resolvers: resolvers(SSO) } },
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('link', { name: 'Sign in with heautou' });
    await expect(button).toHaveAttribute('href', SSO.signInPath);
    await expect(canvas.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
  },
};

/** A sign-in at the provider that failed comes back with `?error=`, and the page says so. */
export const ProviderFailed: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.login}?error=access_denied`] },
    apolloClient: { resolvers: resolvers(SSO) },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Signing in with heautou didn't work")).toBeInTheDocument();
    await expect(canvas.getByText(/access_denied/)).toBeInTheDocument();
  },
};

/** The provider's button was followed after it was disconnected: the page says what to do instead. */
export const ProviderGone: Story = {
  parameters: { router: { initialEntries: [`${ROUTES.login}?error=sso_off`] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('That sign-in button is gone')).toBeInTheDocument();
    await expect(canvas.queryByText(/The provider answered/)).toBeNull();
  },
};

/** An instance that already has accounts offers no setup tab: pairing is the admin's, in Settings. */
export const NoSetupOnceInUse: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('textbox', { name: /email/i })).toBeInTheDocument();
    await expect(canvas.queryByRole('tab', { name: 'Set up sign-in' })).toBeNull();
  },
};

/** A new instance: pair from the setup tab, and the provider's button is on the sign-in tab after. */
export const SetUpNewInstance: Story = {
  parameters: { apolloClient: { resolvers: newInstance() } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Set up sign-in' }));
    await userEvent.type(
      await canvas.findByRole('textbox', { name: /setup url/i }),
      'https://id.example.com/oidc#setup=abc&name=heautou',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Connect' }));
    await expect(await canvas.findByText('Paired with heautou')).toBeInTheDocument();
    await expect(await canvas.findByRole('link', { name: 'Sign in with heautou' })).toBeInTheDocument();
  },
};

/** An address the browser can tell is not one: the form stays, and nothing is asked of the server. */
export const InvalidAddress: Story = {
  parameters: { apolloClient: { resolvers: signIn(() => ({ sent: true, magicLink: null, session: null })) } },
  play: async ({ canvas }) => {
    await requestLink(canvas, 'not-an-address');
    await expect(canvas.getByRole('textbox', { name: /email/i })).toBeInvalid();
    await expect(signInRequests).not.toHaveBeenCalled();
    await expect(canvas.queryByText(/We sent a sign-in link/)).not.toBeInTheDocument();
  },
};

/** The link is on its way: the page says where, and offers to start again with another address. */
export const LinkSent: Story = {
  parameters: { apolloClient: { resolvers: signIn(() => ({ sent: true, magicLink: null, session: null })) } },
  play: async ({ canvas }) => {
    await requestLink(canvas);
    await expect(await canvas.findByText(`We sent a sign-in link to ${EMAIL}.`)).toBeInTheDocument();
    await expect(canvas.getByText('Open the link in that email to finish signing in.')).toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: 'Sign in now' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Use a different email' }));
    await expect(await canvas.findByRole('textbox', { name: /email/i })).toBeInTheDocument();
    await expect(signInRequests).toHaveBeenCalledOnce();
    await expect(signInRequests).toHaveBeenCalledWith(EMAIL);
  },
};

/**
 * An instance that exposes its links hands this one back: followed on this origin, whatever
 * origin `APP_URL` gave it, so a development server sends the reader to Vite, not to itself.
 */
export const LinkShown: Story = {
  parameters: {
    apolloClient: {
      resolvers: signIn(() => ({
        sent: true,
        magicLink: 'http://localhost:3004/auth/verify?token=link-token',
        session: null,
      })),
    },
  },
  play: async ({ canvas }) => {
    await requestLink(canvas);
    const link = await canvas.findByRole('link', { name: 'Sign in now' });
    await expect(link).toHaveAttribute('href', `${ROUTES.verify}?token=link-token`);
    await expect(
      canvas.getByText('This instance exposes sign-in links, so you can skip the email.'),
    ).toBeInTheDocument();
  },
};

/** On a `SECURE_LOCAL_NET` instance the answer is a session: kept, and straight on to the archive. */
export const SignedInDirectly: Story = {
  parameters: {
    apolloClient: {
      resolvers: signIn(() => ({ sent: false, magicLink: null, session: { token: 'a-new-session' } })),
    },
  },
  play: async ({ canvas }) => {
    await requestLink(canvas);
    await expect(await canvas.findByRole('heading', { level: 1, name: 'The archive' })).toBeInTheDocument();
    await expect(getToken()).toBe('a-new-session');
  },
};

/** Too many requests for one address or from one network: the server's reason is on the page. */
export const RateLimited: Story = {
  parameters: {
    apolloClient: {
      resolvers: signIn(() => {
        throw new GraphQLError('Too many sign-in attempts. Try again in a minute.', {
          extensions: { code: 'TOO_MANY_REQUESTS' },
        });
      }),
    },
  },
  play: async ({ canvas }) => {
    await requestLink(canvas);
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Could not send the sign-in link');
    await expect(alert).toHaveTextContent('Too many sign-in attempts. Try again in a minute.');
    // Still the form, so the reader can try again once the limit has passed.
    await expect(canvas.getByRole('textbox', { name: /email/i })).toHaveValue(EMAIL);
  },
};

/** A request that fails for any other reason says so too, rather than claiming a link was sent. */
export const RequestFails: Story = {
  parameters: {
    apolloClient: {
      resolvers: signIn(() => {
        throw new Error('The server is restarting');
      }),
    },
  },
  play: async ({ canvas }) => {
    await requestLink(canvas);
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('The server is restarting');
    await expect(canvas.queryByText(/We sent a sign-in link/)).not.toBeInTheDocument();
  },
};
