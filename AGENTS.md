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
│       │   ├── layouts/     # app-layout: the sidebar shell (and the archive tree) around every signed-in page; require-auth: the gate in front of it
│       │   └── domain/      # archive-tree, archive-sidebar, saved-searches, document-thumbnail, status-badge, upload-panel, mcp-settings, vision-settings, backup-settings, the dialogs
│       ├── routes/          # login, verify, documents (upload + search), document (detail), trash, settings
│       ├── lib/             # apollo, auth, upload, query, format, archive, trash, folder-tree, search-filters, saved-searches, thumbnails, tree (vendored), page, cn()
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
│       ├── vision/          # The vision model: settings (the row, loadVisionConfig), models (listing an endpoint), resolvers
│       ├── sso/             # Pairing with an OIDC provider from a setup URL: settings, pairing (RFC 7591/7592), resolvers
│       ├── documents/       # create.ts (insertPendingDocument, completePendingDocument), resolvers.ts — the document fields CRUD cannot express; duplicates.ts — documentDuplicates
│       ├── folders/         # names.ts (the name rule and its lock), resolvers.ts (folder writes, setFolderMcp)
│       ├── api-keys/        # resolvers.ts: list, make and revoke the caller's API keys
│       ├── saved-searches/  # resolvers.ts: saveSearch, renameSavedSearch, deleteSavedSearch
│       ├── mcp/             # access (what a key may see), tools (engrafo_*), endpoint (/mcp)
│       ├── backup/          # tar (stream writer + reader), manifest (metadata.json), export, import, state (links, runs), endpoint (/export), resolvers
│       ├── metadata/        # document-date and receipt (the extractors), csv, schemas, resolvers (edits, export)
│       ├── search/          # chunk, embedder, index-document, filters, search (hybrid + RRF), browse (filters, no search), resolvers
│       ├── trash/           # trash (notTrashed, trash/restore/purge, deleteStoredFiles), resolvers (trash, restore, purge, empty), purger (the timer)
│       ├── watch/           # The watched folder: files (listing, ignore rules), ingest (one file → a document), watcher (poll, stability, delete)
│       ├── storage/s3.ts    # StorageSet { files, text }: presigned PUT/GET, head, download, put, delete
│       ├── pipeline/
│       │   ├── content.ts   # storeContent(): extracted text → the text bucket
│       │   ├── events.ts    # Typed EventEmitter: 'document.uploaded'
│       │   ├── runner.ts    # createPipeline({…}) → { run, resume, idle, stop }
│       │   ├── step-list.ts # STEPS, in order
│       │   ├── mime.ts      # The upload allowlist
│       │   ├── pdf-text.ts  # pdftotext: the text layer a PDF already has
│       │   ├── epub.ts      # readEpub: an EPUB's text, chapter by chapter, in-process
│       │   ├── html-text.ts # walkHtml: markup off, for EPUB chapters and HTML uploads
│       │   ├── image.ts     # toOpaquePng and pngHasTransparency: an image ocrmypdf will take
│       │   ├── decode.ts    # decodeText: a text upload's bytes, in whatever encoding it was saved in
│       │   ├── thumbnail.ts # thumbnailSource, pdftoppm for a PDF's first page, Pillow to resize an image or a cover
│       │   └── steps/       # inspect, text, ocr, pdf-text, ebook, vision, metadata, index, thumbnail
│       └── __tests__/       # Server tests, in the same folders as src; helpers.ts at the root
├── db/
│   ├── drizzle/             # Generated migrations (committed)
│   └── src/
│       ├── models/          # users, documents, folders, processing-steps, document-chunks, saved-searches, auth (better-auth's tables)
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
untouched, so a retried call does not queue a second run. Both halves live in
`documents/create.ts` (`insertPendingDocument`, `completePendingDocument`), and
the watched folder calls the same two with a server-side `putFile` between
them, so there is one way a document comes into being.

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
mistake. `deleteFolder` puts everything under it in the trash (see the trash rule below), under the
same lock so an upload into it either goes with the rest or finds the folder gone;
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
text over a presigned `TEXT` URL, and `purgeTrash` deletes from both buckets.

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

**The watched folder files into one account, and deletes nothing it has not
stored.** `WATCH_DIR` turns it on; `WATCH_OWNER` names the account by email, and
the folder is per instance, not per user, because a scanner's share has no idea
who is standing at the scanner. The owner is looked up on every pass, so a
missing `WATCH_OWNER` or an address with no account is a `[watch]` line said
once and no filing, never a crash, and setting it before the first sign-in
works. `watch/watcher.ts` polls (`WATCH_POLL_SECONDS`) instead of `fs.watch`,
which sees nothing an SMB client or a bind mount writes, and takes a file only
once its size and mtime have held for `WATCH_STABLE_SECONDS`. Subdirectories are
folders, found ignoring case or made under `lockNames`; a directory name that
breaks the folder name rule, or is a document's, leaves its files alone. A
title clash is numbered, as an upload is. `ingestFile` sniffs the type with
`sniffMimeType` (the inspect step's own rule, with `.txt`, `.md`, `.csv` or `.html` as the claim)
and checks `createUploadSchema`, so the allowlist and `MAX_UPLOAD_BYTES` are
the browser's. A refusal (`Rejected`) is logged once and remembered by size and
mtime, so it is tried again only when the file changes or the server restarts;
anything else is retried on the next pass. **Never twice, never lost:** the
file's sha256 goes into `checksumSha256` with the pending row, before the
bytes are stored (the inspect step later writes the same value). A pending row
with that checksum is resumed instead of a second one inserted, and a filed
document with it means the file is already in — so a crash at any point is
undone by the next pass, without a marker file or a table. The file is unlinked
only after `completePendingDocument` has headed the object, and only if its
size and mtime are what was read. `stop()` refuses new files and waits for the
one in hand, and runs before `pipeline.stop()` in `stopOnSignals`. A file whose
bytes are already in the owner's archive, uploaded from the browser included,
is removed without a copy being added: Paperless refuses duplicates too.

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

**An EPUB is read in-process, and its text keeps its chapters.** No outside
tool: `readEpub` in `pipeline/epub.ts` unzips the text files (`fflate`, capped by
`EBOOK_DEFAULTS.maxUnpackedBytes`, because a zip can be tiny on the wire and huge
inside), follows the package's spine, and takes the markup off with
`htmlparser2` — leniently, since plenty of EPUBs ship XHTML that is not
well-formed. The table of contents (the EPUB 3 nav document, else the EPUB 2 NCX)
names the chapters, including ones that start partway through a file. The
stored text puts each chapter's name on a line of its own (`# The Storm`,
written by `headingLine`), and for an ebook or Markdown — only those,
`hasHeadings` — the index step cuts with `chunkSections`, so no passage
straddles two sections and each is embedded as `title / breadcrumb / passage`. A chapter listed in
`META-INF/encryption.xml` is DRM and fails the step with a message saying so;
obfuscated fonts are listed there too and are not. The step is called `ebook`,
not `epub`, because its name is stored on every document's rows and MOBI, AZW3
and FB2 are meant to land in it later. It sits before `index`, against the
"new steps go last" rule, because it produces text; no document mid-pipeline at
that upgrade was an EPUB. The detail page draws no preview frame for an EPUB:
a browser cannot render one, and the frame only starts a download.

**Markdown is text with headings.** A `.md` upload is stored as it is, by the
text step, like plain text. Neither has magic bytes, so the inspect step takes
the upload's word for both (`isText`), and the app names the type from the
extension when the browser gives none. `chunkSections` reads ATX headings
(`#` to `######`) line by line into a breadcrumb (`Backups › Restore`, as
mcp-ragdown embeds it), ignores a `#` inside a fenced code block, and leaves
YAML front matter out of the passages. It does not read Setext headings
(`===` underlines), tags, wikilinks or anything else mcp-ragdown does: a
Markdown document here is a file you filed, not a note an agent edits.

**A field read from the content says who filled it in, and an edit is never
overwritten.** `documentDate` (a SQL `date`, the day printed on the document,
not `createdAt`) has `documentDateSource`, a `field_source` of `extracted` or
`user`. The `metadata` step, after every step that produces text and before
`index` (it breaks "new steps go last" the way `ebook` does, and step-list.ts
says why that is safe), fills in only fields whose source is not `user`, and
always writes them, null when the new text has none, so a re-run does not keep
the last run's guess. `setDocumentDate` sets or clears the date and marks it
`user`, so a cleared date stays cleared: null with source `user` means "the
user says there is none". `metadataPatch` is where the rule is written.
The way back is `resetDocumentMetadata(id, fields)`, with `DATE` and `RECEIPT`
reset separately because their sources are separate: it hands the fields named
back and reads them from the stored text there and then (`readMetadata`, the
step's own code), on a copy of the row whose named sources are cleared and
whose others are marked `user`, so the same rule writes it and a field not
named is not read again behind the caller's back. A document with no text gets
nulls, no source. Only a `ready` or `failed` document, as with reprocess: one
in the pipeline is `CONFLICT`, since its metadata step would race the write.
Nothing is re-indexed, because no passage carries a date or a receipt.

**The date parser is pure and takes the first plausible date.**
`findDocumentDate` in `metadata/document-date.ts` reads ISO (`2025-03-12`),
year-last numerics (`12.03.2025`, `03/12/2025`, `12/03/25`) and month names in
English and German (`12 March 2025`, `March 12, 2025`, `3. März 2025`), in text
order, and takes the first that is a real day, not before
`METADATA_DEFAULTS.oldestYear` and not more than `futureToleranceDays` past
today, so a due date or an expiry is skipped. Ambiguity is `DATE_ORDER`
(`DMY` by default, as Paperless): a part over 12 settles it whatever the order
says, a dot is always day first, and `YMD` only means something for a
two-digit year last. It has no clock: the step hands it today.

**A receipt is three fields with one source, and a total is never a float.**
`vendor`, `total` and `currency` share `receiptSource`: an edit to any of them
(`setDocumentReceipt` sets all three at once) takes the whole receipt over, and
the step leaves it alone from then on, until a `RECEIPT` reset hands it back. The receipt's date is `documentDate`,
not a column of its own. `total` is Postgres `numeric` with no fixed scale,
written and read as a decimal string (`12.50`, `1.250` for a three-decimal
currency) and exposed as drizzle-graphql's `Decimal` scalar: not minor units,
which mean nothing without a currency, and a receipt often names an amount and
no currency. The app keeps it a string too (`lib/money.ts`); only drawing it
goes through a number. `currency` is ISO 4217, checked by a constraint.

**Receipt extraction is rules, behind a seam, and errs towards empty.**
`extractReceipt` in `metadata/receipt.ts` is pure and is the
`ReceiptExtractor` the step calls; a model-based extractor replaces it there
and nowhere else. No labelled total, no receipt: vendor and currency are only
filled beside a total, so a letter's first line is never a vendor. The total
is the *largest* amount on a line labelled `Total`, `Amount due`, `Grand
total`, `Summe`, `Gesamt` and the like, after dropping subtotal, tax, net,
tendered and change lines (largest, because every part of a total is smaller
than it, wherever it is printed); a label with nothing after it takes the next
line's bare amount, as OCR splits columns. A whole number with no currency
beside it is a count, not money. Either separator is the decimal point when one
or two digits follow it. Currency is the total line's code or unambiguous
symbol, else the one currency the text names; a bare `$`, `¥` or `kr` is
several currencies and gives none. Ebooks and Markdown are never receipts.

**The receipts export is a query, not a route.** `receiptsCsv(from, to,
folderId)` returns the CSV text and the app saves it (`downloadBlob`), because
a session is a bearer token and a plain link would arrive signed out. A receipt
is a document with a vendor or a total; a range filters by `documentDate`,
inclusive, so an undated receipt is only in an export with no range; a folder
takes everything inside it. Cells go through `csvCell`, which quotes and
defuses a leading `=`, `+`, `-` or `@` (CSV injection), except the total.

**The whole-archive export is a link, and it is a tar, streamed.** The export
is too big for `downloadBlob`, so `createExportLink` mints a token (32 random
bytes, kept in memory only as its sha256, for `BACKUP_DEFAULTS.exportLinkTtlMinutes`)
and the app hands the browser `/export/<token>`, which `backup/endpoint.ts`
mounts before the static handler. The token is the credential, spent on first
use; unknown, spent and expired are one 404. Tar rather than zip because
fflate's streaming `Zip` has no ZIP64 (an archive past 4 GiB would come out
corrupt) and a zip's directory is at its end, so the import could not read one
in a single pass; `backup/tar.ts` writes ustar with pax for long or non-ASCII
names and reads the same back. `metadata.json` comes first (`backup/manifest.ts`,
`format` + `version`), then each document's original, archive PDF and text,
each `head`ed for its size and streamed from the bucket into the response, so
memory is one object's chunks. Paths are the tree (`originals/Taxes/2026/<title><ext>`),
with Windows-unsafe characters swapped in the path only. An object missing
from the bucket is left out and logged; a stream that breaks mid-way destroys
the response, so a broken export fails as a download instead of saving short.
Only the caller's rows are read, and `pending_upload` rows are left out.

**The import goes through the bucket and the same two calls as an upload.**
`createImportUpload(sizeBytes)` signs a PUT to `imports/<userId>/<uuid>.tar`
(capped by `MAX_IMPORT_BYTES`, default 5 GiB, S3's single-PUT ceiling);
`importArchive(key)` refuses a key outside the caller's prefix as NOT_FOUND,
starts a background run and returns at once; the app polls `latestImport`. A
run is in memory (`backup/state.ts`), one at a time per user (a second is
`CONFLICT`, since two would race the checksum check), and the uploaded object
is deleted when it ends. A run cut off by a restart is finished by importing
the same archive again: it is idempotent by checksum. `importArchive` in
`backup/import.ts` reads the tar in one pass (gunzipping a `.tar.gz`):
`metadata.json` must be first, folders are made with the watcher's
`ensureFolders` (found ignoring case, made under `lockNames`), and each
original is checked against the manifest's checksum, skipped when that
checksum is already filed in the caller's archive (read once before the run,
so two copies inside one export both come in), sniffed with `sniffMimeType`,
checked with `createUploadSchema` and filed with `insertPendingDocument` +
`completePendingDocument`, so a clash is numbered and the pipeline runs as for
any upload. Before completing, the row gets `createdAt` and whatever the
manifest marks `user` (the date, the receipt through `receiptSchema`), which
the metadata step then leaves alone; extracted fields are read again. The
archive PDFs and text in the tar are not imported: the pipeline makes them.
`mcpEnabled` is recorded, never restored. Notes are not in the manifest
because there is no notes column yet; add them to both halves when there is.

**Search filters go inside each read, never over the fused list.**
`searchDocuments` takes a `filter` (folder with its subfolders unless
`includeSubfolders: false`, `kinds` of PDF / IMAGE / TEXT / EBOOK, a
`documentDate` range, `hasReceipt`), and `filterConditions` in
`search/filters.ts` turns it into conditions on `documents` that are ANDed
into all three reads: the title read directly, the two passage reads through
the same `document_id IN (select … from documents …)` subquery the MCP door's
`folderIds` already used. Each read keeps only its best
`candidatePoolSize`, so a filter applied after the fusion would leave a narrow
search with whatever survived the cut, usually nothing; `search.test.ts`
holds one search that only finds its document because of this. A folder
that is not the caller's has no descendants of theirs and matches nothing.
The MCP tool passes `folderIds` and no filter, and is unchanged. The app keeps
the filters in the query string beside `q` (`lib/search-filters.ts`) and always
draws them.

**Filters with no search are a list, not a search.** `browseDocuments(filter,
first, offset)` in `search/browse.ts` is a plain read of `documents` under the
same `filterConditions`, for the caller's `user_id` and leaving out
`pending_upload` rows, newest by `documentDate` first (`nulls last`), then by
`createdAt`. There is nothing to rank, so nothing is embedded and no passage is
read. It pages by offset, asking for one row more than `first` to answer
`hasMore` without a count; a cursor over a nullable date is case-by-case work
that a personal archive's size does not pay for. An empty filter is allowed and
is the whole archive a page at a time, but the app asks only once something is
narrowed: with filters and no `q` the documents page draws `FilteredDocuments`
in place of the upload panel, and "Show more" appends the next page with
`fetchMore`.

**A thumbnail is the last step, and it never fails a document.** The
`thumbnail` step, last in `STEPS` (it produces no text, so the rule holds, and
a finished document reaches it through `catchUp()`), draws a JPEG
`THUMBNAIL_DEFAULTS.widthPx` wide and stores it at `thumbnails/<user>/<id>.jpg`
in the files bucket, beside the archive, as `documents.thumbnailKey`.
`thumbnailSource` in `pipeline/thumbnail.ts` decides from what: a PDF's first
page from its OCR archive when there is one, else the original, with
`pdftoppm` (poppler-utils, already in both Docker stages for `pdftotext`); an
image from the original, resized by Pillow through `python3 -c` the way
`toOpaquePng` converts (first frame, EXIF turned, laid on white, cut at
`maxHeightPx` so a receipt roll is not a strip); an EPUB from the cover its
package names (`cover-image`, else `<meta name="cover">`, nothing guessed,
`readEpubCover` in `epub.ts`). Text, Markdown, CSV and HTML get none, and the
app draws a type icon. `detectThumbnailTools()` asks for both tools at boot
(`config.thumbnailTools`); a missing one makes the step `skipped` for what it
would draw, not failed. A render that throws is a `[thumbnail]` line and the
step succeeds with no key: a picture in a list is not worth a document waiting
on a person. `deleteStoredFiles` and `reprocessDocument` delete the object with
the archive. The browser gets the URLs in one query per list,
`documentThumbnailUrls(ids)` (the caller's documents that have one; the rest
are left out, not refused), signed for `urlTtlMinutes` rather than the
download's five because rows load lazily, and `documentFileUrl(variant:
THUMBNAIL)` for one. The rows draw it in `ListItem`'s `leadingSlot`
(`DocumentThumbnail`, `loading="lazy"`, the icon again if the image fails).
The tree has no thumbnail: `FileTree` has no hover slot, and `meta` is inside
the row's pressed area.

**A saved search is a query string under a name.** `saved_searches` (scoped
like every user-owned table) holds a `name`, unique per user ignoring case, a
`query` (null for filters alone) and `filters` as JSON: the
`DocumentSearchFilter` the page sent, checked by the search's own
`filterSchema` and stored with only the fields that narrow something
(`storedFilters`). Reads are generated; `saveSearch`, `renameSavedSearch` and
`deleteSavedSearch` in `saved-searches/resolvers.ts` check the name first for a
readable `CONFLICT` and let the unique index catch the race. Nothing on the
server runs one: the app turns it back into the documents page's query string
(`savedSearchPath` in `lib/saved-searches.ts`, which reads the JSON without
trusting its shape) and navigates there. "Save search" is on the documents
page while `q` or a filter is set; the list is `SavedSearchesSidebarSection`,
under the tree in `AppLayout`, each row a link marked while the page shows it,
with Rename (a `NameDialog`) and Delete in its menu. The search box is drawn
afresh when `q` changes from outside it, so opening one (or Back) shows its
text.
**A CSV is text, cut by rows.** Bank and card statements, stored as they are by
the text step; no magic bytes, so `isText` covers it. `chunkText` would read it
as one paragraph (no blank lines), turn its line breaks into spaces and cut
wherever a cell ends in a full stop, so the index step uses `chunkRows`
instead: whole rows packed to the limit (a quoted line break stays in its row;
only a quote that opens a cell quotes it, so `24" monitor` does not swallow the
file), each passage embedded under the first row, since that is the column
names. The header is assumed, not detected. Windows calls a `.csv`
`application/vnd.ms-excel` when Excel is installed; `uploadMimeType` renames
that for a `.csv` only, since it is a real `.xls`'s type too.

**An HTML upload is stored as its text and never shown as a page.** The text
step takes the markup off with the walker EPUB uses (`walkHtml` in
`pipeline/html-text.ts`: scripts, styles, `hidden` and inline `display:none`
left out), writes h1-h6 as Markdown headings at their depth, and `hasHeadings`
covers it, so a passage is embedded under `Order 1234 › Items`. HTML comes to
the text step rather than a step of its own because a new step puts every
finished document back through the pipeline at upgrade. file-type does not
know HTML, so the claim is taken (`hasNoMagicBytes`); XHTML opening with
`<?xml` sniffs as `application/xml`, which is read as HTML only when the upload
said HTML. **The preview card never frames it** (`NOT_PREVIEWABLE`): the
presigned URL is the bucket's origin, but nothing stops a self-hoster serving
the bucket from the app's origin behind one proxy, and even a fully sandboxed
frame still fetches the page's remote images and pixels. The text card shows
what the page said, and downloads are `attachment`.

**WebP, GIF and a see-through PNG reach OCR as an opaque PNG.** ocrmypdf reads
an opaque one of any of them, but refuses any image with transparency (common
in WebP, and in a PNG exported from a screenshot or a design tool) and makes
every frame of an animated GIF a page. So `toOpaquePng` (`pipeline/image.ts`)
writes the first frame laid on white into the run's tmpDir first, keeping a DPI
the image states, with Pillow through `python3 -c` (`OCR_DEFAULTS.pngConverter`):
ocrmypdf is Python and depends on Pillow, and Debian's Pillow reads WebP, so the
image gained no package. A PNG goes through it only when `pngHasTransparency`
finds an alpha colour type or a `tRNS` chunk in its headers; an opaque one goes
in untouched. With OCR off they are stored with no text, like any image, and
the browser previews the original itself.

**The vision model is the admin's setting, read per run, and it replaces only
the text.** An OpenAI-compatible vision model can re-read a PDF's or image's
pages and its transcript replaces the extracted text; ocrmypdf still writes the
PDF/A archive, because that is the copy meant to outlive this instance and no
model emits one. It is configured in Settings, not the environment:
`vision_settings` is a singleton row in `SERVER_TABLES`, written by
`setVisionSettings`, and only the admin reads or writes it (FORBIDDEN for
anyone else: an instance setting, not a row). The API key is write-only —
left out keeps the stored one, `''` clears it — and `visionModels` (what the
form's model list is filled from, as soon as the stored endpoint is known)
sends the stored key only to the base URL it was stored with, and refuses
redirects. `PipelineConfig` is still decided at boot, but the runner calls
`loadVision()` at the start of every run and hands the steps a `RunConfig`
with `vision`, so a change reaches the next document without a restart. The
`vision` step sits after `ebook` and before `metadata`, breaking "new steps go
last" because it produces text. It runs when a model is set up, the document is
a PDF or an image, and either `visionRequested` is set or the model is on
"Read automatically" and `ocrRequested` is. Pages are rasterised from the
archive (already deskewed and upright) at 200 DPI with Ghostscript; an image
goes as uploaded, WebP, GIF and a see-through PNG as `toOpaquePng`, and a TIFF
as a PNG per frame, so a multi-page scan keeps its later pages.

**All pages or nothing, and who asked decides what a failure means.** A page
that does not come back, every page blank (a model that did not read, not a
blank document), or more than `VISION_DEFAULTS.maxPages` (declined, never
truncated) writes nothing. On an automatic run the old text stays, a
`[vision]` line is logged and the step succeeds, so an endpoint being down
never fails every scan filed meanwhile. On a run someone asked for, the step
fails with the reason and Retry runs it again. `readDocumentWithVision` (the
document page's "Read with vision model") takes a ready or failed PDF or image,
claims it conditionally as retry and reprocess do, sets `visionRequested`, and
re-queues `vision`, `metadata`, `index` and any failed steps; it keeps
`archiveKey` and `contentKey`, because the step renders the archive and a failed
read keeps the old text. Re-running metadata and index is safe: metadata keeps
user edits and index swaps passages in one transaction. `visionRequested`
sticks, as `ocrRequested` does, so a later reprocess reads with the model again.

**Settings and the document page are tabs in the query string.** `?tab=` on
both, a `Link` per tab, so a tab can be linked and survives a reload; an
unknown tab (or Sign-in for a non-admin) opens the first. The document page is
Preview / Text / History (the pipeline timeline), with the alerts above the
tabs and Receipt and Details beside them; a type the preview card does not
frame has no Preview tab and opens on Text.

**A text upload is read in the encoding it was saved in.** Plain text,
Markdown, CSV and HTML all reach the text step as bytes, and `decodeText`
(`pipeline/decode.ts`) picks the encoding: a byte-order mark; then UTF-8 if the
bytes are valid UTF-8 and hold no NUL (UTF-16 without a mark is valid UTF-8 too,
so the NULs' side says which UTF-16 it is); then, for HTML only, the page's
`<meta charset>`; then chardet's guess over the first
`TEXT_DEFAULTS.encodingSampleBytes`; then windows-1252. UTF-8 is tried before a
`<meta>` because an editor that re-saves a page rarely fixes its declaration.
The stored text is always UTF-8, so nothing downstream knows.

**Deleting is putting in the trash; only a purge removes objects.** `deleteDocument`
stamps `documents.deleted_at` and touches nothing else, so the row, its objects in both
buckets and its `document_chunks` stay, and `restoreDocument` is the column back to null —
searchable again at once, with no re-index. A trashed row is out of every read but the
trash's: the generated ones through the `documents` entry in `tenancy.ts`'s `scope` (ANDed
with the user, built from the `table` argument because a relation read hands an alias), and
every hand-written one through `notTrashed()` in `trash/trash.ts` — `loadOwned` (so every
document mutation answers `NOT_FOUND` for one), search's three reads (the passage reads
always go through the `documents` subquery now), browse, duplicates, the receipts export,
the MCP door's `sharedDocuments`, the watched folder's checksum dedupe (dropping a trashed
file in again files a new copy), and the runner's `execute`, `resume` and `catchUp`. A new
read of `documents` needs it too, and nothing will say so. drizzle-graphql's own
`softDelete` is not used: it generates `restoreDocuments` whatever `features` says, and a
restore here has to follow the name rule and restart the pipeline. A trashed document holds
no name: `uq_documents_user_folder_title` is partial (`WHERE deleted_at IS NULL`) and
`namesIn` skips them, so a restore takes `lockNames` and numbers itself with `freeName`
(`scan (2)`) when the name was taken since. `deleteFolder` deletes the folder rows and moves
everything in them to the trash with `folder_id` null (rows already trashed lose their folder
too, since the foreign key is RESTRICT), so a document from a deleted folder restores at the
top level; recording the path it came from would mean a folder that exists only in the trash.
A `pending_upload` row is not a document and is still deleted at once, with its object. The
runner skips a trashed document, so `restoreDocument` re-emits one still `uploaded` or
`processing`. `purgeTrash` deletes objects then rows inside one transaction holding the rows
`FOR UPDATE`, so a restore racing it either wins or finds the row gone. It is called by
`purgeDocument`, `emptyTrash`, and `createTrashPurger` (`trash/purger.ts`), which index.ts
starts after listening — once at once, then every `TRASH_DEFAULTS.purgeIntervalMinutes` — for
documents trashed more than `TRASH_RETENTION_DAYS` (`TRASH_DEFAULTS.retentionDays`, 30) ago,
and `stopOnSignals` stops beside the watcher. The app's Trash page lists `trash { documents }`
(plain rows, like duplicates: relation fields are not loaded, so the folder is named from the
archive query); the nav row's badge is `trash { count }`, refetched by name (`TRASH_QUERY_NAMES`)
after every delete, restore and purge rather than polled.

**Report `NOT_FOUND`, never `FORBIDDEN`.** "You may not touch this" confirms the
row exists, which is itself something the caller is not entitled to know.
`loadOwned` in `documents/resolvers.ts` returns `NOT_FOUND` for an id that is not
a UUID, too. `FORBIDDEN` exists for one thing only: an instance-level setting the
caller may not change (`pairSso`, `unpairSso`), where there is no row to hide.

**A duplicate is a warning, matched only within one user's documents.**
`documentDuplicates(ids)` in `documents/duplicates.ts` answers, for each of the
caller's documents asked about, the caller's others with the same
`checksum_sha256` (served by `idx_documents_user_checksum`). Never match across
users: "someone has this file" is itself a leak. It is a root query over a list
of ids, not a field on `Document`, because drizzle-graphql reads only the
columns a selection names, so a field resolver cannot count on the parent's id
or checksum, and a field would be one query per row in a list. The `Document`s
it returns are plain rows, so their relation fields (`folder`) are not loaded:
the app names a copy by `folderId` and the archive's folder paths. The checksum
is written by `inspect`, after `completeDocumentUpload` has returned, so
`checked` says whether the answer means anything yet, and the upload panel asks
about every finished file in one query, polling until each is checked or its
document failed. Nothing is refused and a duplicate is processed like any other
document: the same file in two folders is sometimes meant, the upload already
numbers a name clash, and a duplicate that skipped steps would be a document
with no text and no search, which deleting the other copy would not repair.

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
On SIGTERM or SIGINT, `stopOnSignals` stops accepting connections, waits for
the watched folder to put down the file it is filing, calls
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

**Every log line says where it came from.** `[server]`, `[db]`, `[auth]`, `[trash]`,
`[pipeline]`, `[ocr]`, `[vision]`, `[watch]`, `[backup]`, `[preflight]`. No emoji.

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
