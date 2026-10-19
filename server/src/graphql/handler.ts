import type { DB } from '@cubicecho/engrafo-db';
import type { Request } from 'express';
import { createYoga, type YogaServerInstance } from 'graphql-yoga';
import type { AuthHost } from '../auth/auth-host.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { appUrl, isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { publicOrigin } from '../http/origin.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { createSchema } from './build-schema.ts';

/** What Express hands Yoga alongside the fetch Request. */
interface ServerContext {
  /** The Express request. Absent when a test calls `yoga.fetch`. */
  req?: Request;
}

/** What the GraphQL handler is built from, and hands every resolver on the context. */
export interface GraphQLOptions {
  db: DB;
  /** Hands out the current auth instance, which resolves the session and is passed on to resolvers. */
  authHost: AuthHost;
  limiter: RateLimiter;
  storage: StorageSet;
  events: PipelineEvents;
  ocrAvailable: boolean;
}

/**
 * Builds the Yoga handler for `/graphql`, which resolves the session into each request's context.
 *
 * @param options - The database, auth and the rest of what resolvers are handed.
 * @returns The Yoga instance, which Express calls as a request handler.
 */
export function createGraphQLHandler({
  db,
  authHost,
  limiter,
  storage,
  events,
  ocrAvailable,
}: GraphQLOptions): YogaServerInstance<ServerContext, Context> {
  const { schema } = createSchema(db);
  return createYoga<ServerContext, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    // Yoga answers CORS for every origin unless told not to. The client is served
    // from this origin, and in development Vite proxies /graphql to it.
    cors: false,
    context: async ({ request, req }): Promise<Context> => {
      // Asked per request: pairing a provider swaps the instance while the server runs.
      const auth = authHost.current();
      const session = await auth.api.getSession({ headers: request.headers });
      return {
        db,
        auth,
        authHost,
        limiter,
        // Express's view of the client address, which honors `trust proxy`.
        ip: req?.ip ?? UNKNOWN_IP,
        userId: session?.user.id ?? null,
        origin: req === undefined ? appUrl() : publicOrigin(req),
        headers: request.headers,
        storage,
        events,
        ocrAvailable,
      };
    },
  });
}
