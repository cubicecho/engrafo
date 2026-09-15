import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorLink } from '@apollo/client/link/error';
import { clearToken, getToken } from './auth';

// Same origin in both modes: the server serves the built bundle in production,
// and Vite proxies /graphql to it in development.
const httpLink = new HttpLink({
  uri: '/graphql',
  fetch: (uri, options) => {
    const headers = new Headers(options?.headers);
    const token = getToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(uri, { ...options, headers });
  },
});

// A token that expired or was signed by a rotated secret fails every request
// the same way. Drop it and start over at sign-in rather than rendering a page
// of errors.
const errorLink = new ErrorLink(({ error }) => {
  if (!CombinedGraphQLErrors.is(error)) return;
  if (!error.errors.some((e) => e.extensions?.code === 'UNAUTHENTICATED')) return;
  clearToken();
  if (window.location.pathname !== '/login') window.location.assign('/login');
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});
