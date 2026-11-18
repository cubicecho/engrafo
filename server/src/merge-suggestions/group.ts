import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_HOUR } from '../core/wire.ts';
import { isCandidatePair, type MergeCandidate, pageStart, seriesPlace } from './features.ts';
import { confidenceBand, type MergeBand, type MergeReason, scorePair } from './score.ts';

// From scored pairs to suggestions. Every pair close enough to compare is scored both ways round,
// and the better way is the link when it clears `minConfidence`. Linked documents form a group,
// put in page order, and the group is only as sure as its weakest step in that order: one wrong
// page breaks the whole merge.

/** One step of a group, in its order. */
export interface MergeLink {
  fromId: string;
  toId: string;
  /** The rules' confidence (0–1) that `toId` continues `fromId`. */
  heuristic: number;
}

/** Documents that look like one scan filed as several, and how sure that is. */
export interface MergeGroup {
  /** In page order: the order a merge would put them in. */
  documentIds: string[];
  /** The weakest of `links`. */
  confidence: number;
  band: MergeBand;
  /** Every reason from every step, each once, the strongest for first. */
  reasons: MergeReason[];
  /** Each adjacent pair's confidence, in page order: one fewer than `documentIds`. */
  links: MergeLink[];
}

/**
 * Groups candidates into suggested merges.
 *
 * @param candidates - Recent documents, in any order.
 * @param settings - The window, the cutoffs and the weights.
 * @returns The groups whose every adjacent step clears `minConfidence`, the surest first.
 */
export function groupCandidates(
  candidates: readonly MergeCandidate[],
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): MergeGroup[] {
  const linked = linkedSets(candidates, settings);
  const groups = linked.map((members) => describeGroup(orderGroup(members, settings), settings));
  return groups
    .filter((group) => group.confidence >= settings.minConfidence)
    .sort((x, y) => y.confidence - x.confidence);
}

function linkedSets(candidates: readonly MergeCandidate[], settings: MergeSuggestionSettings): MergeCandidate[][] {
  const byTime = [...candidates].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  const windowMs = settings.pairWindowHours * SECONDS_PER_HOUR * MS_PER_SECOND;
  const neighbours = new Map<MergeCandidate, MergeCandidate[]>(byTime.map((candidate) => [candidate, []]));
  for (const [index, a] of byTime.entries()) {
    for (const b of byTime.slice(index + 1)) {
      const pastWindow = b.createdAt.getTime() - a.createdAt.getTime() > windowMs;
      if (pastWindow) {
        break;
      }
      if (isCandidatePair(a, b, settings) && bestDirection(a, b, settings) >= settings.minConfidence) {
        neighbours.get(a)?.push(b);
        neighbours.get(b)?.push(a);
      }
    }
  }
  return connectedSets(byTime, neighbours).filter((members) => members.length > 1);
}

// Filing order is not page order (a browser uploads a folder in any order), so either document
// may be the one that continues the other.
function bestDirection(a: MergeCandidate, b: MergeCandidate, settings: MergeSuggestionSettings): number {
  return Math.max(scorePair(a, b, settings).confidence, scorePair(b, a, settings).confidence);
}

function connectedSets(
  candidates: readonly MergeCandidate[],
  neighbours: ReadonlyMap<MergeCandidate, readonly MergeCandidate[]>,
): MergeCandidate[][] {
  const seen = new Set<MergeCandidate>();
  const sets: MergeCandidate[][] = [];
  for (const start of candidates) {
    if (seen.has(start)) {
      continue;
    }
    const members: MergeCandidate[] = [];
    const pending = [start];
    seen.add(start);
    for (let next = pending.pop(); next; next = pending.pop()) {
      members.push(next);
      const unseen = (neighbours.get(next) ?? []).filter((neighbour) => seen.has(neighbour) === false);
      for (const neighbour of unseen) {
        seen.add(neighbour);
        pending.push(neighbour);
      }
    }
    sets.push(members);
  }
  return sets;
}

/**
 * Puts a group in page order: by the pages they print, then by their place in a file-name series,
 * then by when they were filed.
 *
 * @param members - The group, in any order.
 * @param settings - `maxPageTotal`, for reading page markers.
 * @returns A new array, in order.
 */
export function orderGroup(
  members: readonly MergeCandidate[],
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): MergeCandidate[] {
  const byPage = (x: MergeCandidate, y: MergeCandidate) => {
    const first = pageStart(x, settings);
    const second = pageStart(y, settings);
    return first && second ? first.page - second.page : 0;
  };
  const bySeries = (x: MergeCandidate, y: MergeCandidate) => {
    const place = seriesPlace(x.originalFilename, y.originalFilename);
    return place ? place.first - place.second : 0;
  };
  const byFiling = (x: MergeCandidate, y: MergeCandidate) => x.createdAt.getTime() - y.createdAt.getTime();
  return [...members].sort((x, y) => byPage(x, y) || bySeries(x, y) || byFiling(x, y) || x.id.localeCompare(y.id));
}

function describeGroup(ordered: readonly MergeCandidate[], settings: MergeSuggestionSettings): MergeGroup {
  const steps = ordered.slice(1).map((b, index) => {
    const a = ordered[index];
    return { a, b, score: scorePair(a, b, settings) };
  });
  const links = steps.map(({ a, b, score }) => ({ fromId: a.id, toId: b.id, heuristic: score.confidence }));
  const confidence = Math.min(...links.map((link) => link.heuristic));
  const reasonsByText = new Map(steps.flatMap(({ score }) => score.reasons).map((reason) => [reason.text, reason]));
  return {
    documentIds: ordered.map((candidate) => candidate.id),
    confidence,
    band: confidenceBand(confidence, settings),
    reasons: [...reasonsByText.values()].sort((x, y) => y.points - x.points),
    links,
  };
}
