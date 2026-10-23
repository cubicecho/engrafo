import { useMutation, useQuery } from '@apollo/client/react';
import { type ReactNode, useState } from 'react';
import { graphql } from '@/__generated__';
import { SsoSource } from '@/__generated__/graphql';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { SettingRow } from '@/components/setting-row';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { FormElement } from '@/components/ui/form-element';

// Pairing the instance with an OIDC provider (heautou, or any that supports
// Dynamic Client Registration) by pasting the setup URL it gives you. The login
// page's button is `authConfig.sso`, so both queries are asked again after a
// change: the answers have no id to update in place.

export const SsoSetupQuery = graphql(`
  query SsoSetup {
    ssoSetup {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

const PairSso = graphql(`
  mutation PairSso($setupUrl: String!) {
    pairSso(setupUrl: $setupUrl) {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

const UnpairSso = graphql(`
  mutation UnpairSso {
    unpairSso {
      source
      issuer
      name
      canPair
      redirectUri
    }
  }
`);

const REFETCH = { refetchQueries: ['SsoSetup', 'SignInOptions'], awaitRefetchQueries: true };

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
}

/**
 * The paste-and-connect form. The server decides who may pair; this only asks.
 *
 * @param onPaired - Called with the provider's name once it is paired.
 */
export function PairSsoForm({ onPaired }: { onPaired?: ((name: string) => void) | undefined }) {
  const [pairSso] = useMutation(PairSso, REFETCH);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { setupUrl: '' },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        const { data } = await pairSso({ variables: { setupUrl: value.setupUrl.trim() } });
        formApi.reset();
        onPaired?.(data?.pairSso.name ?? 'SSO');
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
  });

  return (
    <form.AppForm>
      <FormElement onSubmit={() => form.handleSubmit()} className="gap-4">
        {error ? <Alert variant="destructive" title="Could not pair" description={error} /> : null}
        <InputField
          form={form}
          name="setupUrl"
          label="Setup URL"
          type="url"
          placeholder="https://id.example.com/oidc#setup=…"
          description="Your provider's admin makes this for Engrafo. It works once, and only for a short while."
          autoComplete="off"
          required
          validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Paste the setup URL') }}
        />
        <form.SubmitButton content="Connect" pendingLabel="Connecting…" />
      </FormElement>
    </form.AppForm>
  );
}

/**
 * Settings' sign-in card: which provider the login page offers, and connecting
 * or disconnecting one. A provider set in the server's environment is shown but
 * cannot be changed here. The page shows this card to the admin only.
 */
export function SsoSettings() {
  const { data } = useQuery(SsoSetupQuery);
  const [unpairSso, { loading }] = useMutation(UnpairSso, REFETCH);
  const [error, setError] = useState<string | null>(null);
  const setup = data?.ssoSetup;
  if (!setup) {
    return null;
  }
  const name = setup.name ?? 'SSO';

  async function disconnect() {
    setError(null);
    try {
      await unpairSso();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  let body: ReactNode;
  if (setup.source === SsoSource.Env) {
    body = (
      <SettingRow
        title={`Sign in with ${name}`}
        description={
          <>
            Set by <Code>OIDC_ISSUER</Code> in the server's environment, so it is changed there. Its redirect URI is{' '}
            <Code>{setup.redirectUri}</Code>.
          </>
        }
      />
    );
  } else if (setup.source === SsoSource.Paired) {
    body = (
      <SettingRow
        title={`Sign in with ${name}`}
        description={setup.issuer ? `Paired with ${setup.issuer}.` : 'Paired.'}
        actionSlot={
          <ConfirmButton
            content="Disconnect"
            variant="destructive-outline"
            loading={loading}
            title={`Disconnect ${name}?`}
            description="Its button leaves the login page and Engrafo's client is deleted at the provider. Accounts stay, and can still sign in with an emailed link."
            confirmLabel="Disconnect"
            onConfirm={() => void disconnect()}
          />
        }
      />
    );
  } else {
    body = <PairSsoForm />;
  }

  return (
    <CardLayout
      level={2}
      title="Sign-in"
      description="People can always sign in with an emailed link. An OpenID Connect provider adds a button for it on the login page."
      contentClassName="gap-4"
      contentSlot={
        <>
          {body}
          {error ? <Alert variant="destructive" title="Could not disconnect" description={error} /> : null}
        </>
      }
    />
  );
}
