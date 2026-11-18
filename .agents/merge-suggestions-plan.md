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

## 3. Storage: `merge_suggestions`

Columns: `id`, `user_id`, `document_ids uuid[]` (in page order), `confidence`,
`reasons jsonb`, `ai_checked`, `status` (`open` / `dismissed` / `merged`),
`created_at`, `updated_at`.

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

1. Scorer and its fixtures (pure, testable alone).
2. Table, tenancy scope and the suggester.
3. The model check.
4. API.
5. UI.
6. Docs.
