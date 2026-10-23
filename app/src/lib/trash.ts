import { useQuery } from '@apollo/client/react';
import { graphql } from '@/__generated__';

// What the trash holds, as the sidebar's badge and the Trash page read it. A delete anywhere in
// the app refetches both by name, so the count follows without a poll.

export const TrashCountQuery = graphql(`
  query TrashCount {
    trash {
      count
    }
  }
`);

/** The Apollo names to refetch after a write that puts something in the trash or takes it out. */
export const TRASH_QUERY_NAMES = ['TrashCount', 'Trash'] as const;

/**
 * How many documents are in the trash, for the nav row's badge. Undefined while unknown and while
 * the trash is empty, so the row draws no badge rather than a zero.
 */
export function useTrashCount(): number | undefined {
  const { data } = useQuery(TrashCountQuery);
  const count = data?.trash.count ?? 0;
  return count > 0 ? count : undefined;
}
