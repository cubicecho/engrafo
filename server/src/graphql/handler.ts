import type { DB } from '@cubicecho/engrafo-db';
import type { Request } from 'express';
import { createYoga } from 'graphql-yoga';
import type { Auth } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { createSchema } from './build-schema.ts';

/** What Express hands Yoga alongside the fetch Request. */
interface ServerContext {
  /** The Express request. Absent when a test calls `yoga.fetch`. */
  req?: Request;
}

export interface GraphQLOptions {
  db: DB;
  /** Resolves the session, and is passed on to resolvers. */
  auth: Auth;
  limiter: RateLimiter;
  storage: StorageSet;
  events: PipelineEvents;
  ocrAvailable: boolean;
}

export function createGraphQLHandler({ db, auth, limiter, storage, events, ocrAvailable }: GraphQLOptions) {
  const { schema } = createSchema(db);
  return createYoga<ServerContext, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    context: async ({ request, req }): Promise<Context> => {
      const session = await auth.api.getSession({ headers: request.headers });
      return {
        db,
        auth,
        limiter,
        // Express's view of the client address, which honors `trust proxy`.
        ip: req?.ip ?? UNKNOWN_IP,
        userId: session?.user.id ?? null,
        headers: request.headers,
        storage,
        events,
        ocrAvailable,
      };
    },
  });
}
