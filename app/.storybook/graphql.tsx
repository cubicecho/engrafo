import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import type { MockLink } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { buildSchema, print } from 'graphql';
import { GraphQLHandler, type types as graphqlMocks } from 'graphql-mocks';
import { type ReactElement, type ReactNode, useMemo } from 'react';
import schemaSource from '@/__generated__/schema.graphql?raw';

// `graphql-mocks` publishes its types only through the namespace on the package root; there is
// no `graphql-mocks/types` entry in its exports map.
type ResolverMap = graphqlMocks.ResolverMap;

/**
 * Two ways to give a story a server, because stories ask two different questions.
 *
 * `mocks` is Apollo's own {@link MockedProvider}: a list of exact request/response pairs. Use
 * it when the *request* is the subject — that a mutation is sent with the right variables, that
 * a failure is rendered as a failure. It matches on the document and the variables, so a story
 * that gets either wrong shows nothing, which is the point.
 *
 * `resolvers` is a mock server built from the real SDL, by way of graphql-mocks. Use it when the
 * *page* is the subject and hand-writing the whole response is the boring part. It is also the
 * only one of the two that catches drift: the query really is executed against the schema
 * `server/` printed, so a story whose mock data no longer fits the schema fails rather than
 * quietly rendering the shape it was written against. That is the property worth having — the
 * schema is generated from Drizzle, so it moves whenever the database does.
 */
export interface ApolloParameters {
  mocks?: readonly MockLink.MockedResponse[];
  resolvers?: ResolverMap;
  /** Milliseconds before the mock server answers. Set it to keep a story in its loading state. */
  delay?: number;
}

// Built once. `buildSchema` on the full SDL is not cheap, and a browser-mode run renders every
// story in the file against it.
let cachedSchema: ReturnType<typeof buildSchema> | undefined;
function schema() {
  cachedSchema ??= buildSchema(schemaSource);
  return cachedSchema;
}

/** An Apollo link that executes against the mock server instead of crossing the network. */
function handlerLink(resolvers: ResolverMap, delay: number): ApolloLink {
  const handler = new GraphQLHandler({ resolverMap: resolvers, dependencies: { graphqlSchema: schema() } });

  return new ApolloLink(
    (operation) =>
      new Observable((observer) => {
        let cancelled = false;
        const timer = setTimeout(() => {
          handler
            .query(print(operation.query), operation.variables)
            .then((result) => {
              if (cancelled) return;
              observer.next(result);
              observer.complete();
            })
            .catch((error) => {
              if (!cancelled) observer.error(error);
            });
        }, delay);

        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }),
  );
}

/**
 * The decorator half of the Apollo parameter. Storybook's Apollo addon ships only a panel since
 * v10 — the provider is the app's to supply, which is what this is.
 */
export function withApollo(story: ReactElement, parameters: ApolloParameters | undefined): ReactElement {
  if (parameters?.resolvers) return <MockServer parameters={parameters}>{story}</MockServer>;
  return (
    // Unconditional, even with no mocks at all. Every screen in this app renders under an
    // ApolloProvider, so a story without one does not fail on the assertion it was written for
    // — it fails on `useMutation` at the top of the component, before anything has rendered.
    // An empty mock list is the right answer for a story that never asks the server anything.
    //
    // A fresh client per story either way: a story that passes off the previous story's cache
    // passes for reasons that have nothing to do with it.
    <MockedProvider mocks={parameters?.mocks ? [...parameters.mocks] : []}>{story}</MockedProvider>
  );
}

function MockServer({ parameters, children }: { parameters: ApolloParameters; children: ReactNode }) {
  const client = useMemo(
    () =>
      new ApolloClient({
        link: handlerLink(parameters.resolvers ?? {}, parameters.delay ?? 0),
        cache: new InMemoryCache(),
      }),
    [parameters.resolvers, parameters.delay],
  );

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
