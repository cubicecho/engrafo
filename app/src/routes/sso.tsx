import { useMutation } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { CenteredLayout } from '@/components/centered-layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { setToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';

const VerifyOneTimeToken = graphql(`
  mutation VerifyOneTimeToken($token: String!) {
    verifyOneTimeToken(token: $token) {
      token
    }
  }
`);

/**
 * Where an OIDC sign-in lands. The server's callback opened a session and put a one-time token
 * for it on this URL; this trades the token for the session, once.
 */
export function SsoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [verify, { error }] = useMutation(VerifyOneTimeToken);
  // The token is spent on first use, and StrictMode mounts effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) {
      return;
    }
    started.current = true;
    verify({ variables: { token } })
      .then(({ data }) => {
        if (!data) {
          return;
        }
        setToken(data.verifyOneTimeToken.token);
        navigate(ROUTES.documents, { replace: true });
      })
      .catch(() => {});
  }, [token, verify, navigate]);

  if (!token || error) {
    return (
      <CenteredLayout
        level={1}
        title="That sign-in didn't work"
        description="It has to be finished within a few minutes, and only once."
        footerActionsSlot={<Button content="Try again" linkSlot={<Link to={ROUTES.login} />} />}
      />
    );
  }

  return <CenteredLayout level={1} title="Signing you in…" contentSlot={<Spinner label="Signing you in" />} />;
}
