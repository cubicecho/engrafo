import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { SsoSource } from '@/__generated__/graphql';
import { InputField, useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PairSsoForm, SsoSetupQuery } from '@/components/domain/sso-pairing';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { FileText } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemePicker } from '@/components/ui/theme-picker';
import { getToken, setToken } from '@/lib/auth';
import { magicLinkSearch } from '@/lib/magic-link';
import { ROUTES } from '@/lib/routes';

const RequestSignIn = graphql(`
  mutation RequestSignIn($email: String!) {
    requestSignIn(email: $email) {
      sent
      magicLink
      session {
        token
      }
    }
  }
`);

/** What `?error=sso_off` means: the provider's button was followed after it was disconnected. */
const SSO_OFF = 'sso_off';

type Tab = 'sign-in' | 'set-up';

const SignInOptions = graphql(`
  query SignInOptions {
    authConfig {
      sso {
        name
        signInPath
      }
    }
  }
`);

/**
 * Sign-in by email: ask for an address, then say a link is on its way.
 *
 * On a trusted network the server answers with a session instead of a link, and
 * the page goes straight to the archive. Where the instance has an OIDC provider,
 * a button for it comes first; a sign-in there that failed comes back here with
 * `?error=`.
 *
 * A new instance, with no accounts and no provider, also offers to pair one
 * here, so whoever installs it can set sign-in up before there is an admin to
 * ask. After that, pairing is the admin's, in Settings.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [sent, setSent] = useState<{ email: string; magicLink: string | null } | null>(null);
  const [requestLink, { error }] = useMutation(RequestSignIn);
  const sso = useQuery(SignInOptions).data?.authConfig.sso ?? null;
  const [params] = useSearchParams();
  const ssoError = params.get('error');
  const setup = useQuery(SsoSetupQuery).data?.ssoSetup;
  const offerSetup = setup?.canPair === true && setup.source === SsoSource.None;
  const [tab, setTab] = useState<Tab>('sign-in');
  const [paired, setPaired] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const { data } = await requestLink({ variables: { email: value.email } }).catch(() => ({ data: undefined }));
      if (!data) {
        return;
      }
      const result = data.requestSignIn;
      // SECURE_LOCAL_NET=true: the server signed us straight in.
      if (result.session) {
        setToken(result.session.token);
        navigate(ROUTES.documents, { replace: true });
        return;
      }
      setSent({ email: value.email, magicLink: result.magicLink });
    },
  });

  if (getToken()) {
    return <Navigate to={ROUTES.documents} replace />;
  }

  // The link is built from APP_URL, which in development points at the server
  // rather than at Vite. Follow it in this tab, on this origin, instead.
  const linkSearch = sent?.magicLink ? magicLinkSearch(sent.magicLink, window.location.origin) : null;
  const localLink = linkSearch === null ? null : `${ROUTES.verify}${linkSearch}`;

  if (sent) {
    return (
      <CenteredLayout
        level={1}
        iconSlot={<FileText />}
        title="Sign in to Engrafo"
        description={`We sent a sign-in link to ${sent.email}.`}
        contentSlot={
          <p className="text-foreground/60 text-sm">
            {localLink
              ? 'This instance exposes sign-in links, so you can skip the email.'
              : 'Open the link in that email to finish signing in.'}
          </p>
        }
        footerSlot={<ThemePicker variant="compact" />}
        footerActionsSlot={
          <>
            <Button variant="outline" content="Use a different email" onClick={() => setSent(null)} />
            {localLink ? <Button content="Sign in now" linkSlot={<Link to={localLink} />} /> : null}
          </>
        }
      />
    );
  }

  const signIn = (
    <form.AppForm>
      <FormElement onSubmit={() => form.handleSubmit()} className="gap-4">
        {paired ? (
          <Alert
            variant="info"
            title={`Paired with ${paired}`}
            description="Sign in with it below; the first account to sign in runs this instance."
          />
        ) : null}
        {ssoError === SSO_OFF ? (
          <Alert
            variant="warning"
            title="That sign-in button is gone"
            description="This instance no longer signs in through a provider. Use an emailed link instead."
          />
        ) : ssoError ? (
          <Alert
            variant="destructive"
            title={sso ? `Signing in with ${sso.name} didn't work` : "Signing in didn't work"}
            description={`The provider answered ${ssoError}. Try again, or ask whoever runs this instance.`}
          />
        ) : null}
        {sso ? (
          <>
            {/* A plain link, not the router's: the server sends the browser on to the provider. */}
            <Button content={`Sign in with ${sso.name}`} linkSlot={<a href={sso.signInPath} />} />
            <p className="text-center text-foreground/60 text-sm">or get a sign-in link by email</p>
          </>
        ) : null}
        {error ? (
          <Alert variant="destructive" title="Could not send the sign-in link" description={error.message} />
        ) : null}
        <InputField
          form={form}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Enter your email address') }}
        />
        <form.SubmitButton content="Send sign-in link" pendingLabel="Sending…" />
      </FormElement>
    </form.AppForm>
  );

  return (
    <CenteredLayout
      level={1}
      iconSlot={<FileText />}
      title="Sign in to Engrafo"
      description="We will email you a link to sign in."
      contentSlot={
        offerSetup ? (
          <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex flex-col gap-4">
            <TabsList aria-label="Sign in or set up" className="self-center">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="set-up">Set up sign-in</TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">{signIn}</TabsContent>
            <TabsContent value="set-up" className="flex flex-col gap-4">
              <p className="text-foreground/60 text-sm">
                Pair Engrafo with an OpenID Connect provider, such as heautou, and its button joins the emailed link
                here. Paste the setup URL its admin made for Engrafo.
              </p>
              <PairSsoForm
                onPaired={(name) => {
                  setPaired(name);
                  setTab('sign-in');
                }}
              />
            </TabsContent>
          </Tabs>
        ) : (
          signIn
        )
      }
      footerSlot={<ThemePicker variant="compact" />}
    />
  );
}
