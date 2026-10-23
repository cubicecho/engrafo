import { useQuery } from '@apollo/client/react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentSearchResults } from '@/components/domain/document-search-results';
import { DocumentsTable } from '@/components/domain/documents-table';
import { isInProgress } from '@/components/domain/status-badge';
import { UploadPanel } from '@/components/domain/upload-panel';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { FileText } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { DOCUMENT_LIST_DEFAULTS, POLLING_DEFAULTS } from '@/defaults';
import { queryLike } from '@/lib/query';

const DocumentsPage = graphql(`
  query DocumentsPage($limit: Int!) {
    serverConfig {
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
    }
    documents(orderBy: { createdAt: { direction: desc, priority: 1 } }, limit: $limit) {
      id
      title
      originalFilename
      mimeType
      sizeBytes
      status
      ocrRequested
      createdAt
    }
  }
`);

/** The query string key the search box keeps its text in, so a search survives a reload and Back. */
const SEARCH_PARAM = 'q';

/**
 * The archive: the upload panel over the list of everything uploaded, newest
 * first, and a search box that swaps both for what it found. Polls while any
 * document is still being processed.
 */
export function DocumentsRoute() {
  const [params, setParams] = useSearchParams();
  const search = (params.get(SEARCH_PARAM) ?? '').trim();
  const setSearch = (text: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (text.trim() === '') {
          next.delete(SEARCH_PARAM);
        } else {
          next.set(SEARCH_PARAM, text.trim());
        }
        return next;
      },
      // One history entry per search, not one per pause in typing.
      { replace: true },
    );

  const result = useQuery(DocumentsPage, { variables: { limit: DOCUMENT_LIST_DEFAULTS.limit } });
  const { data, startPolling, stopPolling } = result;
  const documents = data?.documents ?? [];
  const busy = documents.some((doc) => isInProgress(doc.status));

  // There is no subscription: the pipeline runs in the server process and says
  // nothing until it is asked. So the page asks, but only while something is
  // actually moving: a quiet archive should sit still.
  useEffect(() => {
    if (busy) {
      startPolling(POLLING_DEFAULTS.intervalMs);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  return (
    <PageLayout
      width="full"
      iconSlot={<FileText />}
      title="Documents"
      description="Everything you have uploaded."
      headerContentSlot={
        <SearchInput
          label="Search documents"
          placeholder="Search by meaning or by exact words"
          defaultValue={search}
          onSettledText={setSearch}
        />
      }
      contentClassName="gap-6"
      contentSlot={
        search !== '' ? (
          <DocumentSearchResults query={search} />
        ) : (
          <>
            {data?.serverConfig && <UploadPanel config={data.serverConfig} onChanged={() => void result.refetch()} />}

            <QueryState
              query={queryLike(result)}
              what="your documents"
              count={documents.length}
              emptySlot={
                <EmptyState
                  iconSlot={<FileText />}
                  title="No documents yet"
                  description="Upload a PDF, a scan or a text file to get started."
                />
              }
            />

            {documents.length > 0 && <DocumentsTable documents={documents} />}
          </>
        )
      }
    />
  );
}
