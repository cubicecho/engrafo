import type { DB } from '@cubicecho/engrafo-db';
import { createYoga } from 'graphql-yoga';
import { createSchema } from './build-schema.ts';
import type { Context } from './context.ts';
import type { PipelineEvents } from './pipeline/events.ts';
import { extractUserId } from './resolvers/auth.ts';
import type { StorageSet } from './storage/s3.ts';

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
