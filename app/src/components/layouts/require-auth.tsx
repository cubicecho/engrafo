import { Navigate } from 'react-router';
import { getToken } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import type { SlotNode } from '@/lib/utils';
import { AppLayout } from './app-layout';

interface RequireAuthProps {
  /** The signed-in page, drawn inside the shell. */
  contentSlot: SlotNode;
}

/**
 * No token, no request: an expired one is caught by the session link instead.
 *
 * The shell goes on here rather than around each route, so "signed in" and "has
 * the sidebar" cannot drift apart — and /login and /auth/verify, which are the
 * two pages with nothing to navigate to, stay bare.
 */
export function RequireAuth({ contentSlot }: RequireAuthProps) {
  return getToken() ? <AppLayout contentSlot={contentSlot} /> : <Navigate to={ROUTES.login} replace />;
}
