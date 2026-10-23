import { useQuery } from '@apollo/client/react';
import { useEffect } from 'react';
import { graphql } from '@/__generated__';
import { isInProgress } from '@/components/domain/status-badge';
import { DOCUMENT_LIST_DEFAULTS, POLLING_DEFAULTS } from '@/defaults';

// The folders and documents the tree draws. It is drawn in the sidebar on every signed-in page
// and inline on the documents page on a phone, and both read this one query: Apollo answers the
// second from the cache, and a refetch from either updates both.

export const ArchiveQuery = graphql(`
  query Archive($limit: Int!) {
    folders {
      id
      name
      parentId
      mcpEnabled
    }
    documents(orderBy: { createdAt: { direction: desc, priority: 1 } }, limit: $limit) {
      id
      title
      folderId
      sizeBytes
      status
    }
  }
`);

/** The Apollo document the archive is read with, for a mutation's `refetchQueries`. */
export const ARCHIVE_QUERY_NAME = 'Archive';

interface UseArchiveOptions {
  /**
   * Polls while a document is still being processed. Exactly one reader should, or each one
   * polls on its own: the sidebar, which is mounted on every signed-in page.
   */
  poll?: boolean | undefined;
}

/**
 * Reads the archive. There is no subscription, since the pipeline runs inside the server and says
 * nothing until asked, so the polling reader asks every few seconds while something is moving
 * and stops once nothing is.
 */
export function useArchive({ poll = false }: UseArchiveOptions = {}) {
  const result = useQuery(ArchiveQuery, { variables: { limit: DOCUMENT_LIST_DEFAULTS.limit } });
  const { data, startPolling, stopPolling } = result;
  const busy = poll && (data?.documents ?? []).some((doc) => isInProgress(doc.status));

  useEffect(() => {
    if (busy) {
      startPolling(POLLING_DEFAULTS.intervalMs);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  return {
    result,
    folders: data?.folders ?? [],
    documents: data?.documents ?? [],
  };
}
