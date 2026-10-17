import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SsoSettings } from './sso-pairing';

/**
 * The admin's sign-in card, in each of the three places a provider can come from, against a mock
 * server built from the real SDL. The mutations are answered too, so pairing and disconnecting
 * run through the same refetch the page does.
 */

const REDIRECT_URI = 'http://localhost:3004/sso/oidc/callback';
const NONE = { source: 'NONE', issuer: null, name: null, canPair: true, redirectUri: REDIRECT_URI };
const PAIRED = {
  source: 'PAIRED',
  issuer: 'https://id.example.com/oidc',
  name: 'heautou',
  canPair: true,
  redirectUri: REDIRECT_URI,
};
const ENV = { source: 'ENV', issuer: null, name: 'Corp SSO', canPair: false, redirectUri: REDIRECT_URI };

/** A server holding one setup, which `pairSso` and `unpairSso` change as the real one would. */
function server(initial: typeof NONE | typeof PAIRED | typeof ENV, pairError?: string) {
  let setup = initial;
  return {
    Query: { ssoSetup: () => setup, authConfig: () => ({ sso: null }) },
    Mutation: {
      pairSso: () => {
        if (pairError) {
          throw new Error(pairError);
        }
        setup = PAIRED;
        return setup;
      },
      unpairSso: () => {
        setup = NONE;
        return setup;
      },
    },
  };
}

const meta = {
  title: 'Domain/SsoSettings',
  component: SsoSettings,
  parameters: { apolloClient: { resolvers: server(NONE) } },
} satisfies Meta<typeof SsoSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing paired: the card is the form, and connecting turns it into the paired row. */
export const NotPaired: Story = {
  parameters: { apolloClient: { resolvers: server(NONE) } },
  play: async ({ canvas }) => {
    const field = await canvas.findByRole('textbox', { name: /setup url/i });
    await userEvent.type(field, 'https://id.example.com/oidc#setup=abc&name=heautou');
    await userEvent.click(canvas.getByRole('button', { name: 'Connect' }));
    await expect(await canvas.findByText('Sign in with heautou')).toBeInTheDocument();
    await expect(canvas.getByText('Paired with https://id.example.com/oidc.')).toBeInTheDocument();
  },
};

/** A setup URL the provider would not take: the server's words are shown, and the form stays. */
export const PairingRefused: Story = {
  parameters: {
    apolloClient: {
      resolvers: server(
        NONE,
        'This setup URL has expired, was used already, or was cancelled. Ask your provider for a new one.',
      ),
    },
  },
  play: async ({ canvas }) => {
    await userEvent.type(
      await canvas.findByRole('textbox', { name: /setup url/i }),
      'https://id.example.com/oidc#setup=old',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Connect' }));
    await expect(await canvas.findByText(/has expired, was used already/)).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: /setup url/i })).toBeInTheDocument();
  },
};

/** Paired: disconnecting asks first, says what is lost, and leaves the form behind. */
export const Paired: Story = {
  parameters: { apolloClient: { resolvers: server(PAIRED) } },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Disconnect' }));
    // The dialog is portalled to the document body, outside the story's canvas.
    const dialog = within(canvasElement.ownerDocument.body).getByRole('alertdialog');
    await expect(dialog).toHaveTextContent(/client is deleted at the provider/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await expect(await canvas.findByRole('textbox', { name: /setup url/i })).toBeInTheDocument();
  },
};

/** Set by OIDC_ISSUER: shown so the admin knows, with the redirect URI, and nothing to press. */
export const FromEnvironment: Story = {
  parameters: { apolloClient: { resolvers: server(ENV) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Sign in with Corp SSO')).toBeInTheDocument();
    await expect(canvas.getByText(REDIRECT_URI)).toBeInTheDocument();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};
