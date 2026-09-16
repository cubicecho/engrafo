import { useQuery } from '@apollo/client/react';
import { FileText } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentStatusBadge, isInProgress } from '@/components/domain/status-badge';
import { UploadPanel } from '@/components/domain/upload-panel';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDateTime } from '@/lib/format';
import { queryLike } from '@/lib/query';

const DocumentsPage = graphql(`
  query DocumentsPage {
    serverConfig {
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
    }
    documents(orderBy: { createdAt: { direction: desc, priority: 1 } }, limit: 200) {
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

// Long enough not to hammer the server, short enough that a small scan looks
// live. There is no subscription: the pipeline runs in the server process and
// says nothing until it is asked.
const POLL_MS = 3000;

export function DocumentsRoute() {
  const result = useQuery(DocumentsPage);
  const { data, startPolling, stopPolling } = result;
  const documents = data?.documents ?? [];
  const busy = documents.some((doc) => isInProgress(doc.status));

  // Only while something is actually moving: a quiet archive should sit still.
  useEffect(() => {
    if (busy) startPolling(POLL_MS);
    else stopPolling();
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  return (
    <PageLayout
      icon={<FileText />}
      title="Documents"
      description="Everything you have uploaded."
      content={
        <div className="flex flex-col gap-6 py-4">
          {data?.serverConfig && <UploadPanel config={data.serverConfig} onChanged={() => void result.refetch()} />}

          <QueryState
            query={queryLike(result)}
            what="your documents"
            count={documents.length}
            empty={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>No documents yet</EmptyTitle>
                  <EmptyDescription>Upload a PDF, a scan or a text file to get started.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />

          {documents.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="max-w-[24rem]">
                      <Link className="font-medium hover:underline" to={`/documents/${doc.id}`}>
                        {doc.title}
                      </Link>
                      <div className="truncate text-muted-foreground text-xs">{doc.originalFilename}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{doc.mimeType}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(doc.sizeBytes)}</TableCell>
                    <TableCell>
                      <DocumentStatusBadge status={doc.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(doc.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      }
    />
  );
}
