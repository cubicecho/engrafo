import { MergeSuggestionStatus } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import type { MergeGroup } from '../../merge-suggestions/group.ts';
import { memberKey, reconcile, type StoredSuggestion } from '../../merge-suggestions/store.ts';
import type { MergeVerdict } from '../../merge-suggestions/verdicts.ts';

/** A group of the ids given, in that page order, each step at 0.7. */
const group = (...documentIds: string[]): MergeGroup => ({
  documentIds,
  confidence: 0.7,
  band: 'medium',
  reasons: [],
  links: documentIds.slice(1).map((toId, index) => ({ fromId: documentIds[index], toId, heuristic: 0.7 })),
});

const stored = (
  id: string,
  members: string[],
  status: StoredSuggestion['status'],
  aiVerdicts: MergeVerdict[] = [],
): StoredSuggestion => ({ id, memberKey: memberKey(members), status, aiVerdicts });

const verdict = (fromId: string, toId: string): MergeVerdict => ({
  fromId,
  toId,
  continues: true,
  confidence: 0.9,
  reason: 'the sentence runs on',
  model: 'test-vlm',
  checkedAt: '2026-11-18T09:00:00.000Z',
});

describe('memberKey', () => {
  it('is the same set whatever the page order', () => {
    expect(memberKey(['c', 'a', 'b'])).toBe(memberKey(['a', 'b', 'c']));
    expect(memberKey(['a', 'b'])).not.toBe(memberKey(['a', 'b', 'c']));
  });
});

describe('reconcile', () => {
  it('inserts a set never suggested before, with no verdicts', () => {
    const plan = reconcile([], [group('a', 'b')]);
    expect(plan).toEqual({ inserts: [{ group: group('a', 'b'), verdicts: [] }], updates: [], deletes: [] });
  });

  it('updates an open set found again, in its new order', () => {
    const plan = reconcile([stored('s1', ['a', 'b'], MergeSuggestionStatus.Open)], [group('b', 'a')]);
    expect(plan).toEqual({ inserts: [], updates: [{ id: 's1', group: group('b', 'a'), verdicts: [] }], deletes: [] });
  });

  it.each([MergeSuggestionStatus.Dismissed, MergeSuggestionStatus.Merged])('leaves a %s set alone', (status) => {
    const plan = reconcile([stored('s1', ['a', 'b'], status)], [group('a', 'b')]);
    expect(plan).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it('proposes a larger set that contains a dismissed one', () => {
    const plan = reconcile([stored('s1', ['a', 'b'], MergeSuggestionStatus.Dismissed)], [group('a', 'b', 'c')]);
    expect(plan).toEqual({ inserts: [{ group: group('a', 'b', 'c'), verdicts: [] }], updates: [], deletes: [] });
  });

  it('deletes open sets not proposed this time, and only open ones', () => {
    const plan = reconcile(
      [
        stored('gone', ['a', 'b'], MergeSuggestionStatus.Open),
        stored('dismissed', ['c', 'd'], MergeSuggestionStatus.Dismissed),
        stored('merged', ['e', 'f'], MergeSuggestionStatus.Merged),
      ],
      [],
    );
    expect(plan).toEqual({ inserts: [], updates: [], deletes: ['gone'] });
  });

  it('replaces an open set whose members changed', () => {
    const plan = reconcile([stored('s1', ['a', 'b'], MergeSuggestionStatus.Open)], [group('a', 'b', 'c')]);
    expect(plan).toEqual({ inserts: [{ group: group('a', 'b', 'c'), verdicts: [] }], updates: [], deletes: ['s1'] });
  });
});

describe('reconcile, for the model’s verdicts', () => {
  const answered = [verdict('a', 'b'), verdict('b', 'c')];

  it('keeps every verdict when the set comes back in the same order', () => {
    const plan = reconcile(
      [stored('s1', ['a', 'b', 'c'], MergeSuggestionStatus.Open, answered)],
      [group('a', 'b', 'c')],
    );
    expect(plan.updates).toEqual([{ id: 's1', group: group('a', 'b', 'c'), verdicts: answered }]);
  });

  it('drops the verdict of the step a page was added into, and keeps the others', () => {
    const plan = reconcile(
      [stored('s1', ['a', 'b', 'c'], MergeSuggestionStatus.Open, answered)],
      [group('a', 'x', 'b', 'c')],
    );
    expect(plan.deletes).toEqual(['s1']);
    expect(plan.inserts).toEqual([{ group: group('a', 'x', 'b', 'c'), verdicts: [verdict('b', 'c')] }]);
  });

  it('keeps the verdict of a step a removed page was not part of', () => {
    const plan = reconcile([stored('s1', ['a', 'b', 'c'], MergeSuggestionStatus.Open, answered)], [group('a', 'b')]);
    expect(plan.inserts).toEqual([{ group: group('a', 'b'), verdicts: [verdict('a', 'b')] }]);
  });

  it('drops the verdicts whose steps a new order no longer has', () => {
    const plan = reconcile(
      [stored('s1', ['a', 'b', 'c'], MergeSuggestionStatus.Open, answered)],
      [group('c', 'b', 'a')],
    );
    expect(plan.updates).toEqual([{ id: 's1', group: group('c', 'b', 'a'), verdicts: [] }]);
  });

  it('carries nothing over from a dismissed set', () => {
    const plan = reconcile(
      [stored('s1', ['a', 'b'], MergeSuggestionStatus.Dismissed, [verdict('a', 'b')])],
      [group('a', 'b', 'c')],
    );
    expect(plan.inserts).toEqual([{ group: group('a', 'b', 'c'), verdicts: [] }]);
  });
});
