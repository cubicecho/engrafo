import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { type MergeCandidate, type PairSignals, readSignals, type Signal } from './features.ts';

// The signals, weighed: each kind a signal reports adds or takes its points from
// `MERGE_SUGGESTION_DEFAULTS.weights`, starting from the bias, and a logistic turns the sum into a
// confidence between 0 and 1. Points rather than rules, so no one signal decides alone and each
// one that fired is a reason the person deciding can read.

/** The signals by name. */
export type MergeSignalName = keyof PairSignals;

/** One signal that moved a pair's confidence, as the UI shows it. */
export interface MergeReason {
  signal: MergeSignalName;
  /** For the person deciding: `scanned 40 s apart`, `same invoice no. 10432`. */
  text: string;
  /** What it added; negative when it counts against. */
  points: number;
}

/** How sure the scorer is that B continues A. */
export interface PairScore {
  /** Between 0 and 1. */
  confidence: number;
  /** The sum the confidence was read from, bias included. */
  points: number;
  /** Every signal that moved it, the strongest for first and the strongest against last. */
  reasons: MergeReason[];
}

/** How a confidence is shown. */
export type MergeBand = 'high' | 'medium' | 'low';

function weigh<Kind extends string>(
  signal: MergeSignalName,
  found: Signal<Kind>,
  table: Readonly<Record<Kind, number>>,
): { signal: MergeSignalName; reason: string | null; points: number } {
  return { signal, reason: found.reason, points: table[found.kind] };
}

/**
 * Weighs signals already read.
 *
 * @param signals - What `readSignals` found for the pair.
 * @param settings - The weights.
 * @returns The confidence and the reasons behind it.
 */
export function scoreSignals(
  signals: PairSignals,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): PairScore {
  const { weights } = settings;
  const weighed = {
    timeGap: weigh('timeGap', signals.timeGap, weights.timeGap),
    filename: weigh('filename', signals.filename, weights.filename),
    pageMarkers: weigh('pageMarkers', signals.pageMarkers, weights.pageMarkers),
    identifiers: weigh('identifiers', signals.identifiers, weights.identifiers),
    documentDate: weigh('documentDate', signals.documentDate, weights.documentDate),
    vendor: weigh('vendor', signals.vendor, weights.vendor),
    textFlow: weigh('textFlow', signals.textFlow, weights.textFlow),
    embedding: weigh('embedding', signals.embedding, weights.embedding),
  } satisfies Record<MergeSignalName, unknown>;
  const all = Object.values(weighed);
  const points = all.reduce((sum, { points: each }) => sum + each, weights.bias);
  const reasons = all
    .flatMap(({ signal, reason, points: each }) =>
      reason && each !== 0 ? [{ signal, text: reason, points: each }] : [],
    )
    .sort((x, y) => y.points - x.points);
  return { confidence: logistic(points), points, reasons };
}

/**
 * Scores "B continues A".
 *
 * @param a - The document that would come first.
 * @param b - The document that would follow it.
 * @param settings - The cutoffs and weights.
 * @returns The confidence and the reasons behind it.
 */
export function scorePair(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): PairScore {
  return scoreSignals(readSignals(a, b, settings), settings);
}

function logistic(points: number): number {
  return 1 / (1 + Math.exp(-points));
}

/**
 * The band a confidence is shown in.
 *
 * @param confidence - Between 0 and 1.
 * @param settings - `highBand` and `mediumBand`.
 * @returns `high`, `medium` or `low`.
 */
export function confidenceBand(
  confidence: number,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): MergeBand {
  if (confidence >= settings.highBand) {
    return 'high';
  }
  return confidence >= settings.mediumBand ? 'medium' : 'low';
}
