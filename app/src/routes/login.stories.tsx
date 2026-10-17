import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
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

const meta = {
  title: 'Routes/Login',
  component: LoginPage,
  parameters: {
    layout: 'fullscreen',
    router: { initialEntries: [ROUTES.login] },
    apolloClient: { resolvers: resolvers(null) },
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
