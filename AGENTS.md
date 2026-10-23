# AGENTS.md — Engrafo

## Project Overview

Engrafo is a minimal self-hostable document archive — a very small Paperless-ngx.
You upload a file, it lands in an S3-compatible bucket, a pipeline runs over it,
the text it extracts goes to a second bucket, and the metadata lives in Postgres.
One monorepo (npm workspaces) with three packages — `app/` (frontend), `server/`
(GraphQL API and the pipeline), `db/` (schema and connection) — and one container
serves all of it.

Search is hybrid and local: an embedding model on the CPU and Postgres full-text
search, over passages of each document's text. Documents are filed in nested
folders, drawn as a tree in the sidebar, and a folder the user shares is
readable by an MCP client at `/mcp`. There is no tagging, no correspondents, no mail
ingestion. Those are what Paperless is for.

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | React 19, Vite 7, react-router, Apollo Client 4               |
| UI       | Tailwind CSS v4, cubeui (shadcn registry), TanStack Form      |
| API      | graphql-yoga 5 on Express 5, GraphQL                          |
| Database | Drizzle ORM + PostgreSQL (`postgres-js`)                      |
| Storage  | `@aws-sdk/client-s3` against RustFS or any S3-compatible bucket |
| OCR      | `ocrmypdf` (Tesseract + Ghostscript), shelled out to; optionally a vision model over `@cubicecho/agent-core` |
| Search   | pgvector + Postgres full-text, `@huggingface/transformers` running granite-embedding-small (ONNX, CPU) |
| Testing  | Vitest, PGlite as an in-memory Postgres fixture, Storybook + Playwright |
| Linting  | Biome (formatter + linter)                                    |
| Runtime  | Node.js 26, ESM (`"type": "module"` throughout)               |

## Project Structure

```
engrafo/
├── app/                     # Frontend (Vite SPA, built to app/dist)
│   ├── .storybook/          # main/preview + the Apollo and bucket mocking the stories run on
│   ├── vitest.config.ts     # The `storybook` test project (real Chromium)
│   └── src/
│       ├── __generated__/   # Generated GraphQL types (do not edit, not committed)
│       ├── components/
│       │   ├── ui/          # cubeui primitives — vendored, not linted
│       │   ├── *.tsx        # cubeui shells (PageLayout, CardLayout, SidebarLayout, QueryState, …)
│       │   ├── layouts/     # app-layout: the sidebar shell (and the archive tree) around every signed-in page
│       │   └── domain/      # archive-tree, archive-sidebar, status-badge, upload-panel, mcp-settings, the dialogs
│       ├── routes/          # login, verify, documents (upload + search), document (detail), settings
│       ├── lib/             # apollo, auth, upload, query, format, archive, folder-tree, tree (vendored), page, cn()
│       └── main.tsx         # Providers + the router
├── server/                  # GraphQL API and the pipeline (port 3004)
│   ├── __generated__/       # Generated SDL (not committed)
│   └── src/
│       ├── index.ts         # Boot only: wait for Postgres, migrate, detect OCR, listen, stop on a signal
│       ├── core/            # What every folder reads, about no one concept
│       │   ├── preflight.ts # Boot guards — imported first, on purpose
│       │   ├── config.ts    # Every env var, read at call time
│       │   ├── defaults.ts  # <CONCEPT>_DEFAULTS — every tunable, named, with its unit
│       │   ├── wire.ts      # Unit conversions and HttpStatus
│       │   ├── errors.ts    # ErrorCode and the errors the API answers with; requireAuth
│       │   ├── validation.ts # parseOrThrow: zod → BAD_USER_INPUT
│       │   ├── context.ts   # The per-request GraphQL context
│       │   └── preload-env.ts # Loads ../.env for codegen
│       ├── http/            # The Express side
│       │   ├── app.ts       # createApp(deps) — the whole app, with nothing listening
│       │   ├── health.ts    # What /healthz answers
│       │   ├── shutdown.ts  # stopOnSignals: drain, then close what was opened
│       │   └── static.ts    # Serves the SPA and its fallback
│       ├── graphql/         # The served schema and the rules every operation obeys
│       │   ├── handler.ts   # The Yoga handler and its context
│       │   ├── build-schema.ts # createSchema(db) — buildSchema + extensions
│       │   ├── schema.ts    # The schema bound to the real db
│       │   ├── tenancy.ts   # Row scope + server-owned columns, as buildSchema config
│       │   └── write-schema.ts # Prints the SDL for codegen
│       ├── auth/            # Who the caller is and how they sign in: better-auth, auth-host, admin, session-store, rate-limit, resolvers
│       ├── sso/             # Pairing with an OIDC provider from a setup URL: settings, pairing (RFC 7591/7592), resolvers
│       ├── documents/       # resolvers.ts — the document fields CRUD cannot express
│       ├── folders/         # names.ts (the name rule and its lock), resolvers.ts (folder writes, setFolderMcp)
│       ├── api-keys/        # resolvers.ts: list, make and revoke the caller's API keys
│       ├── mcp/             # access (what a key may see), tools (engrafo_*), endpoint (/mcp)
│       ├── search/          # chunk, embedder, index-document, search (hybrid + RRF), resolvers
│       ├── storage/s3.ts    # StorageSet { files, text }: presigned PUT/GET, head, download, put, delete
│       ├── pipeline/
│       │   ├── content.ts   # storeContent(): extracted text → the text bucket
│       │   ├── events.ts    # Typed EventEmitter: 'document.uploaded'
│       │   ├── runner.ts    # createPipeline({…}) → { run, resume, idle, stop }
│       │   ├── step-list.ts # STEPS, in order
│       │   ├── mime.ts      # The upload allowlist
│       │   ├── pdf-text.ts  # pdftotext: the text layer a PDF already has
│       │   └── steps/       # inspect, text, ocr, pdf-text, index
│       └── __tests__/       # Server tests, in the same folders as src; helpers.ts at the root
├── db/
│   ├── drizzle/             # Generated migrations (committed)
│   └── src/
│       ├── models/          # users, documents, folders, processing-steps, document-chunks, auth (better-auth's tables)
│       ├── schema.ts        # Every model, for Drizzle and for `@cubicecho/engrafo-db/schema`
│       ├── relations.ts     # defineRelations config (drives the GraphQL schema)
│       ├── defaults.ts      # DATABASE_DEFAULTS
│       ├── wait.ts          # waitForDatabase: boot does not race Postgres
│       ├── ssl.ts           # requiresSsl: TLS only for an address that could leave the LAN
│       └── index.ts         # The DB type, the singleton, closeDatabase
├── .agents/mvp-plan.md      # The plan this repo was built from
├── Dockerfile               # node:26-slim + ocrmypdf/tesseract/ghostscript; `test` stage runs the suite
├── docker-compose.dev.yml   # Postgres + RustFS for development
├── docker-compose.yml       # The whole stack, built from this checkout
└── docker-compose.quickstart.yml  # The whole stack, pulled — what self-hosters paste
```

`docker-compose.quickstart.yml` is a published artifact: the README links to its
raw URL on `main`, and people paste it into Portainer and TrueNAS. Its header
comments are the install instructions, so changing an env var here means changing
them there. It pulls `vantreeseba/engrafo:latest` and must never grow a `build:`
key.

Docker Hub is the primary registry: every compose file and the README name
`vantreeseba/engrafo`. The release workflow also pushes the same build to
`ghcr.io/cubicecho/engrafo` as an additional copy; nothing points at it.

## Commands

```bash
npm run dev              # server (3004) + Vite dev server (3000, proxies /graphql and the OIDC routes)
npm run db:up            # Postgres on ${DEV_BIND:-127.0.0.1}:5436, RustFS on 9000/9001
npm run db:generate      # new migration from a schema change
npm run db:migrate       # apply migrations
npm run codegen          # GraphQL types for both server and app
npm run check            # codegen + biome + tsc --noEmit, all three workspaces
npm test                 # Vitest — node, dom and storybook projects
npm run storybook        # Storybook on 6006
npm run build-storybook  # Static Storybook to app/storybook-static
docker build --target test -t engrafo-test . && docker run --rm engrafo-test   # the suite, with OCR installed
```

`npm run check` is the gate. Run it before saying a change is done.

## How the API is built

**The GraphQL schema is generated from the Drizzle schema.** There are no
hand-written CRUD resolvers: `buildSchema(db, config)` from
`@vantreeseba/drizzle-graphql` produces queries, filters, aggregates and relation
fields for every table in `db/src/relations.ts`. Adding a column is all it takes
to expose it.

- **`relations.ts`, not `schema.ts`, is what the library reads.** A table with no
  entry there gets no relation fields.
- **Every generated write is off.** `features` in `tenancy.ts` disables insert,
  update, updateMany and delete, because every write here is a step in a
  lifecycle — a document without an object in the bucket is not a document. That
  leaves the generated schema with no `Mutation` type at all, so
  `withMutationRoot` in `graphql/build-schema.ts` adds an empty one before the SDL
  extensions can extend it.
- **Only what CRUD cannot express gets a resolver.** Those live in
  each concept's `resolvers.ts` (`server/src/auth/`, `server/src/documents/`) and are applied by `graphql/build-schema.ts` in order.
- **Ids are `UUID`, not `ID`.** The generated scalar, and what hand-written SDL
  has to declare too, or a variable will not typecheck against it.

## Rules that carry weight

**Every table needs a `scope` entry.** `server/src/graphql/tenancy.ts` maps each table to
a `RowScope` that is ANDed into the SQL of every generated read. A table missing
from `scope` is visible across tenants, and nothing else in the code will say so.
`tenancy.test.ts` fails when you forget — do not delete the test to make it pass.

**A document is created before its bytes exist.** `createDocumentUpload` inserts
a `pending_upload` row and returns a presigned PUT; the browser uploads straight
to the bucket; `completeDocumentUpload` is what turns it into a real document. It
re-heads the object and refuses if the size does not match what was declared,
because the row was written on the client's word and the object is the only
evidence. It is idempotent — a document already past `pending_upload` is returned
untouched, so a retried call does not queue a second run.

**Folders are rows, and a name is unique in its folder.** `folders` nests by
`parent_id` (null is the top level, where a document with no `folder_id` sits
too) rather than by path strings, so a folder can be empty and a rename or move
is one row. A document's title is its name in its folder: the tree draws
`<folder path>/<title>`, and an MCP client asks for that path. So
nothing in one folder shares a name with anything else there — folder or
document, ignoring case — and a title has no `/`. The two unique indexes hold
it within each table (`coalesce(parent, TOP_LEVEL)` because an index treats
every NULL as distinct); the check across the two tables is `assertNameFree`
in `folders/names.ts`, and every write that adds or changes a name takes
`lockNames` (a per-user advisory lock) first, or two requests could both pass
it. A rename or move onto a taken name is `CONFLICT`, never an overwrite; an
upload is numbered instead (`scan (2)`), since the same filename twice is not a
mistake. `deleteFolder` takes everything under it, objects first, under the same
lock so an upload into it either goes with the rest or finds the folder gone;
`documents.folder_id` is `ON DELETE RESTRICT` so the database can never drop a
document whose objects are still in the bucket. The behaviour follows
mcp-ragdown's, which is where the folder name rule comes from.

**`/mcp` reads only shared folders, with an API key, never a session.** A folder's
`mcp_enabled` shares it and every folder inside it; `loadMcpAccess` in
`mcp/access.ts` is the one place that rule is written, and every tool reads it
afresh per call, so turning a folder off takes effect on the next call. The top
level is never shared. Paths run from the top through unshared folders too,
matched ignoring case, and an unshared or missing path answers the same "not in
a shared folder". The endpoint is stateless Streamable HTTP (a server per
request, as mcp-ragdown serves it), mounted with `app.all` before the static
handler, and is not GraphQL: there is no context, so `requireAuth` never sees a
key, and only a session can call `createApiKey` — a key cannot mint its
successor. Keys are better-auth's api-key plugin (`engr_` prefix, `apikeys`
table in `AUTH_TABLES`, out of the GraphQL schema), stored in Postgres whatever
`SESSION_STORE` says, and minted with `rateLimitEnabled: false`, because the
plugin's default of ten a day starves an agent. `SECURE_LOCAL_NET` does not
waive the key: the key is what says whose archive it is. The four tools are
read-only. `searchDocuments` takes `folderIds` for this door.

**The tree is in the sidebar.** `ArchiveSidebarSection` is mounted by
`AppLayout` on every signed-in page and is the one reader of `useArchive` that
polls (the sidebar is hidden under `md` by CSS, not unmounted). The documents
page draws a second `ArchiveTree` under `md` only, from the same query and
cache. A folder's "Upload here" navigates to `/?into=<id>`, which is where the
upload panel's folder lives. A mutation outside the tree that removes a row
refetches `Archive`; one that returns the changed fields updates it by id.

**`PageLayout width="full"` pads nothing.** cubeui's chassis puts `px-4` on the
body only with the `page` and `prose` columns, so every full-width page passes
`FULL_WIDTH_BODY` (`lib/page.ts`) in `contentClassName`.

**Two buckets: files and text.** `S3_BUCKET` holds what the user uploaded and
what OCR produced; `S3_TEXT_BUCKET` (default `<bucket>-text`) holds the extracted
text. Postgres keeps `contentKey` and `contentBytes` and nothing else — text runs
to megabytes, no query here reads it, and a list of a thousand documents should
not drag it along. `createS3Storage` returns a `StorageSet { files, text }`
sharing one pair of clients; `storeContent()` in `pipeline/content.ts` is the
only writer, and empty text stores no object at all. The detail page fetches the
text over a presigned `TEXT` URL, and `deleteDocument` deletes from both buckets.

**Search is the one place document text sits in Postgres, and it is an index.**
The `index` step, last in `STEPS`, cuts the text into passages (paragraphs packed
to 1,500 characters; OCR output has no headings to split on), embeds each with
the document's title in front, and swaps the document's `document_chunks` rows
in one transaction. `documents` still holds no text. `searchDocuments` runs three
reads for the caller only, all filtered by `user_id` in `search/search.ts`: the
nearest passages by cosine (an exact scan; a vector index filtered by user can
drop the rows asked for), passages matching `websearch_to_tsquery('simple', …)`,
and titles matching it. Reciprocal rank fusion (k = 60) merges them, a passage
found only by meaning must clear a cosine of 0.8 (the model's unrelated prompts
top out at 0.75), and a document ranks by its best passage. The numbers are
mcp-ragdown's, measured on its benchmark. `document_chunks` is excluded from the
GraphQL schema (`SEARCH_TABLES`), so `tenancy.ts` never scopes it: anything new
that reads it filters by the caller itself. Its word index is an expression
index, because drizzle-graphql has no type for a `tsvector` column, so a query
must use the same `to_tsvector('simple', content)` to hit it. The model loads on
first use, not at boot; tests use `createFakeEmbedder()`, and `model.test.ts`
runs the real one only where `MODELS_DIR` holds it (the Docker test stage).

**Two S3 endpoints, on purpose.** The server reaches the bucket at `S3_ENDPOINT`;
presigned URLs are signed against `S3_PUBLIC_ENDPOINT` by a second client. A
signature covers the host, so a URL cannot be rewritten after signing — pointing
the browser at the wrong one fails as a signature mismatch, not a DNS error.

**The bucket has to answer CORS, and RustFS does not unless told to.** The page
is on one port and the bucket on another, so the presigned PUT and the text
fetch are cross-origin. Every compose file sets `RUSTFS_CORS_ALLOWED_ORIGINS:
"*"` — the signed URL is the credential, and neither request carries cookies —
and without it uploads fail in the browser while every server-side call still
works, which is why no test here notices. The same files empty
`RUSTFS_OBS_LOG_DIRECTORY`, which is what puts RustFS's log on stdout instead of
in a file inside the container.

**The pipeline is an in-process event, and that is deliberate.** There is no
queue: `completeDocumentUpload` emits `document.uploaded` and returns.
`createPipeline` holds an in-flight map keyed by document id, so the same
document emitted twice runs once, and a counting limiter (`OCR_CONCURRENCY`)
bounds how many run at all — OCR is CPU-bound and a dropped folder would
otherwise fork one `ocrmypdf` per file. Swapping in a real queue later means
changing `events.ts` and the boot call; the step contract stays.

**`processing_steps` is the only pipeline state, and it is what makes a restart
survivable.** At boot `pipeline.resume()` re-emits every document still in
`uploaded` or `processing`; steps already `succeeded` or `skipped` are not re-run.
The runner also inserts any step rows that are missing (`onConflictDoNothing`),
which is what lets a step added in a later release reach documents that were
mid-pipeline when the server upgraded. Documents that had already *finished*
are reached by `pipeline.catchUp()` at boot: a `ready` document missing a row for
any current step is put back to `uploaded` and emitted, and only the missing
steps run. That is how an existing archive gets indexed for search. Adding a step
is one file plus one entry in `STEPS`, at the end, so existing rows keep their
positions.

**A step failure is recorded, never thrown.** `pipeline.run()` resolves either
way: the step and the document are marked `failed` with the message, and the run
stops there. There are no automatic retries — `retryDocumentProcessing` resets
the failed steps to `queued` and re-emits, and it only accepts a document that is
actually `failed`. `reprocessDocument` is the other way back in: it accepts a
`ready` or `failed` document, resets *every* step, optionally turns OCR on or
off, and clears `archiveKey` and `contentKey` and deletes their objects before
re-emitting, so a run that now produces no archive or no text does not leave
the last one showing.

**The OCR integration test only really runs in the image.** `ocr.test.ts` skips
itself without ocrmypdf and ImageMagick, which a dev host usually lacks — so the
Dockerfile's `test` stage installs both and CI runs the suite there. That stage
is what caught the orientation model (`tesseract-ocr-osd`) missing from the
runtime image: `--rotate-pages` and `--deskew` load it, it is packaged apart
from the languages, and without it every OCR run fails with "Tesseract couldn't
load any languages". Any new `apt` dependency belongs in both stages.

**OCR being *enabled* and OCR being *available* are different questions.**
`ocrEnabled()` reads the env var; `detectOcr()` asks whether `ocrmypdf` is on the
PATH, once, at boot. A missing binary is reported as "OCR unavailable" — the
upload form disables its toggle and says why — rather than as every document
failing. The Docker image ships the binary; a dev server on a bare host usually
does not.

**The OCR flags are Paperless's.** `--skip-text` (a born-digital PDF keeps its
own text layer), `--rotate-pages`, `--deskew`, `--output-type pdfa`,
`--color-conversion-strategy RGB` (PDF/A refuses some colour spaces, and without
it ocrmypdf fails the run with ColorConversionNeededError), plus a `--sidecar`
for the plain text. Images additionally get `--image-dpi 300`,
because they usually carry no DPI metadata and img2pdf refuses to guess.

**A PDF that already has text keeps it, through pdftotext.** `--skip-text`
leaves those pages alone, and the sidecar holds only `[OCR skipped on
page(s) N]` for them, so taken alone it gives a born-digital PDF no text at
all. When the sidecar has that marker the ocr step reads the archive with
`pdftotext` instead, which has every page's text layer, the PDF's own and the
recognised one. When OCR does not run (not asked for, or unavailable), the
`pdf-text` step reads the original the same way. It is last in `STEPS` so a
document mid-pipeline at upgrade gets it at a new position. `pdftotext` is
`poppler-utils`, in both Docker stages, and `detectPdfText()` asks for it at
boot like `detectOcr()`.

**Report `NOT_FOUND`, never `FORBIDDEN`.** "You may not touch this" confirms the
row exists, which is itself something the caller is not entitled to know.
`loadOwned` in `documents/resolvers.ts` returns `NOT_FOUND` for an id that is not
a UUID, too. `FORBIDDEN` exists for one thing only: an instance-level setting the
caller may not change (`pairSso`, `unpairSso`), where there is no row to hide.

**`SECURE_LOCAL_NET` is the ecosystem's word for a trusted network**, and here it
means sign-in needs no link: `requestSignIn` returns a live session for
whatever address it is handed, and the login page uses it (`if (result.session)`).
`AUTH_MAGIC_LINK=false` is the older, narrower spelling and still works;
`magicLinkRequired()` in `core/config.ts` is where the two meet, and the boot warning
names whichever one is responsible. Both make an email address the entire
credential, so neither belongs on a reachable instance.

**Auth is better-auth, reached through GraphQL.** `createAuth(db, opts)` in
`auth/better-auth.ts` builds the instance and it travels on the context
(`ctx.auth`); no module imports a global, and the only REST routes are the two
legs of an OIDC sign-in, which cannot be GraphQL because the browser has to be
sent somewhere. Sessions
are opaque bearer tokens, held in memory unless `SESSION_STORE=database`, so a
restart signs everyone out by default. better-auth's own rate limiter never runs
for `auth.api.*` calls, so the sign-in mutations call `throttle` first, which
counts by client address (`TRUST_PROXY`) and by email. The `sessions`, `accounts`
and `verifications` tables are excluded from the GraphQL schema in
`graphql/build-schema.ts`. Passwords are off: with no mail provider there is no
way to prove an address before a password is set on it.

**OIDC sign-in ends in a one-time token, not a cookie.** With `OIDC_ISSUER` and
`OIDC_CLIENT_ID` set, `genericOAuth` is added and `http/sso.ts` mounts
`/sso/oidc` (sends the browser to the provider) and `/api/auth/callback/oidc`
(better-auth's callback, at its default path — that is the redirect URI to
register). The callback drops the session cookie better-auth would set, mints a
one-time token for the session, and redirects to `/auth/sso?token=…`; the app
swaps it for a bearer session with `verifyOneTimeToken`. Both routes are mounted
before the static handler, or the SPA fallback answers them. A failure lands on
`/login?error=<code>`, which the login page reads. `authConfig.sso` is what tells
the login page to show the button.

**The provider can also be paired from the app, and then the auth instance
changes while the server runs.** An admin pastes a setup URL
(`<issuer>#setup=<token>&name=<name>`); `sso/pairing.ts` checks the issuer's
discovery document names itself, registers Engrafo at its
`registration_endpoint` with the token (RFC 7591), and keeps the client in the
`oidc_settings` row. Unpairing deletes the client at the provider (RFC 7592) and
forgets the row even when the provider cannot be reached. The token is never
logged or stored. `OIDC_ISSUER` in the environment wins over a pairing
(`effectiveOidc` in `sso/settings.ts`), and then `pairSso` answers `FORBIDDEN`.

better-auth fixes its plugins when it is created, so a pairing means a new
instance: `AuthHost` (`auth/auth-host.ts`) holds the current one and `rebuild()`
replaces it. **Never hold an `Auth` from boot** — the GraphQL context takes
`authHost.current()` per request, and the SSO routes are always mounted and ask
the host each time, redirecting to `/login?error=sso_off` while there is no
provider. `oidc_settings` holds client secrets, so it is in `SERVER_TABLES` and
excluded from the GraphQL schema next to better-auth's tables.

**The first account is the admin.** `users.is_admin` is set by better-auth's
`user.create.after` hook through `claimFirstAdmin`, which only succeeds while no
admin exists; the migration made the oldest existing account the admin. The admin
pairs and disconnects in Settings. While there are no accounts at all, anyone may
pair from the login page's "Set up sign-in" tab, so whoever installs Engrafo can
set sign-in up before there is an admin to ask.

**The app is built in one place and booted in another.** `createApp(deps)` in
`http/app.ts` returns the Express app with everything it needs handed to it and
nothing listening; `index.ts` is the only file that opens a port, a connection
or a signal handler. That split is what lets `http/app.test.ts` run the real
app on a random port. There is no CORS: the server serves its own client, so
the API is same-origin, and Yoga's default of answering every origin is turned
off in `graphql/handler.ts`.

**Boot waits, shutdown drains.** `waitForDatabase` runs before `migrate`, so a
compose stack whose Postgres is still starting does not crash-loop the server.
On SIGTERM or SIGINT, `stopOnSignals` stops accepting connections, calls
`pipeline.stop()` — new runs resolve without starting, and a step cut off
mid-run is not recorded as failed, so `resume()` picks it up on the next boot —
then closes the database. `/healthz` answers 503 while the database is
unreachable, which is what the image's healthcheck reads.

**Tunables have names, and `process.env` has three readers.** A number or a
default lives in a `<CONCEPT>_DEFAULTS` object in `core/defaults.ts` (or
`db/src/defaults.ts`) with its unit in the field name; `core/config.ts` reads
the environment and falls back to them. Only config, preflight and the db
package read `process.env`. Errors the API answers with come from
`core/errors.ts`, and tests compare against `ErrorCode`, not a string.

**Every log line says where it came from.** `[server]`, `[db]`, `[auth]`,
`[pipeline]`, `[ocr]`, `[preflight]`. No emoji.

**`UNAUTHENTICATED` means the session expired.** The client drops its token on it
and redirects to `/login`. A bad magic link is `BAD_USER_INPUT` — it must not
sign anyone out.

**An empty state means the server said "none", never that we failed to ask.**
`QueryState` takes the failure rung before the empty one, and `queryLike()` in
`app/src/lib/query.ts` reports pending and error only while there is nothing on
screen — so a poll that fails does not replace a good list with an error card.

**The list polls only while something is moving.** Both pages start a 3s poll
when a document is `uploaded` or `processing` and stop otherwise. There is no
subscription: the pipeline runs inside the server process and says nothing until
it is asked.

**The browser is not in a secure context.** A self-hosted instance is reached
over plain HTTP at a LAN address, and `http://nas.local:3004` is not a secure
context — only HTTPS and `localhost` are. So `crypto.randomUUID`,
`crypto.subtle`, `navigator.clipboard` and the rest are simply *undefined*
there, and calling one throws `… is not a function` in the handler that reached
for it. `clientId()` in `app/src/lib/id.ts` is the replacement for
`crypto.randomUUID()`; anything else in that family needs the same treatment or
a feature check. Dev never catches this, because Vite serves on `localhost`.

**The chrome is cubeui's chrome.** `SidebarLayout` with a `Sidebar` in it, the
palette from `app/cubeui-tokens.css`, and the registry's components for
everything a page is made of. `index.css` adds nothing of its own beyond the
`dark` variant and the base border and body colours. The sibling apps are on the
same registry, so they read as one set of tools without anything being copied
between them — a change to how the shell *looks* is a change upstream, not here.

**Write cubeui the way cubeui is written.** No `children` on its components:
nodes go in props ending in `Slot`, words go in `title`, `description`, `label`
and `content`. An icon-only button is a `Button` in an `icon*` size with an
`aria-label` (it will not typecheck without one), and it shows a tooltip only
when given a `hint`; a destructive one is a `ConfirmButton` whose description
says what is lost. Forms are TanStack Form through `useAppForm` (`login.tsx`,
and `rename-document-dialog.tsx`). A `form.SubmitButton` outside its `<form>`,
as in a dialog's footer, submits by itself — do not give it an `onClick` that
calls `handleSubmit()` too, or the form submits twice. Colours in app code are cubeui's token names — `foreground`,
`secondary`, `positive`, `warning`, `negative`, `info`, `hover`, `active` — and
"muted" is an opacity (`text-foreground/60`), not a token; the shadcn alias
names (`muted-foreground`, `destructive`, `accent`) appear only in vendored
files. Load the `cubeui` skill before adding or updating a registry item.

**The shell owns the sidebar; pages own their headers.** `AppLayout`
(`app/src/components/layouts/app-layout.tsx`) wraps everything inside
`RequireAuth`, so "signed in" and "has the sidebar" cannot drift apart — and
`/login` and `/auth/verify`, which have nothing to navigate to, are a
`CenteredLayout` each. Pages keep using `PageLayout` inside it, at
`width="full"`: every page fills the space beside the sidebar rather than
sitting in a capped column. Adding a screen means a route in
`main.tsx` and an entry in `NAV_ITEMS`.

Three things about that shell that are easy to break:

- **`h-svh`, and `min-h-0` all the way down.** `PageLayout` scrolls its own body
  and pins its header, which only works if an ancestor has a real height. A flex
  item's floor is its content, so every flex ancestor between the shell and the
  page needs `min-h-0` or the body grows instead of scrolling and the header
  quietly stops sticking.
- **Below `md` the sidebar is replaced by a bar, and the bar is 320px wide on a
  small phone.** It holds the two nav icons and sign-out and nothing else. The
  compact `ThemePicker` is in the sidebar's foot but not in the bar, because it
  does not fit; the `Narrow` story asserts the bar does not overflow.
- **The theme is applied in `index.html`, not in React.** The inline script in
  the document head sets the `dark` class before first paint. React mounts
  *after* the first paint, so choosing the theme in a component is a white flash
  on every load for anyone in dark mode. That script is cubeui's
  `THEME_PRE_PAINT_SCRIPT` pasted in, and has to be re-pasted if
  `ui/theme-picker` changes its storage keys.

**The theme has three states, not two.** `system`, `light`, `dark` — a device
preference, stored by cubeui under `cubeui-theme`, never on the account, which
is why `ThemePicker` works signed out and sits on the login card too. `system`
is the default and it is *live*: `ThemeSync` in `main.tsx` calls
`useThemePreference()` for as long as the app is mounted, so flipping the OS
between light and dark repaints without a reload. The picker is a radiogroup of
three rather than a sun/moon toggle because an icon cannot say which of three
states it is in.

**`app/src/components/ui/` is vendored.** Those files come from the cubeui
registry and are kept as published, so `shadcn add` can update them.
`biome.json` turns the linter and the formatter off for them rather than letting
anyone edit them into compliance. The cubeui shells one level up (`page-layout.tsx`,
`query-state.tsx`, …) are the same deal.

## Stories are the frontend tests

There is no headless-Chrome script in this repo. A story is a component with its
data already decided, so the thing that used to need a browser driver and a real
login is now a file next to the component, and `@storybook/addon-vitest` runs
every one of them as a test. Writing a story and writing a test are the same act:
a story without a `play` function is a picture, and pictures do not fail CI.

**Stories live next to the component.** `upload-panel.tsx` and
`upload-panel.stories.tsx` in the same folder, so a component that changes shape
and the story claiming it still works show up in the same diff.

**Nothing under `components/ui/`.** That tree is vendored from cubeui and
shadcn. Stories for it belong upstream where the component is maintained, not in
a copy of it. cubeui has its own Storybook.

**Two ways to give a story a server**, both under `parameters.apolloClient`
(`app/.storybook/graphql.tsx`), because stories ask two different questions:

- `mocks` — Apollo's own `MockedProvider`, an exact request paired with an exact
  response. Reach for it when the *request* is the subject: this click sends
  `completeDocumentUpload` with this id. It fails loudly on a request it was not
  told about, which is the point.
- `resolvers` — a `graphql-mocks` server executing against the app's own copy of
  the printed SDL. Reach for it when the *page* is the subject and the queries
  are an implementation detail. It is also the only one of the two that catches
  schema drift: a resolver returning a field the server no longer has fails
  here, not in production.

Every story gets an `ApolloProvider` either way, even with no mocks at all —
every screen renders under one, so a story without it fails on `useMutation` at
the top of the component rather than on the assertion it was written for. A
fresh client per story, so nothing inherits the previous story's cache.

The SDL a `resolvers` story builds its server from is
`app/src/__generated__/schema.graphql`, emitted by the `schema-ast` codegen
plugin and imported with Vite's `?raw`. Stories run in a browser, where
`../../server/…` is not a path Vite will serve.

**There is a mock bucket.** `putFile` does a real `XMLHttpRequest` PUT, and
mocking the GraphQL either side of it leaves exactly the interesting part
untested. `app/.storybook/mock-bucket.ts` is a Vite middleware answering
`/__mock-bucket/ok` with 204 and `/__mock-bucket/denied` with 403, so the upload
panel's whole path — presign, PUT, progress, complete — is a story. It is
registered twice: `viteFinal` in `main.ts` for the dev server, and again in
`app/vitest.config.ts`, because the addon does not carry it across.

**Accessibility failures are test failures.** `a11y: { test: 'error' }`.
Collecting a report nobody reads is not a check.

**Three vitest projects, and the order matters.** `node` (PGlite) and `dom`
(jsdom) are `groupOrder: 0`; `storybook` (Chromium) is `groupOrder: 1`, so it
runs last and alone. Run alongside the browser, PGlite loses — it builds a
Postgres per test file, and the failure surfaces as a database `beforeEach`
timing out, which is the wrong place to look. The storybook project also sets
`fileParallelism: false`: parallel browser sessions drop their websocket partway
through and the run dies with "browser connection was closed".

## Code style

- Biome, single quotes, 2-space indent, 120 columns, trailing commas. `npm run check` applies the safe fixes; CI runs `npx biome ci .`, which writes nothing.
- `biome.json` is parsed as strict JSON here — **no comments in it**, or Biome
  reports a confusing "nested root configuration" error.
- `server/` and `db/` have no build step: Node 26 strips the types as it loads
  each file, with no flag. So **relative imports there carry an explicit `.ts`
  extension**, and the same Node major runs in dev, CI and the image
  (`node:26-slim`). `app/` is
  bundled by Vite and omits it.
- **Never add `--preserve-symlinks`.** It resolves `@cubicecho/engrafo-db` to its
  path inside `node_modules`, and Node refuses to strip types from anything
  under there.
- `import './core/preflight.ts';` stays first in `server/src/index.ts`, separated by a
  blank line so Biome's import sorting leaves it there. It has to run before
  `@cubicecho/engrafo-db` is imported.
- Comments explain *why*. The code already says what.

## Generated output

`server/__generated__/`, `app/src/__generated__/` and `.env` are never committed.
Run `npm run codegen` after any schema change; CI regenerates from scratch.

## Git conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, …). semantic-release reads them.
- **Do not add `Co-Authored-By` trailers.**
- Never commit `.env`, generated code, or `node_modules`.
