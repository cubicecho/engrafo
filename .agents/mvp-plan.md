# engrafo — minimal Paperless-ngx clone (MVP plan)

## Context
`apps/engrafo` is empty. Goal: a small self-hosted document archive in TypeScript that follows the cubicecho house pattern (telos is the reference: `apps/telos`, plan template `apps/telos/.agents/mvp-plan.md`).

MVP path: user uploads a document → it's stored in S3-compatible storage (MinIO) → a processing pipeline runs → the first step, which is optional, is OCR → metadata and extracted text live in Postgres.

Out of scope: embeddings, vector or full-text search, tags, correspondents, document types, mail ingestion, consume folders, native app.

Decisions already made:
- **Frontend:** Vite + React + Tailwind v4 + cubeui.
- **Pipeline trigger:** no queue for now. An in-process server event starts the steps.
- **Uploads:** presigned PUT URLs.
- **GraphQL server:** graphql-yoga.
- **GraphQL client:** Apollo Client 4.
- **Package names:** `@cubicecho/engrafo-*`.
- **OCR:** do what Paperless does. Shell out from TS to **ocrmypdf** (Tesseract + Ghostscript), installed in the server image. All code is TS; the binaries are only runtime deps in the Docker image.

## Stack (house conventions)
| Concern | Choice | Copy from |
|---|---|---|
| Repo | Own git repo. npm workspaces `app/`, `server/`, `db/`. Packages `@cubicecho/engrafo-app`, `@cubicecho/engrafo-server`, `@cubicecho/engrafo-db`. Node 24, ESM | telos `package.json` |
| Server | Express 5 with **graphql-yoga 5** mounted at `/graphql` (`createYoga({schema, context: ({request}) => contextFor(request.headers)})`). Runs `node --experimental-strip-types` with no build step and `.ts` imports. Yoga's GraphiQL is on in dev only | Yoga: `eunomia/apps/server/src/app.ts`. Boot and config: `telos/server/src/index.ts`, `preflight.ts`, `config.ts` |
| Schema | `@vantreeseba/drizzle-graphql` `buildSchema` with a `scope` on `userId`, generated mutations off for documents, plus SDL extensions for custom mutations | `telos/server/src/build-schema.ts`, `tenancy.ts` |
| DB | Postgres 17 + Drizzle 1.0 rc + drizzle-kit. Migrations in `db/drizzle/`, applied at boot | `telos/db/src/*` |
| Auth | Magic link + JWT (`AUTH_MAGIC_LINK`, `EXPOSE_MAGIC_LINK`), in-process rate limiter | `telos/server/src/resolvers/auth.ts` |
| Storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | new |
| Pipeline trigger | Node `EventEmitter` inside the server process (no queue lib) | new |
| Web | Vite + React 19 + TW4 + cubeui (`npx shadcn add @cubeui/...`), **Apollo Client 4** (latest: hooks from `@apollo/client/react`, `ErrorLink` / `SetContextLink` classes), graphql-codegen client preset | `eunomia/apps/web` for Vite + cubeui. Apollo v4 setup: `auto-cal/client/src/apollo-client.ts`, `notes/app/src/apollo-client.ts` |
| Tooling | Biome 2, Vitest projects (node on PGlite, dom on jsdom), GH Actions ci/release, semantic-release, Conventional Commits, **no Co-Authored-By trailers** | telos |

## Layout
```
engrafo/
  AGENTS.md  CLAUDE.md("Use AGENTS.md instead.")  README.md  .env.example
  .agents/mvp-plan.md             # copy of this plan
  biome.json  tsconfig.json  vitest.config.ts  package.json
  Dockerfile  docker-compose.yml  docker-compose.dev.yml
  .github/workflows/{ci,release}.yml  .releaserc.json
  db/src/{index,migrate,ssl,schema,relations}.ts
  db/src/models/{users,magic-links,documents,processing-steps}.ts
  server/src/
    index.ts preflight.ts config.ts context.ts build-schema.ts tenancy.ts write_schema.ts
    storage/s3.ts                 # client, presignPut/presignGet, head, getStream, put
    pipeline/
      events.ts                   # typed EventEmitter: 'document.uploaded'
      runner.ts                   # listens for the event and runs STEPS in order for one doc
      index.ts                    # ordered STEPS list + registerPipeline(db, storage)
      types.ts                    # PipelineStep interface
      steps/inspect.ts            # verify object, sha256, sniff mime (file-type)
      steps/ocr.ts                # ocrmypdf → archive PDF + text
      steps/finalize.ts           # status=ready
    resolvers/{auth,documents}.ts
    __tests__/
  app/                            # Vite SPA, built to app/dist, served by server
    src/{main.tsx, routes/, components/{ui,domain}, lib/{apollo,upload}.ts}
```

## Data model (`db/src/models`)
Conventions: uuid `defaultRandom` PKs, snake_case columns, `withTimezone`, `$onUpdate`, an `idx_<table>_<col>` index on every FK, and `userId` plus a `scope` entry on every table (the tenancy test enforces this).

- `users`, `magic_links`: lifted from telos.
- `documents`
  - Identity and ownership: `id`, `userId`.
  - File info: `title`, `originalFilename`, `mimeType`, `sizeBytes`, `checksumSha256` (nullable until inspected).
  - Storage keys: `originalKey` (`originals/<userId>/<id>`), `archiveKey` (nullable; the OCR'd PDF).
  - Text: `content` (text, nullable; OCR output).
  - Status: `ocrRequested` (bool), `status` enum `pending_upload | uploaded | processing | ready | failed`, `error` (text, nullable).
  - Timestamps: `createdAt`, `updatedAt`.
  - Indexes on `(user_id, created_at)` and `(user_id, checksum_sha256)` to warn about duplicates later.
- `processing_steps`
  - Columns: `id`, `userId`, `documentId` (FK, cascade), `step` (text), `status` enum `queued | running | succeeded | skipped | failed`, `attempts`, `error`, `startedAt`, `finishedAt`, `createdAt`.
  - Unique `(document_id, step)`.
  - Purpose: the UI shows pipeline progress, and a failed step can be retried.

`processing_steps` is the only pipeline state. That is enough to show progress, retry, and resume after a restart.

## Upload flow (presigned PUT)
1. The client calls `createDocumentUpload(input: {filename, mimeType, sizeBytes, ocr: Boolean})`.
   - Validate with zod: size ≤ `MAX_UPLOAD_BYTES`, mime in an allowlist (pdf, png, jpeg, tiff, webp, txt).
   - Insert a `documents` row with `status=pending_upload`.
   - Return `{document, uploadUrl, headers}` with a presigned PUT that expires in about 15 minutes and is signed with `ContentType` and `ContentLength`.
2. The browser `PUT`s the file straight to MinIO (`app/src/lib/upload.ts` uses XHR so it can show progress).
3. The client calls `completeDocumentUpload(id)`.
   - The server `HeadObject`s the key and checks that size and content type match.
   - It sets `status=uploaded`, inserts `queued` rows in `processing_steps` for every step, and emits `document.uploaded` with `{documentId}`. It returns without waiting for the steps to run.
   - The mutation is idempotent: it's a no-op if the document is already past `pending_upload`.
4. Other mutations and queries:
   - `documentFileUrl(id, variant: ORIGINAL|ARCHIVE)` returns a presigned GET for preview and download.
   - `deleteDocument(id)` deletes the S3 objects and the row.
   - `retryDocumentProcessing(id)` resets failed steps to `queued` and emits the event again.
   - Queries `documents` / `document` and relation `processingSteps` come from drizzle-graphql and are scoped to the user.

**Gotcha: two S3 endpoints.** The server talks to `S3_ENDPOINT` (e.g. `http://minio:9000` inside compose). Presigned URLs must be signed against `S3_PUBLIC_ENDPOINT` (e.g. `http://localhost:9000`) with `forcePathStyle: true`. Use a second S3Client for presigning. The bucket needs CORS allowing PUT and GET from `APP_ORIGIN`; a compose `minio-init` (`mc`) container creates the bucket and sets CORS.

Later, not MVP: clean up stale `pending_upload` rows.

## Pipeline (in-process event, no queue)
- **Trigger:** `pipeline/events.ts` exports a typed `EventEmitter`. `registerPipeline()` is called once from `index.ts` and subscribes the runner to `document.uploaded`. The mutation emits the event and returns; the listener runs `runPipeline(documentId).catch(log)` without awaiting it, matching auto-cal's fire-and-forget style.
- **Steps:** `pipeline/index.ts` holds an ordered `STEPS: PipelineStep[]` = `[inspect, ocr, finalize]`.
  - `PipelineStep = { name; enabled(doc, config): boolean; run(ctx: {doc, db, storage, tmpDir}): Promise<Partial<Document> | void> }`.
- **`runPipeline(documentId)`:**
  1. A module-level `Set` of running IDs guards against the same document running twice.
  2. Sets `documents.status=processing`.
  3. For each step whose `processing_steps` row isn't `succeeded` or `skipped`, in order:
     - If `enabled()` is false, mark it `skipped`.
     - Otherwise mark it `running`, run it, patch the document with the result, and mark it `succeeded`.
     - On throw, mark the step and the document `failed` with the error and stop. There are no automatic retries; the user presses retry.
  4. Cleans up the tmp dir in a `finally`.
  5. Sets the document to `ready`.
- **Concurrency:** a tiny in-memory limiter (`OCR_CONCURRENCY`, default 1) wraps the whole run, so bulk uploads don't fork 20 ocrmypdf processes at once.
- **Restart recovery:** at boot, after migrations, find documents in `uploaded` or `processing` and emit `document.uploaded` for each. Completed steps are skipped, so work isn't lost on a restart.
- **Future queue:** swapping in pg-boss or similar later only changes `events.ts` and the boot call. The step contract stays the same.
- **Steps:**
  - `inspect`: stream the object → sha256 and sniff the mime from magic bytes with `file-type`. If the sniffed type disagrees with the declared one, trust the sniffed type.
  - `ocr` runs when `doc.ocrRequested && config.ocrEnabled` and the mime is a pdf or image; otherwise it's skipped.
    1. Download the original to tmp.
    2. `execFile('ocrmypdf', ['--skip-text', '--rotate-pages', '--deskew', '--output-type', 'pdfa', '--sidecar', 'out.txt', '-l', OCR_LANGUAGES, in, out.pdf])`, with `--image-dpi 300` for images. These are Paperless's defaults: skip pages that already have text, and produce a PDF/A archive.
    3. Upload `archive/<userId>/<id>.pdf` and set `archiveKey` and `content`.
    4. `text/plain` skips OCR, and `content` is read directly.
  - `finalize`: `status=ready`.
- **Adding a step later:** one new file plus one entry in `STEPS`.

## Config (`.env.example`, checked by `preflight.ts`)
- **Required:** `DATABASE_URL`, `JWT_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Optional:** `S3_PUBLIC_ENDPOINT`, `S3_REGION=us-east-1`, `APP_ORIGIN`, `PORT=3004`, `MAX_UPLOAD_BYTES=104857600`, `OCR_ENABLED=true`, `OCR_DEFAULT=true`, `OCR_LANGUAGES=eng`, `OCR_CONCURRENCY=1`, `AUTH_MAGIC_LINK`, `EXPOSE_MAGIC_LINK`.
- **Preflight checks:** exit with a `FATAL:` sentence if required vars are missing. Log a warning and treat OCR as disabled if `OCR_ENABLED` is set but `ocrmypdf --version` fails.

## Web app (`app/`)
- Routes: `/login`, `/auth/verify`, `/` (document list), `/documents/:id`.
- **List:** a table with title, type, size, status badge and created date, plus an upload dropzone that takes multiple files. Each file gets a progress bar and an "OCR" toggle, defaulting to `OCR_DEFAULT` from a `serverConfig` query. Apollo `pollInterval` (3s) runs only while some document is `uploaded` or `processing`.
- **Detail:** metadata, a pipeline steps timeline with a retry button, the OCR text in a `<pre>`, a preview (`<iframe>` of the archive PDF if present, else the original), download and delete.
- cubeui components: button, card, table, badge, progress, dialog, input, switch.

## Docker / compose
- **Dockerfile:** one container runs the server and the pipeline. Multi-stage `node:24-alpine`. The runtime stage runs `apk add ocrmypdf tesseract-ocr tesseract-ocr-data-eng ghostscript` (verify the Alpine package names during implementation; fall back to `node:24-bookworm-slim` + apt if the Alpine ocrmypdf package is broken). It installs the server + db workspaces, copies `app/dist`, and has a `HEALTHCHECK` on `/healthz`.
- **`docker-compose.dev.yml`:** postgres on `127.0.0.1:5436`, minio on `9000`/`9001`, `minio-init` (bucket + CORS). The dev server runs on the host.
  - On-host OCR in dev needs local `ocrmypdf`, or run `OCR_ENABLED=false`. The README documents both.
- **`docker-compose.yml`:** engrafo + postgres + minio + minio-init, with named volumes and `${JWT_SECRET:?}`.

## Build order
1. Scaffold the repo:
   - Configs copied and adapted from telos: package.json, tsconfig, biome, vitest, AGENTS.md, CI.
   - Compose dev stack.
   - `db` workspace with the models and the first migration.
2. Server skeleton: preflight/config, Express + Yoga + drizzle-graphql schema, auth adapted from telos to Yoga's context, `/healthz`, codegen.
3. `storage/s3.ts` + the upload mutations (create/complete/fileUrl/delete) + tests (mock S3 client).
4. Event + runner + `inspect`/`finalize` steps + tests. The runner tests use fake steps and cover status transitions, skip, failure then retry, the double-run guard, and boot resume.
5. The `ocr` step + Dockerfile system deps + an integration test gated on `ocrmypdf` being present.
6. Vite web app: auth, list/upload, detail.
7. Production compose, README quickstart, release workflow.

## Verification
- `npm run check` (codegen + `biome check` + `tsc` on every workspace) and `npm test`. The node vitest project runs on PGlite; the tenancy test confirms every table is scoped and user A can't read user B's document (`NOT_FOUND`).
- Manual end-to-end:
  1. `npm run db:up` (postgres + minio), then `npm run dev`.
  2. Log in with the exposed magic link.
  3. Upload a scanned image-only PDF with OCR on. Watch the status go `uploaded → processing → ready` and the steps go inspect ✓ ocr ✓ finalize ✓.
  4. The detail page shows extracted text, and the archive PDF preview has selectable text. Check the MinIO console at :9001 for `originals/…` and `archive/…`.
- Upload with OCR off: the ocr step is `skipped`, `content` is null, and the status is `ready`.
- Failure path: temporarily break `OCR_LANGUAGES`. The step ends `failed` with the error shown. Fix the setting, press retry, and it reaches `ready`.
- Restart: kill the server mid-OCR and start it again. The document resumes and reaches `ready`.
- Production image: `docker compose up --build`, then repeat the upload smoke test against the containerized stack. This validates `S3_PUBLIC_ENDPOINT` presigning and the ocrmypdf install.

## Deviations during implementation
- **No `finalize` step.** The runner sets `status=ready` itself once every step has succeeded or been skipped.
- **Added a `text` step** for `text/plain`: it reads the object straight into `content`. OCR never sees plain text.
- **No `magic_links` table.** As in telos, the magic token is itself a short-lived JWT.
- **webp dropped** from accepted types; ocrmypdf's image input (img2pdf) does not take it.
- **No generated writes on any table.** drizzle-graphql then omits `Mutation`, so `build-schema.ts` adds an empty root before the SDL extensions fill it.
- **Runner is an object**, `createPipeline({db, storage, events, steps, config})` → `{run, resume, idle}`, not a module-level `Set`, so tests build their own.
- **Alpine is fine for OCR.** `apk add ocrmypdf tesseract-ocr tesseract-ocr-data-eng ghostscript` on node:24-alpine gives ocrmypdf 16.11.1 / tesseract 5.5.2 (checked).
- **minio-init creates the bucket only.** MinIO answers CORS for any origin by default.
