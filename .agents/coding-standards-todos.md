# Project Todos

Findings from the standards pass against `coding-standards`, `cubicecho_typescript`,
`cubicecho_backend` and `cubicecho_frontend`. IDs are stable — don't renumber when items are
removed. `(unverified)` marks items inferred from docs or naming rather than confirmed in code.
Nothing here is implemented until approved.

Already done on `chore/standards`: Biome 2.5.11 with the full shared rule set and the negation
plugin, braces everywhere, `tsconfig.base.json` with the standard flags, `as const` enums from
the app codegen, the npm script names, action majors, dependabot, `CLAUDE.md` as a symlink; then
M1–M5: Node 26 on `node:26-slim`, `server/src` grouped by concept with mirrored tests,
better-auth in place of the hand-rolled JWT (which also closed R4, F4, B1, B4 and A1),
GHCR published beside Docker Hub, TypeScript 7; then the approved batch — R1–R3, R5, R6, R8–R13,
F1, F2, T1, T3, B3, B6, B8, D1, A2, A3 and the `AUTH_MAGIC_LINK` part of D2.

Declined, not to be re-raised: B2 (first sign-in race under `SECURE_LOCAL_NET`), F3 (bounding
queries — the client's job), F5 (CI `postgres` and `boot` jobs), F6 (`USER node`), T4 (the empty
`dom` project). Filed as issues: F7 → cubicecho/engrafo#4, F8 → cubicecho/engrafo#5.

## Conventions

The canonical way this codebase does things. New code and refactors follow these.

- Missing lookups and failures: thrown `GraphQLError` with `extensions.code`; a row the caller
  doesn't own is `NOT_FOUND`
- Input validation: zod, in the resolver, before anything is read
- Dependencies are injected (storage, pipeline, events); no `vi.mock` of project modules
- Tests: Vitest, PGlite for the database, stories with `play` for components
- App components take slot props, token colours, and forms go through `useAppForm`
- Vendored cubeui files (`components/ui/**`, `app/src/components/*.tsx`) are not linted or edited
- Generated files and the command that rebuilds them: `server/__generated__/`,
  `app/src/__generated__/` → `npm run codegen`; `db/drizzle/` → `npm run db:generate` (committed)
- Auth is better-auth reached only through GraphQL: `createAuth(db)` on the context, sign-in
  mutations call `throttle` first, the auth tables are excluded from the schema, passwords off
- Tunables live in `server/src/core/defaults.ts`, `db/src/defaults.ts` and `app/src/defaults.ts`
  as `<CONCEPT>_DEFAULTS` / `<Concept>Settings`; only config, preflight and the db package read
  `process.env`
- The app is built by `createApp(deps)` and booted by `index.ts`; API errors come from
  `core/errors.ts` and are compared by `ErrorCode`
- Statuses are named: `DocumentStatus` / `StepStatus` in the db models, the generated enums in
  the app
- Log lines carry a `[subsystem]` tag
- AGENTS.md rules that differ from the skills and currently win: `components/{ui,layouts,domain}`
  in the app, no `.ts` extension on relative imports in `app/`, Docker Hub as the primary
  registry and the quickstart image (GHCR is published as well)

## Refactoring

### R7 [reuse] — duplicated polling effect and title validator

**File:** `routes/document.tsx`, `routes/documents.tsx` (polling effect and `POLL_MS`); the
required-title validator in two forms. One hook or helper each. Sign-out is done
(`app/src/lib/sign-out.ts`).

## Tests

### T2 [consistency] — the auth resolver tests mutate `process.env`

**File:** `server/src/__tests__/auth/resolvers.test.ts` Still sets `NODE_ENV`, `SECURE_LOCAL_NET`
and `AUTH_MAGIC_LINK` on `process.env`. Pass config in instead.

## Docs

### D2 — `.env.example` and `docker-compose.yml` gaps

`SESSION_STORE`, `TRUST_PROXY` and `SECURE_LOCAL_NET` are in; `AUTH_MAGIC_LINK` is out of both
files and marked deprecated in the README. Left, and accepted as they are for now: other missing
passthroughs, a default Postgres password in `docker-compose.yml` (`:-engrafo`), floating
`minio:latest` / `mc:latest` in all three compose files.

### D3 — stale `Narrow` story comment (unverified)

## Bugs

None open. B5, B7, B9–B13 and B15–B17 were fixed on `fix/ledger-bugs`. B14 was dropped as not a
bug: the SDL describes `authConfig.secureLocalNet` as "whether an address alone signs in, with no
link to follow", which is also true under `AUTH_MAGIC_LINK=false`, and the app does not read it.

## Low value

### R14 [consistency] — app naming

`RailLink`, `LoginPage` / `VerifyPage` beside `*Route`, bare-noun booleans, a few relative
imports where the alias is used elsewhere.

### R15 [readability] — nested ternaries and unnamed compound conditions

**File:** `app/src/components/domain/upload-panel.tsx:171`, `app/src/routes/settings.tsx:104-106`

### R16 [consistency] — token and layout nits

`bg-hover` on the drag-over state (`upload-panel.tsx:126`), arbitrary sizes, redrawn muted and
error text, wrapper divs for page-body spacing in three routes, `LogOut` imported from
`lucide-react` directly, `children` in two story helpers (P23).

### R17 [simplify] — unreferenced vendored files

`ui/alert-dialog.tsx`, `ui/item.tsx`, `ui/item-base.ts`, `ui/separator.tsx`.

### R18 [consistency] — custom `db/src/migrate.ts` (unverified against database.md)
