import { useMutation } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
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

  const failed = !token || error;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-4 text-sm">
      {failed ? (
        <>
          <p className="font-medium">This sign-in link is invalid or has expired.</p>
          <Link className="underline" to="/login">
            Request a new one
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground" role="status">
          Signing you in…
        </p>
      )}
    </main>
  );
}
