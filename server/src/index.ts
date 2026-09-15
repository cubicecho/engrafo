import './preflight.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@cubicecho/engrafo-db';
import cors from 'cors';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import express from 'express';
import {
  appUrl,
  magicLinkExposed,
  magicLinkRequired,
  ocrEnabled,
  ocrLanguages,
  pipelineConcurrency,
  port,
  s3Config,
  secureLocalNet,
} from './config.ts';
import { createGraphQLHandler } from './graphql.ts';
import { createPipeline, createPipelineEvents, STEPS } from './pipeline/index.ts';
import { detectOcr } from './pipeline/steps/ocr.ts';
import { createStaticHandler } from './static.ts';
import { createS3Storage } from './storage/s3.ts';

export type { Context } from './context.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = port();
const staticDir = join(__dirname, '../../app/dist');

// Migrations run at boot so `docker compose up` on a fresh volume is the whole
// install. They are idempotent; a container restart is a no-op.
try {
  await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });
} catch (error) {
  const cause = (error as { cause?: NodeJS.ErrnoException })?.cause;
  if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ENOTFOUND' || cause.code === 'ETIMEDOUT')) {
    const { hostname, port } = new URL(process.env.DATABASE_URL ?? '');
    console.error(`✖ Cannot reach Postgres at ${hostname}:${port || 5432} (${cause.code}).`);
    console.error('  Check DATABASE_URL in .env, and that the database is up and reachable from here.');
    console.error('  If your Docker daemon is remote (`docker context ls`), a container published on');
    console.error("  127.0.0.1 is bound to the daemon host's loopback. Set DEV_BIND=0.0.0.0 and");
    console.error('  re-run `npm run db:up`.');
    process.exit(1);
  }
  throw error;
}

let ocrAvailable = false;
if (ocrEnabled()) {
  const version = await detectOcr();
  ocrAvailable = version !== null;
  if (!ocrAvailable) {
    console.warn('⚠️  OCR_ENABLED is on but ocrmypdf was not found on PATH. OCR is off until it is installed.');
  }
}

const storage = createS3Storage(s3Config());
const events = createPipelineEvents();
const pipeline = createPipeline({
  db,
  storage,
  events,
  steps: STEPS,
  config: { ocrAvailable, ocrLanguages: ocrLanguages(), concurrency: pipelineConcurrency() },
});

const app = express();
const graphql = createGraphQLHandler({ db, storage, events, ocrAvailable });
const serveStatic = createStaticHandler(staticDir);

app.use(cors());
// `all` rather than `use`: a mounted `use` strips the path from req.url, and
// Yoga matches the request against `graphqlEndpoint` itself.
app.all(graphql.graphqlEndpoint, (req, res) => graphql(req, res));
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});
app.use((req, res) => serveStatic(req, res));

app.listen(PORT, '0.0.0.0', async () => {
  // APP_URL, not localhost: on a NAS the banner is the only place the operator
  // sees what the instance thinks its own address is, and a wrong one there is
  // the same wrong one that breaks their magic links.
  console.log(`🚀 Engrafo ready at ${appUrl()}`);
  console.log(`   GraphQL at ${appUrl()}/graphql`);
  console.log(`   OCR ${ocrAvailable ? `on (${ocrLanguages()})` : 'off'}`);
  if (!magicLinkRequired()) {
    // Name the variable that did it: on an instance with both set, "turn it
    // back on" is useless advice if it points at the wrong switch.
    const why = secureLocalNet() ? 'SECURE_LOCAL_NET is on' : 'AUTH_MAGIC_LINK is off';
    console.warn(`⚠️  ${why}: any email address signs in without a link. Private networks only.`);
  } else if (magicLinkExposed()) {
    console.warn('⚠️  EXPOSE_MAGIC_LINK is on: sign-in links are returned in API responses. Private networks only.');
  }

  // After listening, so a large backlog does not hold up the health check.
  const resumed = await pipeline.resume();
  if (resumed > 0) console.log(`   Resuming ${resumed} unfinished document(s)`);
});
