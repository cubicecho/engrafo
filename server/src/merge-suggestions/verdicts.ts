import type { StoredMergeReason, StoredMergeVerdict } from '@cubicecho/engrafo-db/schema';
import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import type { MergeLink } from './group.ts';
import { AI_SIGNAL, logistic, type MergeReason } from './score.ts';

// The rules' score and the model's answers are kept apart and combined on write. An answer is
// about the text of two pages either side of one break, so it holds for as long as those two stay
// adjacent in that order, however the rules' score of the step moves: a rescore replaces the
// links and keeps every verdict whose step is still one of them.

/** What the model answered about one step. */
export type MergeVerdict = StoredMergeVerdict;

/**
 * A confidence the logit can be taken of. The logistic rounds to 0 or 1 past about 37 points, and
 * the logit of either is infinite.
 */
const LOGIT_EDGE = 1e-9;

/** What a suggestion's confidence and reasons are derived from. */
export interface SuggestionSides {
  /** In page order. */
  documentIds: readonly string[];
  /** The rules' score of each step, in page order. */
  links: readonly MergeLink[];
  /** The rules' reasons, without any of the model's. */
  ruleReasons: readonly StoredMergeReason[];
  /** The model's answers; one about a step that is not in `links` is ignored. */
  verdicts: readonly MergeVerdict[];
}

/** What is written beside the two sides, so a read needs no arithmetic. */
export interface CombinedScores {
  /** The weakest step by the rules alone. */
  heuristicConfidence: number;
  /** The weakest step once each verdict has moved its own. */
  confidence: number;
  /** The rules' reasons and one per verdict, the strongest for first. */
  reasons: StoredMergeReason[];
}

/**
 * Whether a verdict and a link are about the same step, in the same direction.
 *
 * @param step - A link or a verdict.
 * @param other - Another.
 * @returns True when both go from the same document to the same document.
 */
export function isSameStep(
  step: Pick<MergeLink, 'fromId' | 'toId'>,
  other: Pick<MergeLink, 'fromId' | 'toId'>,
): boolean {
  return step.fromId === other.fromId && step.toId === other.toId;
}

/**
 * The verdicts that still apply to a suggestion's steps.
 *
 * @param links - The steps as they are now.
 * @param verdicts - Answers given about any steps, this suggestion's or one it replaces.
 * @returns Those whose step is one of `links`, one per step.
 */
export function verdictsForLinks(links: readonly MergeLink[], verdicts: readonly MergeVerdict[]): MergeVerdict[] {
  return links.flatMap((link) => {
    const verdict = verdicts.find((each) => isSameStep(each, link));
    return verdict ? [verdict] : [];
  });
}

/**
 * A suggestion's verdicts with one more, if it still has a step for it.
 *
 * @param links - The suggestion's steps as stored now.
 * @param verdicts - Its verdicts as stored now.
 * @param verdict - The answer to add.
 * @returns The verdicts with it; null when its step is no longer one of `links`, or already has
 *   an answer, which a write that raced this one gave.
 */
export function addVerdict(
  links: readonly MergeLink[],
  verdicts: readonly MergeVerdict[],
  verdict: MergeVerdict,
): MergeVerdict[] | null {
  const isStillAStep = links.some((link) => isSameStep(link, verdict));
  const isAnswered = verdicts.some((each) => isSameStep(each, verdict));
  if (isStillAStep === false || isAnswered) {
    return null;
  }
  return [...verdicts, verdict];
}

/**
 * The points a verdict adds to its step: the model's confidence times `aiWeight`, against the
 * step when the model says it does not continue.
 *
 * @param verdict - The answer.
 * @param settings - `aiWeight`.
 * @returns Points, in the scorer's units.
 */
export function verdictPoints(
  verdict: Pick<MergeVerdict, 'continues' | 'confidence'>,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): number {
  const strength = settings.aiWeight * verdict.confidence;
  return verdict.continues ? strength : -strength;
}

/**
 * Moves the rules' confidence in a step by the model's answer, in logit space, so a verdict adds
 * points as a signal does and a step already near 0 or 1 moves less in confidence.
 *
 * @param heuristic - The rules' confidence (0–1).
 * @param verdict - The model's answer, or undefined when there is none.
 * @param settings - `aiWeight`.
 * @returns `logistic(logit(heuristic) ± aiWeight × verdict.confidence)`; `heuristic` with no verdict.
 */
export function combinedStepConfidence(
  heuristic: number,
  verdict: Pick<MergeVerdict, 'continues' | 'confidence'> | undefined,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): number {
  if (!verdict) {
    return heuristic;
  }
  return logistic(logit(heuristic) + verdictPoints(verdict, settings));
}

function logit(confidence: number): number {
  const bounded = Math.min(Math.max(confidence, LOGIT_EDGE), 1 - LOGIT_EDGE);
  return Math.log(bounded / (1 - bounded));
}

/**
 * The words a verdict is shown in: `AI: page 2 continues page 1 (the sentence runs on)`.
 *
 * @param verdict - The answer.
 * @param documentIds - The suggestion's members in page order, which number the pages.
 * @param settings - `aiWeight`, for the points.
 * @returns The reason, its points those the verdict added to its step.
 */
export function verdictReason(
  verdict: MergeVerdict,
  documentIds: readonly string[],
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): MergeReason {
  const from = documentIds.indexOf(verdict.fromId) + 1;
  const to = documentIds.indexOf(verdict.toId) + 1;
  const relation = verdict.continues ? 'continues' : 'does not continue';
  const why = verdict.reason ? ` (${verdict.reason})` : '';
  return {
    signal: AI_SIGNAL,
    text: `AI: page ${to} ${relation} page ${from}${why}`,
    points: verdictPoints(verdict, settings),
  };
}

/**
 * Combines the rules' side of a suggestion with the model's. The suggestion is as sure as its
 * weakest step, as before, now counting each step's verdict.
 *
 * @param sides - The members, the links, the rules' reasons and the verdicts.
 * @param settings - `aiWeight`.
 * @returns The confidences and reasons to store.
 */
export function combineScores(
  { documentIds, links, ruleReasons, verdicts }: SuggestionSides,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): CombinedScores {
  const applying = verdictsForLinks(links, verdicts);
  const combined = links.map((link) =>
    combinedStepConfidence(
      link.heuristic,
      applying.find((verdict) => isSameStep(verdict, link)),
      settings,
    ),
  );
  const reasons = [...ruleReasons, ...applying.map((verdict) => verdictReason(verdict, documentIds, settings))];
  return {
    heuristicConfidence: Math.min(...links.map((link) => link.heuristic)),
    confidence: Math.min(...combined),
    reasons: reasons.sort((x, y) => y.points - x.points),
  };
}

/**
 * The rules' reasons among a stored suggestion's, which hold the model's too.
 *
 * @param reasons - What the row stores.
 * @returns Those that are not a verdict's.
 */
export function ruleReasonsOf(reasons: readonly StoredMergeReason[]): StoredMergeReason[] {
  return reasons.filter((reason) => reason.signal !== AI_SIGNAL);
}
