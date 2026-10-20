import './core/preflight.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from '@cubicecho/engrafo-db';
import { waitForDatabase } from '@cubicecho/engrafo-db/wait';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAuthHost } from './auth/auth-host.ts';
import { createRateLimiter } from './auth/rate-limit.ts';
import {
  appUrl,
  databaseUrl,
  dbConnectTimeoutMs,
  magicLinkExposed,
  magicLinkRequired,
  modelsDir,
  ocrEnabled,
  ocrLanguages,
  oidcRedirectUri,
  pipelineConcurrency,
  port,
  s3Config,
  secureLocalNet,
} from './core/config.ts';
import { SEARCH_DEFAULTS } from './core/defaults.ts';
import { errorChainMessage, errorMessage } from './core/errors.ts';
import { createApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { createPipelineEvents } from './pipeline/events.ts';
import { detectPdfText } from './pipeline/pdf-text.ts';
import { createPipeline } from './pipeline/runner.ts';
import { STEPS } from './pipeline/step-list.ts';
import { detectOcr } from './pipeline/steps/ocr.ts';
import { createLocalEmbedder } from './search/embedder.ts';
import { createS3Storage } from './storage/s3.ts';

export type { Context } from './core/context.ts';

/** Postgres's port, shown when DATABASE_URL names none. */
const DEFAULT_POSTGRES_PORT = '5432';
/** Every interface. The container's port mapping decides who can reach it. */
const LISTEN_HOST = '0.0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = port();
const staticDir = join(__dirname, '../../app/dist');

try {
  await waitForDatabase(db, { connectTimeoutMs: dbConnectTimeoutMs() });
} catch (error) {
  const { hostname, port: urlPort } = new URL(databaseUrl());
  const dbPort = urlPort === '' ? DEFAULT_POSTGRES_PORT : urlPort;
  console.error(`[db] cannot reach Postgres at ${hostname}:${dbPort}: ${errorMessage(error)}`);
  console.error('[db] check DATABASE_URL in .env, and that the database is up and reachable from here.');
  console.error('[db] if your Docker daemon is remote (`docker context ls`), a container published on');
  console.error("[db] 127.0.0.1 is bound to the daemon host's loopback. Set DEV_BIND=0.0.0.0 and");
  console.error('[db] re-run `npm run db:up`.');
  process.exit(1);
}

// Migrations run at boot so `docker compose up` on a fresh volume is the whole
// install. They are idempotent; a container restart is a no-op.
try {
  await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });
} catch (error) {
  // The one migration an existing install can fail through no fault of its
  // own: the search index needs pgvector, which plain postgres images lack.
  // What Postgres said is the cause of drizzle's "Failed query" error.
  if (/extension "vector"|vector\.control/.test(errorChainMessage(error))) {
    console.error('[db] Postgres has no pgvector, which document search needs.');
    console.error('[db] In docker compose, change the postgres image to pgvector/pgvector:pg17 (same data, same');
    console.error('[db] volume). On a Postgres you run yourself, install pgvector and run');
    console.error('[db] `CREATE EXTENSION vector;` as a superuser.');
    process.exit(1);
  }
  throw error;
}

let ocrAvailable = false;
if (ocrEnabled()) {
  const version = await detectOcr();
  ocrAvailable = version !== null;
  if (!ocrAvailable) {
    console.warn('[ocr] OCR_ENABLED is on but ocrmypdf was not found on PATH. OCR is off until it is installed.');
  }
}

const pdfTextAvailable = await detectPdfText();
if (!pdfTextAvailable) {
  console.warn('[pipeline] pdftotext was not found on PATH. A PDF keeps no text unless OCR reads it.');
}

const storage = createS3Storage(s3Config());
const events = createPipelineEvents();
// One model for the process: the pipeline indexes with it and search embeds queries with it.
const embedder = createLocalEmbedder({ modelsDir: modelsDir(), batchSize: SEARCH_DEFAULTS.embedBatchSize });
const pipeline = createPipeline({
  db,
  storage,
  events,
  steps: STEPS,
  config: { ocrAvailable, pdfTextAvailable, ocrLanguages: ocrLanguages(), concurrency: pipelineConcurrency() },
  embedder,
});

// After migrate: the provider may be a pairing, which lives in the database.
const authHost = await createAuthHost(db);
const app = createApp({
  db,
  authHost,
  limiter: createRateLimiter(),
  storage,
  events,
  ocrAvailable,
  embedder,
  staticDir,
});

const server = app.listen(PORT, LISTEN_HOST, async () => {
  // APP_URL, not localhost: on a NAS the banner is the only place the operator
  // sees what the instance thinks its own address is, and a wrong one there is
  // the same wrong one that breaks their magic links.
  console.log(`[server] ready at ${appUrl()}`);
  console.log(`[server] GraphQL at ${appUrl()}/graphql`);
  console.log(`[ocr] ${ocrAvailable ? `on (${ocrLanguages()})` : 'off'}`);
  const oidc = authHost.oidc();
  if (oidc !== null) {
    // The redirect URI is the one thing the operator has to copy into the provider, exactly.
    console.log(`[auth] sign-in with ${oidc.name} (${oidc.issuer}); redirect URI ${oidcRedirectUri()}`);
  }
  if (!magicLinkRequired()) {
    // Name the variable that did it: on an instance with both set, "turn it
    // back on" is useless advice if it points at the wrong switch.
    const why = secureLocalNet() ? 'SECURE_LOCAL_NET is on' : 'AUTH_MAGIC_LINK is off';
    console.warn(`[auth] ${why}: any email address signs in without a link. Private networks only.`);
  } else if (magicLinkExposed()) {
    console.warn('[auth] EXPOSE_MAGIC_LINK is on: sign-in links are returned in API responses. Private networks only.');
  }

  // After listening, so a large backlog does not hold up the health check.
  const resumed = await pipeline.resume();
  if (resumed > 0) {
    console.log(`[pipeline] resuming ${resumed} unfinished document(s)`);
  }
  // Steps added since a document finished, such as the search index, reach it here.
  const caughtUp = await pipeline.catchUp();
  if (caughtUp > 0) {
    console.log(`[pipeline] running new steps on ${caughtUp} finished document(s)`);
  }
});
// The pipeline first: a run the exit cuts off is not a failure, and the next boot resumes it.
stopOnSignals(server, { before: pipeline.stop, after: closeDatabase });
