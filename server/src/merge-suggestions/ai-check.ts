import { FinishReason } from '@cubicecho/agent-core';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, documents, type MergeSuggestion } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { createLimiter } from '../core/limiter.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { readTextEnd, readTextStart } from '../pipeline/content.ts';
import type { StorageSet } from '../storage/s3.ts';
import { notTrashed } from '../trash/trash.ts';
import { askTextQuestion } from '../vision/ask.ts';
import { loadVisionConfig, type VisionConfig } from '../vision/settings.ts';
import type { MergeLink } from './group.ts';
import {
  type ContinuationAnswer,
  continuationPrompt,
  JUDGE_CONTINUATION,
  parseContinuationAnswer,
  type StepSide,
} from './prompt.ts';
import { type AskedSuggestion, loadOpenSuggestions, recordVerdict } from './store.ts';
import { isSameStep, type MergeVerdict } from './verdicts.ts';

// The model confirms or doubts the steps the rules are unsure of, when the admin has one set up.
// It is the vision model, asked in words: the end of one document's text and the start of the
// next. It runs after a rescore, in the background, and never decides alone: an answer moves a
// step's confidence, and no answer (the endpoint down, a reply cut off or unreadable) leaves the
// rules' score standing. A step it failed on waits `aiRetryMinutes` before it is asked again, so
// an endpoint that is down is not asked on every rescore.

/** What the model check reads and writes. */
export interface AiCheckDeps {
  db: DB;
  storage: StorageSet;
  /**
   * When the model last failed on each step, by `stepKey`. Held by the suggester across passes;
   * in memory, because a restart is reason enough to ask again.
   */
  failedSteps: Map<string, Date>;
}

/** When a pass is, what it is tuned by, and how it is told to stop. */
export interface AiCheckOptions {
  /** The moment the pass runs at, for the retry wait and each verdict's `checkedAt`. */
  now?: Date;
  settings?: MergeSuggestionSettings;
  log?: (message: string) => void;
  /** Aborted on shutdown: no step is asked after it, and one being asked is abandoned. */
  signal?: AbortSignal;
}

/** What a pass did, as counts, for the log. */
export interface AiCheckResult {
  /** Steps the model was asked about. */
  asked: number;
  /** Answers written to their suggestion. */
  recorded: number;
}

/** One step the model is to be asked about, and the suggestion its answer goes to. */
export interface StepQuestion {
  suggestion: AskedSuggestion;
  link: MergeLink;
}

/** What became of one question. */
type StepOutcome = 'skipped' | 'failed' | 'unwritten' | 'recorded';

const NOTHING_ASKED: AiCheckResult = { asked: 0, recorded: 0 };

/**
 * The key a step's failure is remembered by.
 *
 * @param step - A link or a verdict.
 * @returns Its two ids, in order.
 */
export function stepKey(step: Pick<MergeLink, 'fromId' | 'toId'>): string {
  return `${step.fromId}>${step.toId}`;
}

/**
 * The steps worth asking the model about. Pure.
 *
 * @param suggestions - The user's open, shown suggestions.
 * @param failedSteps - When the model last failed on each step.
 * @param now - The moment the pass runs at.
 * @param settings - `aiBand` and `aiRetryMinutes`.
 * @returns Every step whose rules score is within `aiBand`, that has no verdict, and that the
 *   model did not fail on within the last `aiRetryMinutes`.
 */
export function stepsToAsk(
  suggestions: readonly Pick<MergeSuggestion, 'id' | 'memberKey' | 'links' | 'aiVerdicts'>[],
  failedSteps: ReadonlyMap<string, Date>,
  now: Date,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): StepQuestion[] {
  const retryMs = settings.aiRetryMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
  return suggestions.flatMap((suggestion) =>
    suggestion.links
      .filter((link) => {
        const isUnsure = link.heuristic >= settings.aiBand.min && link.heuristic <= settings.aiBand.max;
        const isAnswered = suggestion.aiVerdicts.some((verdict) => isSameStep(verdict, link));
        const failedAt = failedSteps.get(stepKey(link));
        const isWaitingToRetry = failedAt !== undefined && now.getTime() - failedAt.getTime() < retryMs;
        return isUnsure && isAnswered === false && isWaitingToRetry === false;
      })
      .map((link) => ({ suggestion: { id: suggestion.id, memberKey: suggestion.memberKey }, link })),
  );
}

/**
 * Asks the model about one user's unsure steps and stores its answers.
 *
 * @param deps - The database, the buckets and the failures remembered so far.
 * @param userId - Whose suggestions. Nobody else's rows or documents are read.
 * @param options - The moment, the settings, the log and the stop signal.
 * @returns How many steps were asked about and how many answers were written. Nothing is asked
 *   when no model is set up.
 */
export async function checkUser(
  deps: AiCheckDeps,
  userId: string,
  options: AiCheckOptions = {},
): Promise<AiCheckResult> {
  const { now = new Date(), settings = MERGE_SUGGESTION_DEFAULTS, log = console.log, signal } = options;
  // Read per pass, as the pipeline reads it per run, so a model set up or changed in Settings
  // reaches the next pass.
  const vision = await loadVisionConfig(deps.db);
  if (vision === null) {
    return NOTHING_ASKED;
  }
  const suggestions = await loadOpenSuggestions(deps.db, userId, settings);
  const questions = stepsToAsk(suggestions, deps.failedSteps, now, settings);
  if (questions.length === 0) {
    return NOTHING_ASKED;
  }

  const docs = await loadStepDocuments(deps.db, userId, questions);
  const pass: Pass = { deps, userId, vision, docs, now, settings, log, signal };
  const limit = createLimiter(settings.aiConcurrency);
  const outcomes = await Promise.all(questions.map((question) => limit(() => askStep(pass, question))));
  return {
    asked: outcomes.filter((outcome) => outcome !== 'skipped').length,
    recorded: outcomes.filter((outcome) => outcome === 'recorded').length,
  };
}

/** What every question in one pass shares. */
interface Pass {
  deps: AiCheckDeps;
  userId: string;
  vision: VisionConfig;
  docs: ReadonlyMap<string, Document>;
  now: Date;
  settings: MergeSuggestionSettings;
  log: (message: string) => void;
  signal: AbortSignal | undefined;
}

/** The documents either side of each step, the user's and filed. */
async function loadStepDocuments(
  db: DB,
  userId: string,
  questions: readonly StepQuestion[],
): Promise<Map<string, Document>> {
  const ids = [...new Set(questions.flatMap(({ link }) => [link.fromId, link.toId]))];
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), inArray(documents.id, ids), notTrashed()));
  return new Map(rows.map((row) => [row.id, row]));
}

async function askStep(pass: Pass, { suggestion, link }: StepQuestion): Promise<StepOutcome> {
  if (pass.signal?.aborted) {
    return 'skipped';
  }
  const first = pass.docs.get(link.fromId);
  const second = pass.docs.get(link.toId);
  // The question is whether one text runs on into the other: with a side that has none, the
  // rules, which read the file names and times as well, are all there is to go on.
  if (!first?.contentKey || !first.contentBytes || !second?.contentKey) {
    return 'skipped';
  }

  let answer: ContinuationAnswer;
  try {
    const { text } = pass.deps.storage;
    const chars = pass.settings.aiContextChars;
    const [tail, head] = await Promise.all([
      readTextEnd(text, first.contentKey, first.contentBytes, chars),
      readTextStart(text, second.contentKey, chars),
    ]);
    answer = await judgeStep(pass, stepSide(first, tail), stepSide(second, head));
  } catch (error) {
    if (pass.signal?.aborted) {
      return 'skipped';
    }
    pass.deps.failedSteps.set(stepKey(link), pass.now);
    pass.log(
      `[merge-suggestions] The model did not judge whether ${second.id} continues ${first.id}: ${errorMessage(error)}. The rules' score stands; asked again after ${pass.settings.aiRetryMinutes} minutes.`,
    );
    return 'failed';
  }
  pass.deps.failedSteps.delete(stepKey(link));

  const verdict: MergeVerdict = {
    fromId: link.fromId,
    toId: link.toId,
    ...answer,
    model: pass.vision.model,
    checkedAt: pass.now.toISOString(),
  };
  const written = await recordVerdict(pass.deps.db, pass.userId, suggestion, verdict, pass.settings);
  return written ? 'recorded' : 'unwritten';
}

function stepSide(doc: Document, text: string): StepSide {
  return { title: doc.title, originalFilename: doc.originalFilename, text };
}

/**
 * Asks the model whether `second` continues `first`.
 *
 * @throws When the model does not answer, its reply hit the token limit, or no answer can be read
 *   from it.
 */
async function judgeStep(pass: Pass, first: StepSide, second: StepSide): Promise<ContinuationAnswer> {
  const reply = await askTextQuestion(pass.vision, JUDGE_CONTINUATION, continuationPrompt(first, second), {
    maxTokens: pass.settings.aiMaxResponseTokens,
    maxTimeoutSeconds: pass.settings.aiRequestTimeoutSeconds,
    onNotice: (message) => pass.log(`[merge-suggestions] ${message}`),
    signal: pass.signal,
  });
  // A yes or no with a few words is short, so a reply that ran into the limit is a model that
  // looped or never stopped thinking, and whatever it wrote is not its answer.
  if (reply.finishReason === FinishReason.Length) {
    throw new Error(`it hit the reply limit of ${pass.settings.aiMaxResponseTokens} tokens`);
  }
  const answer = parseContinuationAnswer(reply.text, pass.settings);
  if (answer === null) {
    throw new Error('no answer could be read from its reply');
  }
  return answer;
}
