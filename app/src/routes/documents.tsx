import { useQuery } from '@apollo/client/react';
import { useEffect } from 'react';
import { graphql } from '@/__generated__';
import { DocumentsTable } from '@/components/domain/documents-table';
import { isInProgress } from '@/components/domain/status-badge';
import { UploadPanel } from '@/components/domain/upload-panel';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { FileText } from '@/components/ui/icons';
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

/**
 * The archive: the upload panel over the list of everything uploaded, newest
 * first. Polls while any document is still being processed.
 */
export function DocumentsRoute() {
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
      iconSlot={<FileText />}
      title="Documents"
      description="Everything you have uploaded."
      contentSlot={
        <div className="flex flex-col gap-6 py-4">
          {data?.serverConfig && <UploadPanel config={data.serverConfig} onChanged={() => void result.refetch()} />}

          <QueryState
            query={queryLike(result)}
            what="your documents"
            count={documents.length}
            emptySlot={
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Upload a PDF, a scan or a text file to get started."
              />
            }
          />

          {documents.length > 0 && <DocumentsTable documents={documents} />}
        </div>
      }
    />
  );
}
