import type { DB } from '@cubicecho/engrafo-db';
import express, { type Express } from 'express';
import type { Auth } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { trustProxy } from '../core/config.ts';
import { createGraphQLHandler } from '../graphql/handler.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { createStaticHandler } from './static.ts';

/** Where the liveness probe answers. */
export const HEALTH_PATH = '/healthz';

/** Everything the app is built from. Nothing is reached for globally, so a test hands in its own. */
export interface AppDeps {
  db: DB;
  auth: Auth;
  limiter: RateLimiter;
  storage: StorageSet;
  events: PipelineEvents;
  /** Whether the ocr step can run here, as `detectOcr` found at boot. */
  ocrAvailable: boolean;
  /** The built web client. Left out, the app serves the API alone. */
  staticDir?: string;
}

/**
 * Builds the Express app without starting it.
 *
 * @param deps - The database, auth, storage and the rest of what requests are answered from.
 * @returns The app, which the caller listens on. Nothing is opened or scheduled here.
 */
export function createApp({ staticDir, ...graphqlDeps }: AppDeps): Express {
  const app = express();
  // Which proxy hops may set X-Forwarded-For. `req.ip` feeds the sign-in throttle.
  app.set('trust proxy', trustProxy());
  const graphql = createGraphQLHandler(graphqlDeps);

  // `all` rather than `use`: a mounted `use` strips the path from req.url, and
  // Yoga matches the request against `graphqlEndpoint` itself.
  app.all(graphql.graphqlEndpoint, (req, res) => graphql(req, res));
  app.get(HEALTH_PATH, (_req, res) => {
    res.json({ ok: true });
  });
  if (staticDir !== undefined) {
    const serveStatic = createStaticHandler(staticDir);
    app.use((req, res) => serveStatic(req, res));
  }
  return app;
}
