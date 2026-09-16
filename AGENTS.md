# AGENTS.md — Engrafo

## Project Overview

Engrafo is a minimal self-hostable document archive — a very small Paperless-ngx.
You upload a file, it lands in an S3-compatible bucket, a pipeline runs over it,
the text it extracts goes to a second bucket, and the metadata lives in Postgres.
One monorepo (npm workspaces) with three packages — `app/` (frontend), `server/`
(GraphQL API and the pipeline), `db/` (schema and connection) — and one container
serves all of it.

There is no search, no tagging, no correspondents, no mail ingestion. Those are
what Paperless is for.

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | React 19, Vite 7, react-router, Apollo Client 4               |
| UI       | Tailwind CSS v4, shadcn/ui + cubeui, Radix UI                 |
| API      | graphql-yoga 5 on Express 5, GraphQL                          |
| Database | Drizzle ORM + PostgreSQL (`postgres-js`)                      |
| Storage  | `@aws-sdk/client-s3` against MinIO or any S3-compatible bucket |
| OCR      | `ocrmypdf` (Tesseract + Ghostscript), shelled out to          |
| Testing  | Vitest, PGlite as an in-memory Postgres fixture, Storybook + Playwright |
| Linting  | Biome (formatter + linter)                                    |
| Runtime  | Node.js 24+, ESM (`"type": "module"` throughout)              |

## Project Structure

```
engrafo/
├── app/                     # Frontend (Vite SPA, built to app/dist)
│   ├── .storybook/          # main/preview + the Apollo and bucket mocking the stories run on
│   ├── vitest.config.ts     # The `storybook` test project (real Chromium)
│   └── src/
│       ├── __generated__/   # Generated GraphQL types (do not edit, not committed)
│       ├── components/
│       │   ├── ui/          # shadcn/ui primitives — vendored, not linted
│       │   ├── *.tsx        # cubeui shells (PageLayout, QueryState, ConfirmButton, …)
│       │   ├── layouts/     # app-layout: the sidebar shell around every signed-in page
│       │   └── domain/      # status-badge, upload-panel
│       ├── routes/          # login, verify, documents (list), document (detail), settings
│       ├── lib/             # apollo, auth, theme, upload, query, format, cn()
│       └── main.tsx         # Providers + the router
├── server/                  # GraphQL API and the pipeline (port 3004)
│   ├── __generated__/       # Generated SDL (not committed)
│   └── src/
│       ├── index.ts         # Entry point: migrate, detect OCR, mount /graphql, serve the SPA
│       ├── preflight.ts     # Boot guards — imported first, on purpose
│       ├── config.ts        # Every env var, read at call time
│       ├── build-schema.ts  # createSchema(db) — buildSchema + extensions
│       ├── tenancy.ts       # Row scope + server-owned columns, as buildSchema config
│       ├── storage/s3.ts    # StorageSet { files, text }: presigned PUT/GET, head, download, put, delete
│       ├── pipeline/
│       │   ├── content.ts   # storeContent(): extracted text → the text bucket
│       │   ├── events.ts    # Typed EventEmitter: 'document.uploaded'
│       │   ├── runner.ts    # createPipeline({…}) → { run, resume, idle }
│       │   ├── index.ts     # STEPS, in order
│       │   ├── mime.ts      # The upload allowlist
│       │   └── steps/       # inspect, text, ocr
│       ├── resolvers/       # auth, documents — SDL extensions for what CRUD cannot express
│       └── __tests__/       # Server tests
├── db/
│   ├── drizzle/             # Generated migrations (committed)
│   └── src/
│       ├── models/          # users, documents, processing-steps
│       ├── relations.ts     # defineRelations config (drives the GraphQL schema)
│       └── index.ts         # DB singleton + re-exports
├── .agents/mvp-plan.md      # The plan this repo was built from
├── Dockerfile               # node:24-alpine + ocrmypdf/tesseract/ghostscript; `test` stage runs the suite
├── docker-compose.dev.yml   # Postgres + MinIO for development
├── docker-compose.yml       # The whole stack, built from this checkout
└── docker-compose.quickstart.yml  # The whole stack, pulled — what self-hosters paste
```

`docker-compose.quickstart.yml` is a published artifact: the README links to its
raw URL on `main`, and people paste it into Portainer and TrueNAS. Its header
comments are the install instructions, so changing an env var here means changing
them there. It pulls `vantreeseba/engrafo:latest` and must never grow a `build:`
key.

## Commands

```bash
npm run dev              # server (3004) + Vite dev server (3000, proxies /graphql)
npm run db:up            # Postgres on ${DEV_BIND:-127.0.0.1}:5436, MinIO on 9000/9001
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
  `withMutationRoot` in `build-schema.ts` adds an empty one before the SDL
  extensions can extend it.
- **Only what CRUD cannot express gets a resolver.** Those live in
  `server/src/resolvers/` and are applied by `build-schema.ts` in order.
- **Ids are `UUID`, not `ID`.** The generated scalar, and what hand-written SDL
  has to declare too, or a variable will not typecheck against it.

## Rules that carry weight

**Every table needs a `scope` entry.** `server/src/tenancy.ts` maps each table to
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

**Two buckets: files and text.** `S3_BUCKET` holds what the user uploaded and
what OCR produced; `S3_TEXT_BUCKET` (default `<bucket>-text`) holds the extracted
text. Postgres keeps `contentKey` and `contentBytes` and nothing else — text runs
to megabytes, no query here reads it, and a list of a thousand documents should
not drag it along. `createS3Storage` returns a `StorageSet { files, text }`
sharing one pair of clients; `storeContent()` in `pipeline/content.ts` is the
only writer, and empty text stores no object at all. The detail page fetches the
text over a presigned `TEXT` URL, and `deleteDocument` deletes from both buckets.

**Two S3 endpoints, on purpose.** The server reaches the bucket at `S3_ENDPOINT`;
presigned URLs are signed against `S3_PUBLIC_ENDPOINT` by a second client. A
signature covers the host, so a URL cannot be rewritten after signing — pointing
the browser at the wrong one fails as a signature mismatch, not a DNS error.

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
mid-pipeline when the server upgraded. Adding a step is one file plus one entry
in `STEPS`.

**A step failure is recorded, never thrown.** `pipeline.run()` resolves either
way: the step and the document are marked `failed` with the message, and the run
stops there. There are no automatic retries — `retryDocumentProcessing` resets
the failed steps to `queued` and re-emits, and it only accepts a document that is
actually `failed`.

**The OCR integration test only really runs in the image.** `ocr.test.ts` skips
itself without ocrmypdf and ImageMagick, which a dev host usually lacks — so the
Dockerfile's `test` stage installs both and CI runs the suite there. That stage
is what caught `tesseract-ocr-data-osd` missing from the runtime image:
`--rotate-pages` and `--deskew` load the orientation model, Alpine packages it
apart from the languages, and without it every OCR run fails with "Tesseract
couldn't load any languages". Any new `apk` dependency belongs in both stages.

**OCR being *enabled* and OCR being *available* are different questions.**
`ocrEnabled()` reads the env var; `detectOcr()` asks whether `ocrmypdf` is on the
PATH, once, at boot. A missing binary is reported as "OCR unavailable" — the
upload form disables its toggle and says why — rather than as every document
failing. The Docker image ships the binary; a dev server on a bare host usually
does not.

**The OCR flags are Paperless's.** `--skip-text` (a born-digital PDF keeps its
own text layer), `--rotate-pages`, `--deskew`, `--output-type pdfa`, plus a
`--sidecar` for the plain text. Images additionally get `--image-dpi 300`,
because they usually carry no DPI metadata and img2pdf refuses to guess.

**Report `NOT_FOUND`, never `FORBIDDEN`.** "You may not touch this" confirms the
row exists, which is itself something the caller is not entitled to know.
`loadOwned` in `resolvers/documents.ts` returns `NOT_FOUND` for an id that is not
a UUID, too.

**`SECURE_LOCAL_NET` is the ecosystem's word for a trusted network**, and here it
means sign-in needs no link: `requestMagicLink` returns a live session for
whatever address it is handed, and the login page uses it (`if (result.token)`).
`AUTH_MAGIC_LINK=false` is the older, narrower spelling and still works;
`magicLinkRequired()` in `config.ts` is where the two meet, and the boot warning
names whichever one is responsible. Both make an email address the entire
credential, so neither belongs on a reachable instance.

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

**The shell owns the sidebar; pages own their headers.** `AppLayout`
(`app/src/components/layouts/app-layout.tsx`) wraps everything inside
`RequireAuth`, so "signed in" and "has the sidebar" cannot drift apart — and
`/login` and `/auth/verify`, which have nothing to navigate to, stay bare. Pages
keep using `PageLayout` inside it; a settings-shaped page takes `width="prose"`.
Adding a screen means a route in `main.tsx` and an entry in `NAV_ITEMS`.

It is hand-rolled rather than shadcn's `sidebar`, matching the `mcp-*` apps.
That component brings a provider, a cookie, a rail, a mobile sheet and
collapsible icon mode; this is a flat list of two. Two things it gets wrong if
copied carelessly:

- **`h-screen`, and `min-h-0` all the way down.** `PageLayout` is a
  `StickyHeaderContentFooter` — it scrolls its own body and pins its header,
  which only works if an ancestor has a real height. A flex item's floor is its
  content, so every flex ancestor between the shell and the page needs
  `min-h-0` or the body grows instead of scrolling and the header quietly stops
  sticking.
- **The theme is applied in `index.html`, not in React.** The inline script in
  the document head sets the `dark` class before first paint. React mounts
  *after* the first paint, so choosing the theme in a component is a white flash
  on every load for anyone in dark mode. `app/src/lib/theme.ts` owns changes
  after that; its `THEME_STORAGE_KEY` must stay in step with the key spelled out
  in that script.

**`app/src/components/ui/` is vendored.** Those files come from the shadcn and
cubeui registries and are kept as published, so `shadcn add` can update them.
`biome.json` exempts them from two lint rules rather than letting anyone edit
them into compliance. The cubeui shells one level up (`page-layout.tsx`,
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

- Biome, single quotes, 2-space indent, 120 columns, trailing commas. `npm run check:fix`.
- `biome.json` is parsed as strict JSON here — **no comments in it**, or Biome
  reports a confusing "nested root configuration" error.
- `server/` and `db/` run under `--experimental-strip-types` with no build step,
  so **relative imports there carry an explicit `.ts` extension**. `app/` is
  bundled by Vite and omits it.
- **Never add `--preserve-symlinks`.** It resolves `@cubicecho/engrafo-db` to its
  path inside `node_modules`, and Node refuses to strip types from anything
  under there.
- `import './preflight.ts';` stays first in `server/src/index.ts`, separated by a
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
