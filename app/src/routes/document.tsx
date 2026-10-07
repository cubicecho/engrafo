import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { ActionButton } from '@/components/action-button';
import { ConfirmButton } from '@/components/confirm-button';
import { DocumentDetailsCard } from '@/components/domain/document-details-card';
import { DocumentFileUrl } from '@/components/domain/document-file';
import { DocumentPipelineCard } from '@/components/domain/document-pipeline-card';
import { DocumentPreviewCard } from '@/components/domain/document-preview-card';
import { DocumentTextCard } from '@/components/domain/document-text-card';
import { RenameDocumentDialog } from '@/components/domain/rename-document-dialog';
import { DocumentStatusBadge, isInProgress } from '@/components/domain/status-badge';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, FileText, Pencil, RefreshCw, Trash2 } from '@/components/ui/icons';
import { POLLING_DEFAULTS } from '@/defaults';
import { formatBytes, joinStats } from '@/lib/format';
import { queryLike } from '@/lib/query';
import { ROUTES } from '@/lib/routes';
import type { SlotNode } from '@/lib/utils';

const DocumentDetail = graphql(`
  query DocumentDetail($id: UUID!) {
    document(where: { id: { eq: $id } }) {
      id
      title
      originalFilename
      mimeType
      sizeBytes
      checksumSha256
      archiveKey
      contentKey
      contentBytes
      ocrRequested
      status
      error
      createdAt
      processingSteps(orderBy: { position: { direction: asc, priority: 1 } }) {
        id
        step
        status
        attempts
        error
        startedAt
        finishedAt
      }
    }
  }
`);

const RetryProcessing = graphql(`
  mutation RetryDocumentProcessing($id: UUID!) {
    retryDocumentProcessing(id: $id) {
      id
      status
      error
    }
  }
`);

const RenameDocument = graphql(`
  mutation RenameDocument($id: UUID!, $title: String!) {
    renameDocument(id: $id, title: $title) {
      id
      title
    }
  }
`);

const DeleteDocument = graphql(`
  mutation DeleteDocument($id: UUID!) {
    deleteDocument(id: $id)
  }
`);

/** The one-step trail above every state of this page, so it does not jump as the title lands. */
function BackToDocuments() {
  return (
    <Link className="flex items-center gap-1 text-info text-sm hover:underline" to={ROUTES.documents}>
      <ArrowLeft className="size-3.5" aria-hidden />
      Documents
    </Link>
  );
}

/** The page before there is a document to name it: loading, failed, or not there. */
function Placeholder({ loading = false, contentSlot }: { loading?: boolean; contentSlot: SlotNode }) {
  return (
    <PageLayout
      width="prose"
      breadcrumbsSlot={<BackToDocuments />}
      title="Document"
      loading={loading}
      contentSlot={<div className="py-4">{contentSlot}</div>}
    />
  );
}

/**
 * One document, by the id in the URL: its pipeline, preview, text and details,
 * and the rename, download, retry and delete that act on it. Polls while the
 * document is still being processed.
 */
export function DocumentRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const result = useQuery(DocumentDetail, { variables: { id } });
  const { data, startPolling, stopPolling } = result;
  const doc = data?.document ?? null;

  const [renaming, setRenaming] = useState(false);
  const [retry] = useMutation(RetryProcessing);
  const [rename] = useMutation(RenameDocument);
  const [remove] = useMutation(DeleteDocument);

  const busy = doc ? isInProgress(doc.status) : false;
  useEffect(() => {
    if (busy) {
      startPolling(POLLING_DEFAULTS.intervalMs);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  async function download(variant: DocumentFileVariant = DocumentFileVariant.Original) {
    if (!doc) {
      return;
    }
    const { data } = await client.query({
      query: DocumentFileUrl,
      variables: { id: doc.id, variant, download: true },
      fetchPolicy: 'network-only',
    });
    if (data) {
      window.location.assign(data.documentFileUrl);
    }
  }

  if (!doc) {
    const query = queryLike(result);
    return (
      <Placeholder
        loading={query.isPending}
        contentSlot={
          <QueryState
            query={query}
            what="this document"
            count={0}
            emptySlot={
              <EmptyState
                icon={FileText}
                title="No such document"
                description="It may have been deleted, or the link is for someone else's archive."
                actionSlot={
                  <Button variant="outline" content="Back to documents" linkSlot={<Link to={ROUTES.documents} />} />
                }
              />
            }
          />
        }
      />
    );
  }

  return (
    <PageLayout
      width="prose"
      breadcrumbsSlot={<BackToDocuments />}
      title={doc.title}
      description={joinStats(doc.originalFilename, doc.mimeType, formatBytes(doc.sizeBytes))}
      actionSlot={
        <>
          <DocumentStatusBadge status={doc.status} />
          <ActionButton
            label="Rename"
            variant="outline"
            size="icon"
            iconSlot={<Pencil />}
            onClick={() => setRenaming(true)}
          />
          <ActionButton
            label="Download original"
            variant="outline"
            size="icon"
            iconSlot={<Download />}
            onClick={() => void download()}
          />
          <ConfirmButton
            label="Delete"
            variant="outline"
            size="icon"
            iconSlot={<Trash2 />}
            title="Delete this document?"
            description="The uploaded file, its searchable PDF and the text extracted from it are deleted from storage and cannot be recovered."
            confirmLabel="Delete"
            onConfirm={() => {
              void remove({ variables: { id: doc.id } }).then(() => navigate(ROUTES.documents, { replace: true }));
            }}
          />
        </>
      }
      contentSlot={
        <div className="flex flex-col gap-6 py-4">
          {renaming ? (
            <RenameDocumentDialog
              title={doc.title}
              onRename={(title) => rename({ variables: { id: doc.id, title } })}
              onClose={() => setRenaming(false)}
            />
          ) : null}

          {doc.error && (
            <Alert
              variant="destructive"
              title="Processing failed"
              description={doc.error}
              actionSlot={
                <Button
                  variant="outline"
                  iconSlot={<RefreshCw />}
                  content="Retry"
                  onClick={() => void retry({ variables: { id: doc.id } })}
                />
              }
            />
          )}

          <DocumentPipelineCard ocrRequested={doc.ocrRequested} steps={doc.processingSteps} />
          <DocumentPreviewCard doc={doc} />
          <DocumentTextCard doc={doc} onDownload={() => void download(DocumentFileVariant.Text)} />
          <DocumentDetailsCard createdAt={doc.createdAt} checksumSha256={doc.checksumSha256} />
        </div>
      }
    />
  );
}
