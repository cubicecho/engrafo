# Plan: suggested merges for split scans

A scanner or phone often files one document as several: one file per page, or
front and back apart. Engrafo notices them and suggests merging, with a
confidence and the reasons for it. **Nothing merges without a person pressing
Merge** in the existing `MergeDocumentsDialog`.

## Decisions

- **Main case: split multi-page scans.** "B continues A" counts, not "A and B
  are about the same thing". So time, filename sequence and continuity markers
  carry the weight, and embedding similarity is a weak signal.
- **Suggest only.** No automatic merges, and originals are never touched
  without asking.
- **The model confirms the uncertain ones.** When the admin has a model set up,
  it checks the groups whose heuristic score falls in the middle band. Without
  a model, the heuristics decide alone.
- **Placement:** a sidebar nav entry with a badge, and an alert on the document
  page.
- **Stored, not computed on read.** The badge and the document alert need an
  answer that is quick to read and stays the same between reads, and model
  checks cannot run on every badge read. So a background suggester writes rows.
- **Not a pipeline step.** A new step would send every finished document back
  through `catchUp()`, and the job looks across many documents, not at one.

## 1. Scoring (pure): `server/src/merge-suggestions/`

Two documents are only compared as a candidate pair when both are mergeable (PDF or image), `ready` and not
trashed (`notTrashed()`), filed within `pairWindowHours` of each other, and in
the same folder (a different folder counts strongly against).

| Signal | Points toward "B continues A" | Points against |
|---|---|---|
| Time gap | seconds or minutes apart | hours apart |
| Filename sequence | same stem, number one higher (`scan_0003` → `scan_0004`, `IMG_1234` → `IMG_1235`) | unrelated names |
| Page markers | "Page 2 of 3" after "Page 1 of 3" | B says "Page 1 of …" |
| Shared identifiers | same invoice, account or reference number | — |
| Metadata | A has a `documentDate` or `vendor` and B has none | both have a different extracted date or vendor |
| Text flow | A ends mid-sentence, B starts lowercase | B opens with a letterhead or date |
| Embedding cosine (mean of `document_chunks`) | weak plus | only a very low value counts against |

- The weighted points go through a logistic function to give a 0–1 confidence.
  Weights and cutoffs live in `MERGE_SUGGESTION_DEFAULTS` in `core/defaults.ts`.
- Pairs at or above `minConfidence` become links, and each connected group is
  one suggestion.
- Within a group, the order comes from page markers, then filename number, then
  `createdAt`.
- A group's confidence is its **weakest adjacent link**, because one bad page
  breaks the whole merge.
- Every signal that fired becomes a reason shown in the UI: "scanned 40 s
  apart", "same invoice no. 10432", "page 2 of 3".

Suggested layout: `features.ts` (signal extraction), `score.ts` (weights →
confidence + reasons), `group.ts` (links → ordered groups).

## 2. AI confirmation (only when a model is set up)

- For each adjacent pair whose score is in `aiBand`, the model gets the last
  `aiContextChars` of A and the first `aiContextChars` of B.
- It answers in JSON: `{ continues, confidence, reason }`. That answer moves the
  confidence and adds a reason.
- It uses the same `askReply` path as the merge title suggestion (`loadVisionConfig`,
  same key and base-URL rules), run in the background under a concurrency
  limit.
- If the model call fails, the heuristic score stands, so a model problem never
  hides a suggestion. Each answer is cached on the suggestion row
  (`ai_checked`).

As built (step 3, "option B"): the rules' side and the model's are stored apart
and combined on write, so a rescore no longer erases the model's contribution.

- `links` holds each adjacent step's rules score (`{ fromId, toId, heuristic }`,
  `MergeLink.confidence` renamed `heuristic`), `ai_verdicts` the model's answers
  (`{ fromId, toId, continues, confidence, reason, model, checkedAt }`).
  `heuristic_confidence`, `confidence` and `reasons` are derived by
  `combineScores` (`verdicts.ts`) and written with them. `ai_checked` is dropped:
  it is `ai_verdicts` being non-empty, and nothing read it.
- A step's combined confidence is `logistic(logit(heuristic) ± aiWeight ×
  verdict.confidence)`, `aiWeight` 3 (as strong as a printed page marker); the
  group's is the weakest step. Each verdict adds a reason, `AI: page 2 continues
  page 1 (the sentence runs on)` or `… does not continue …`, with the points it
  added.
- A verdict holds while its two documents are adjacent in that order. `reconcile`
  gives every group the verdicts of the open rows it replaces whose step it still
  has. Deviation from "a new row starts with no verdicts": a set that gained or
  lost a page is a new row (its `member_key` changed), and it keeps the verdicts
  of the steps it still has, which is what keeping a verdict while the pair is
  adjacent means. A set with no open predecessor starts with none; a dismissed
  row's verdicts are not carried.
- A rejected group (combined confidence under `minConfidence`) stays an open row,
  hidden by `isShown()` in `loadOpenSuggestions`. Deleted, the next rescore would
  insert it afresh and ask again on every rescore; kept, its verdict is there each
  time the rules find it. **Step 4's generated reads must apply `isShown()` too.**
- `checkUser` (`ai-check.ts`) runs after each rescore: steps of shown suggestions
  within `aiBand` with no verdict, both sides with text, under `aiConcurrency`.
  The prompt and parser are `prompt.ts` (`JUDGE_CONTINUATION`,
  `continuationPrompt`, `parseContinuationAnswer` on agent-core's `parseJson`).
  The call is `askTextQuestion` (`vision/ask.ts`), shared with the title
  suggestion. A failure, a reply at `aiMaxResponseTokens` or one with no answer
  is a log line and no verdict, remembered per step in memory for
  `aiRetryMinutes`. `recordVerdict` writes conditionally in a transaction holding
  the row; `rescoreUser` now reads its rows `FOR UPDATE`. `stop()` aborts the
  questions and waits for the pass.

## 3. Storage: `merge_suggestions`

Columns: `id`, `user_id`, `document_ids uuid[]` (in page order), `member_key`
(the ids sorted and joined, unique per user: one identity per set whatever its
order), `confidence`, `reasons jsonb`, `ai_checked` (since step 3: `links`,
`ai_verdicts` and `heuristic_confidence` in its place), `status` (`open` /
`dismissed` / `merged`), `created_at`, `updated_at`.

As built (step 2): `rescoreUser` in `store.ts` reconciles through the pure
`reconcile`. An open set found again is updated, a new one inserted open, an
open one not found deleted, and a dismissed or merged one left alone.
`loadOpenSuggestions` (through `membersAreLive()`) is the read that leaves out a
row gone stale between runs.

- Open rows are deleted when not proposed, so an open suggestion whose members
  have aged out of `lookbackDays` goes on the next rescore, even if nothing
  about it changed. If that proves annoying, keep open rows whose members are
  all older than the lookback.
- Step 3 resolved this: the heuristic score has its own columns (`links`,
  `heuristic_confidence`) and a rescore re-applies the stored verdicts; the model
  is asked again only about a step that has none.
- Trashing a member does not wake the suggester; the row is stale until the
  next rescore, which is why reads go through `membersAreLive()`.

- Gets a `scope` entry in `tenancy.ts` (`tenancy.test.ts` enforces it), and reads
  come from the generated schema.
- Reads leave out any suggestion with a member that has since been trashed,
  merged or deleted.
- A dismissed member set is never proposed again. A *different* set is (for
  example, a third page arrived later).
- `mergeDocuments` marks a suggestion `merged` when its members were merged.

## 4. The suggester

- The runner emits an event when a run finishes. The suggester waits per user,
  restarting a `quietSeconds` timer on each event, then rescores that user's
  documents from the last `lookbackDays`. A whole scan batch is scored once,
  after its last page is in.
- At boot it runs once for any user with documents finished since its last
  run, so a restart loses nothing. `stopOnSignals` stops it beside the watcher
  and the trash purger.
  - As built: no last-run time is kept. `catchUp()` rescores every user with a
    mergeable `ready` document created within `lookbackDays`. It is stateless,
    and a rescore is cheap: a few rows, the ends of a few texts, one `avg`.
- As built: the event is `document.processed` (`{ documentId, userId, status }`,
  ready or failed), emitted by the runner where it settles a document. Failed
  counts too, because a document that fails a re-run has left the candidates.
  One rescore runs at a time per user, and one asked for meanwhile runs once
  after it. Text reads are bounded by `textReadConcurrency`.
- Its log lines start with `[merge-suggestions]`.

## 5. API

- Generated reads of `mergeSuggestions`.
- `dismissMergeSuggestion(id)`.
- `rescoreMergeSuggestions` (to rescore by hand while debugging and tuning).
- Every read of `documents` uses `notTrashed()`, and anyone else's ids answer
  `NOT_FOUND`.

## 6. UI

- **Sidebar:** a "Suggested merges" entry in `NAV_ITEMS`. Its badge counts open
  suggestions and is refetched by name after a merge or dismissal, as Trash's
  is. It also refetches when the archive's ready count changes, which the
  sidebar already polls.
- **Page:** a route in `main.tsx` with one card per suggestion: thumbnails in
  order, a confidence band with its %, the reasons, and an "AI checked" mark.
  - **Review merge** opens `MergeDocumentsDialog` already filled in with the
    group in order, with the AI title suggestion button there.
  - **Dismiss** records the dismissal.
- **Document page:** an alert above the tabs, e.g. "This may be part of a
  3-page scan with *scan_0004* (87%) · Review merge".

## 7. Tests and docs

- Scorer fixtures: true splits, a letter and its envelope, two unrelated
  receipts scanned back to back (the hard negative), and a front and back pair.
- Suggester tests on PGlite: debounce, dismissal memory, invalidation on trash
  and merge, catch-up at boot.
- Stories with `play` for the page, the badge and the document alert.
- A CLAUDE.md paragraph in the file's voice.

## Defaults (agreed)

| Field | Value |
|---|---|
| `lookbackDays` | 14 |
| `pairWindowHours` | 6 |
| `quietSeconds` | 60 |
| `minConfidence` | 0.5 |
| `highBand` | 0.85 |
| `mediumBand` | 0.65 (below is Low) |
| `aiBand` | 0.4–0.85 |
| `aiContextChars` | 1,500 |

Dismissals are logged with their scores, so the weights can be tuned against
real behaviour later.

## Build order

1. Scorer and its fixtures (pure, testable alone). **Done.**
2. Table, tenancy scope and the suggester. **Done.**
3. The model check. **Done** (see section 2, "As built").
4. API.
5. UI.
6. Docs.
