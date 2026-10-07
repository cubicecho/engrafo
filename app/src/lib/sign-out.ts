import { useMutation } from '@apollo/client/react';
import { useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { clearToken } from './auth';
import { ROUTES } from './routes';

const SignOut = graphql(`
  mutation SignOut {
    signOut
  }
`);

/**
 * Ends the session on the server, then forgets it here. Dropping the token
 * alone would leave a copy of it working until the session expired.
 *
 * @returns A function that signs out and goes to the sign-in page. It works
 *   even when the server cannot be reached.
 */
export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();
  const [signOut, { client }] = useMutation(SignOut);
  return async () => {
    // Unreachable server or a session already over: signing out here still has to work.
    await signOut().catch(() => undefined);
    clearToken();
    await client.clearStore();
    navigate(ROUTES.login, { replace: true });
  };
}
