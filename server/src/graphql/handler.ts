import type { DB } from '@cubicecho/engrafo-db';
import { createYoga } from 'graphql-yoga';
import { extractUserId } from '../auth/resolvers.ts';
import type { Context } from '../core/context.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { createSchema } from './build-schema.ts';

export interface GraphQLOptions {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
  ocrAvailable: boolean;
}

export function createGraphQLHandler({ db, storage, events, ocrAvailable }: GraphQLOptions) {
  const { schema } = createSchema(db);
  return createYoga<Record<string, unknown>, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    context: ({ request }): Context => ({
      db,
      userId: extractUserId({ headers: { authorization: request.headers.get('authorization') ?? undefined } }),
      storage,
      events,
      ocrAvailable,
    }),
  });
}
