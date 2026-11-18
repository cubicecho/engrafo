import { useQuery } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { graphql } from '@/__generated__';
import { MergeSuggestionBand } from '@/__generated__/graphql';
import { MERGE_SUGGESTION_DEFAULTS } from '@/defaults';

// Documents that look like one scan filed as several, as the sidebar's badge, the suggested
// merges page and the document page read them. The server writes them in the background, about a
// minute after a batch settles, so the badge polls slowly as well as being refetched by name after
// a merge, a dismissal or a rescore.

export const MergeSuggestionCountQuery = graphql(`
  query MergeSuggestionCount {
    mergeSuggestions {
      count
    }
  }
`);

/** The Apollo names to refetch after a write that changes which suggestions are shown. */
export const MERGE_SUGGESTION_QUERY_NAMES = [
  'MergeSuggestionCount',
  'MergeSuggestions',
  'DocumentMergeSuggestions',
] as const;

/**
 * How many suggested merges there are, for the nav row's badge. Undefined while unknown and while
 * there are none, so the row draws no badge rather than a zero.
 *
 * @param readyCount - How many of the archive's documents are ready, from the query the sidebar
 *   already polls. A change asks again at once: a document sent back through the pipeline or put
 *   in the trash takes its suggestion off the list with it.
 */
export function useMergeSuggestionCount(readyCount: number): number | undefined {
  const { data, refetch } = useQuery(MergeSuggestionCountQuery, {
    pollInterval: MERGE_SUGGESTION_DEFAULTS.countIntervalMs,
  });
  const seen = useRef(readyCount);
  useEffect(() => {
    if (seen.current === readyCount) {
      return;
    }
    seen.current = readyCount;
    // A failure leaves the last count showing; the next poll asks again.
    refetch().catch(() => undefined);
  }, [readyCount, refetch]);
  const count = data?.mergeSuggestions.count ?? 0;
  return count > 0 ? count : undefined;
}

/** What a reason the model gave, rather than a rule, names as its signal. The server says the same. */
export const AI_SIGNAL = 'ai';

/** One thing that moved a suggestion's confidence. */
export interface Reason {
  signal: string;
  text: string;
  /** Negative when it counted against. */
  points: number;
}

/** The rules' reasons, apart: what says the pages belong together and what says they do not. */
export interface RuleReasons {
  /** The strongest first. */
  supporting: Reason[];
  /** The strongest first. */
  opposing: Reason[];
}

/**
 * The rules' reasons for and against, each strongest first. The model's are left out: its part is
 * said once, by {@link modelSummary}.
 *
 * @param reasons - What the suggestion holds, in any order.
 */
export function ruleReasons(reasons: readonly Reason[]): RuleReasons {
  const rules = reasons.filter((reason) => reason.signal !== AI_SIGNAL);
  return {
    supporting: rules.filter((reason) => reason.points > 0).sort((a, b) => b.points - a.points),
    opposing: rules.filter((reason) => reason.points < 0).sort((a, b) => a.points - b.points),
  };
}

/** What the model said about one break between two pages. */
export interface Verdict {
  continues: boolean;
  reason: string;
}

/**
 * The model's part in a suggestion, in one line: `rules 72% · AI confirmed: the sentence runs on`.
 *
 * @param heuristicConfidence - How sure the rules alone were, 0 to 1.
 * @param verdicts - The model's answers, one per break it was asked about.
 * @returns The line, or null when the model checked nothing, so nothing is drawn.
 */
export function modelSummary(heuristicConfidence: number, verdicts: readonly Verdict[]): string | null {
  const [only] = verdicts;
  if (only === undefined) {
    return null;
  }
  const rules = `rules ${formatPercent(heuristicConfidence)}`;
  if (verdicts.length === 1) {
    const said = only.continues ? 'AI confirmed' : 'AI doubted';
    return only.reason === '' ? `${rules} · ${said}` : `${rules} · ${said}: ${only.reason}`;
  }
  const doubted = verdicts.filter((verdict) => verdict.continues === false).length;
  return doubted === 0
    ? `${rules} · AI confirmed all ${verdicts.length} page breaks`
    : `${rules} · AI doubted ${doubted} of ${verdicts.length} page breaks`;
}

const BAND_LABELS: Record<MergeSuggestionBand, string> = {
  [MergeSuggestionBand.High]: 'High',
  [MergeSuggestionBand.Medium]: 'Medium',
  [MergeSuggestionBand.Low]: 'Low',
};

/**
 * A suggestion's band and confidence in words: `High · 92%`.
 *
 * @param band - The server's band.
 * @param confidence - 0 to 1.
 */
export function bandLabel(band: MergeSuggestionBand, confidence: number): string {
  return `${BAND_LABELS[band]} · ${formatPercent(confidence)}`;
}

/**
 * A confidence as a whole percentage: `0.874` is `87%`.
 *
 * @param confidence - 0 to 1.
 */
export function formatPercent(confidence: number): string {
  const PERCENT = 100;
  return `${Math.round(confidence * PERCENT)}%`;
}
