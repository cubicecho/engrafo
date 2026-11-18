import { MergeSuggestionStatus } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import type { MergeGroup } from '../../merge-suggestions/group.ts';
import { memberKey, reconcile, type StoredSuggestion } from '../../merge-suggestions/store.ts';

const group = (...documentIds: string[]): MergeGroup => ({
  documentIds,
  confidence: 0.9,
  band: 'high',
  reasons: [],
  links: [],
});

const stored = (id: string, members: string[], status: StoredSuggestion['status']): StoredSuggestion => ({
  id,
  memberKey: memberKey(members),
  status,
});

describe('memberKey', () => {
  it('is the same set whatever the page order', () => {
    expect(memberKey(['c', 'a', 'b'])).toBe(memberKey(['a', 'b', 'c']));
    expect(memberKey(['a', 'b'])).not.toBe(memberKey(['a', 'b', 'c']));
  });
});

describe('reconcile', () => {
  it('inserts a set never suggested before', () => {
    const plan = reconcile([], [group('a', 'b')]);
    expect(plan).toEqual({ inserts: [group('a', 'b')], updates: [], deletes: [] });
  });

  it('updates an open set found again, in its new order', () => {
    const plan = reconcile([stored('s1', ['a', 'b'], MergeSuggestionStatus.Open)], [group('b', 'a')]);
    expect(plan).toEqual({ inserts: [], updates: [{ id: 's1', group: group('b', 'a') }], deletes: [] });
  });

  it.each([MergeSuggestionStatus.Dismissed, MergeSuggestionStatus.Merged])('leaves a %s set alone', (status) => {
    const plan = reconcile([stored('s1', ['a', 'b'], status)], [group('a', 'b')]);
    expect(plan).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it('proposes a larger set that contains a dismissed one', () => {
    const plan = reconcile([stored('s1', ['a', 'b'], MergeSuggestionStatus.Dismissed)], [group('a', 'b', 'c')]);
    expect(plan).toEqual({ inserts: [group('a', 'b', 'c')], updates: [], deletes: [] });
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
    expect(plan).toEqual({ inserts: [group('a', 'b', 'c')], updates: [], deletes: ['s1'] });
  });
});
