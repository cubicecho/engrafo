import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorLink } from '@apollo/client/link/error';
import { clearToken, getToken } from './auth';
import { ROUTES } from './routes';

// Same origin in both modes: the server serves the built bundle in production,
// and Vite proxies /graphql to it in development.
const httpLink = new HttpLink({
  uri: '/graphql',
  fetch: (uri, options) => {
    const headers = new Headers(options?.headers);
    const token = getToken();
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return fetch(uri, { ...options, headers });
  },
});

/**
 * Drops the token when the server says the session is over, then hands the redirect to the
 * caller. A session that expired, was signed out elsewhere or was lost to a server restart
 * fails every request the same way, so starting over at sign-in beats a page of errors.
 *
 * @param onSessionOver - Where to go once the token is gone. The app reloads into sign-in;
 *   a story records the call instead, since a reload would take the story with it.
 * @returns The link, to put in front of whatever sends the request.
 */
export function sessionOverLink(onSessionOver: () => void): ApolloLink {
  return new ErrorLink(({ error }) => {
    const isSessionOver =
      CombinedGraphQLErrors.is(error) && error.errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED');
    const isOtherFailure = isSessionOver === false;
    if (isOtherFailure) {
      return;
    }
    clearToken();
    onSessionOver();
  });
}

const errorLink = sessionOverLink(() => {
  if (window.location.pathname !== ROUTES.login) {
    window.location.assign(ROUTES.login);
  }
});

/**
 * The one Apollo client the app runs on. It sends the session token with every
 * request and goes back to sign-in when the server says the session is over.
 */
export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});
