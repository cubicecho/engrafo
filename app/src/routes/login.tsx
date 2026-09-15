import { useMutation } from '@apollo/client/react';
import { FileText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { CardLayout } from '@/components/card-layout';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getToken, setToken } from '@/lib/auth';

const RequestMagicLink = graphql(`
  mutation RequestMagicLink($email: String!) {
    requestMagicLink(email: $email) {
      ok
      magicLink
      token
    }
  }
`);

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ magicLink: string | null } | null>(null);
  const [requestLink, { loading, error }] = useMutation(RequestMagicLink);

  if (getToken()) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data } = await requestLink({ variables: { email } }).catch(() => ({ data: undefined }));
    if (!data) return;
    const result = data.requestMagicLink;
    // AUTH_MAGIC_LINK=false: the server signed us straight in.
    if (result.token) {
      setToken(result.token);
      navigate('/', { replace: true });
      return;
    }
    setSent({ magicLink: result.magicLink });
  }

  // The link is built from APP_URL, which in development points at the server
  // rather than at Vite. Follow it in this tab, on this origin, instead.
  const localLink = sent?.magicLink ? `/auth/verify${new URL(sent.magicLink).search}` : null;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <CardLayout
        className="w-full max-w-sm"
        icon={<FileText />}
        title="Sign in to Engrafo"
        description={sent ? `We sent a sign-in link to ${email}.` : 'We will email you a link to sign in.'}
        content={
          sent ? (
            localLink ? (
              <p className="text-sm">
                This instance exposes sign-in links.{' '}
                <Link className="font-medium underline" to={localLink}>
                  Sign in now
                </Link>
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">Open the link in that email to finish signing in.</p>
            )
          ) : (
            <form id="login" onSubmit={submit} className="flex flex-col gap-4">
              <FormField
                label="Email"
                required
                error={error?.message}
                control={
                  <Input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                }
              />
            </form>
          )
        }
        footerActions={
          sent ? (
            <Button variant="outline" onClick={() => setSent(null)}>
              Use a different email
            </Button>
          ) : (
            <Button type="submit" form="login" disabled={loading}>
              {loading ? 'Sending…' : 'Send sign-in link'}
            </Button>
          )
        }
      />
    </main>
  );
}
