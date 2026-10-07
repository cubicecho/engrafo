import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { InputField, useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { FileText } from '@/components/ui/icons';
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

/**
 * Sign-in by email: ask for an address, then say a link is on its way.
 *
 * On a trusted network the server answers with a session instead of a link, and
 * the page goes straight to the archive.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [sent, setSent] = useState<{ email: string; magicLink: string | null } | null>(null);
  const [requestLink, { error }] = useMutation(RequestSignIn);

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

  return (
    <CenteredLayout
      level={1}
      iconSlot={<FileText />}
      title="Sign in to Engrafo"
      description="We will email you a link to sign in."
      contentSlot={
        <form.AppForm>
          <FormElement onSubmit={() => form.handleSubmit()} className="gap-4">
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
      }
      footerSlot={<ThemePicker variant="compact" />}
    />
  );
}
