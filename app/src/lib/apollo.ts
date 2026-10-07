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

// A session that expired, was signed out elsewhere or was lost to a server
// restart fails every request the same way. Drop it and start over at sign-in rather than rendering a page
// of errors.
const errorLink = new ErrorLink(({ error }) => {
  const isSessionOver =
    CombinedGraphQLErrors.is(error) && error.errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED');
  const isOtherFailure = isSessionOver === false;
  if (isOtherFailure) {
    return;
  }
  clearToken();
  if (window.location.pathname !== ROUTES.login) {
    window.location.assign(ROUTES.login);
  }
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});
