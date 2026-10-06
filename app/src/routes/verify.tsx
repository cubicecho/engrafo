import { useMutation } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { CenteredLayout } from '@/components/centered-layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { setToken } from '@/lib/auth';

const VerifyMagicLink = graphql(`
  mutation VerifyMagicLink($token: String!) {
    verifyMagicLink(token: $token) {
      token
      userId
    }
  }
`);

export function VerifyPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [verify, { error }] = useMutation(VerifyMagicLink);
  // StrictMode mounts effects twice in development; verify once.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify({ variables: { token } })
      .then(({ data }) => {
        if (!data) return;
        setToken(data.verifyMagicLink.token);
        navigate('/', { replace: true });
      })
      .catch(() => {});
  }, [token, verify, navigate]);

  if (!token || error) {
    return (
      <CenteredLayout
        level={1}
        title="This sign-in link is invalid or has expired"
        description="Links work once, and only for a short while."
        footerActionsSlot={<Button content="Request a new one" linkSlot={<Link to="/login" />} />}
      />
    );
  }

  return <CenteredLayout level={1} title="Signing you in…" contentSlot={<Spinner label="Signing you in" />} />;
}
