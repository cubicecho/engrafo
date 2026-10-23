import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentFileVariant, DocumentStatusEnum as DocumentStatus } from '@/__generated__/graphql';
import { ConfirmButton } from '@/components/confirm-button';
import { FolderInput } from '@/components/domain/app-icons';
import { DocumentDetailsCard } from '@/components/domain/document-details-card';
import { DocumentFileUrl } from '@/components/domain/document-file';
import { DocumentPipelineCard } from '@/components/domain/document-pipeline-card';
import { DocumentPreviewCard } from '@/components/domain/document-preview-card';
import { DocumentTextCard } from '@/components/domain/document-text-card';
import { MoveDialog } from '@/components/domain/move-dialog';
import { RenameDocumentDialog } from '@/components/domain/rename-document-dialog';
import { ReprocessDocumentDialog } from '@/components/domain/reprocess-document-dialog';
import { DocumentStatusBadge, isInProgress } from '@/components/domain/status-badge';
import { EmptyState } from '@/components/empty-state';
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
      folderId
      folder {
        id
        name
      }
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

const ReprocessDocument = graphql(`
  mutation ReprocessDocument($id: UUID!, $ocr: Boolean) {
    reprocessDocument(id: $id, ocr: $ocr) {
      id
      status
      error
      ocrRequested
      archiveKey
      contentKey
      contentBytes
    }
  }
`);

// Its own query, asked only while the re-run dialog is open, so the page's own
// query does not change shape for one switch.
const ServerOcr = graphql(`
  query ServerOcr {
    serverConfig {
      ocrAvailable
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

// Asked only while the move dialog is open, for its picker: the page itself
// names the folder the document is in and needs no others.
const MoveTargets = graphql(`
  query MoveTargets {
    folders {
      id
      name
      parentId
    }
  }
`);

const MoveDocumentHere = graphql(`
  mutation MoveDocumentHere($id: UUID!, $folderId: UUID) {
    moveDocument(id: $id, folderId: $folderId) {
      id
      folderId
      folder {
        id
        name
      }
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
      width="full"
      breadcrumbsSlot={<BackToDocuments />}
      title="Document"
      loading={loading}
      contentSlot={contentSlot}
    />
  );
}

/**
 * One document, by the id in the URL: its pipeline, preview, text and details,
 * and the rename, download, retry, re-run and delete that act on it. Polls while the
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
  const [moving, setMoving] = useState(false);
  const moveTargets = useQuery(MoveTargets, { skip: !moving, fetchPolicy: 'network-only' });
  const [moveDocument] = useMutation(MoveDocumentHere);
  const [reprocessing, setReprocessing] = useState(false);
  const [retry, retryState] = useMutation(RetryProcessing);
  // Refetched so the timeline shows every step queued again, not the last run's.
  const [reprocess, reprocessState] = useMutation(ReprocessDocument, {
    refetchQueries: [DocumentDetail],
  });
  const serverOcr = useQuery(ServerOcr, { skip: !reprocessing });
  const [rename] = useMutation(RenameDocument);
  const [remove, removeState] = useMutation(DeleteDocument);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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
    setDownloadError(null);
    try {
      const { data } = await client.query({
        query: DocumentFileUrl,
        variables: { id: doc.id, variant, download: true },
        fetchPolicy: 'network-only',
      });
      if (!data) {
        throw new Error('The server returned no address for the file');
      }
      window.location.assign(data.documentFileUrl);
    } catch (error) {
      // Said on the page: left unsaid, a press that fails looks like a press that did nothing.
      setDownloadError(error instanceof Error ? error.message : String(error));
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
                iconSlot={<FileText />}
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
      width="full"
      breadcrumbsSlot={<BackToDocuments />}
      title={doc.title}
      description={joinStats(
        doc.folder ? `In ${doc.folder.name}` : null,
        doc.originalFilename,
        doc.mimeType,
        formatBytes(doc.sizeBytes),
      )}
      actionSlot={
        <>
          <DocumentStatusBadge status={doc.status} />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<Pencil />}
            content="Rename"
            onClick={() => setRenaming(true)}
          />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<FolderInput />}
            content="Move"
            aria-label="Move to a folder"
            onClick={() => setMoving(true)}
          />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<RefreshCw />}
            content="Re-run"
            aria-label="Re-run processing"
            hint={busy ? 'Already processing' : undefined}
            disabled={busy || doc.status === DocumentStatus.PendingUpload}
            onClick={() => setReprocessing(true)}
          />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<Download />}
            content="Download"
            aria-label="Download original"
            onClick={() => void download()}
          />
          <ConfirmButton
            size="sm"
            variant="destructive-outline"
            iconSlot={<Trash2 />}
            content="Delete"
            title="Delete this document?"
            description="The uploaded file, its searchable PDF and the text extracted from it are deleted from storage and cannot be recovered."
            confirmLabel="Delete"
            onConfirm={() => {
              // The failure is drawn from `removeState`; the handler only keeps the rejection handled.
              void remove({ variables: { id: doc.id } }).then(
                () => navigate(ROUTES.documents, { replace: true }),
                () => undefined,
              );
            }}
          />
        </>
      }
      contentClassName="gap-6"
      contentSlot={
        <>
          {renaming ? (
            <RenameDocumentDialog
              title={doc.title}
              onRename={(title) => rename({ variables: { id: doc.id, title } })}
              onClose={() => setRenaming(false)}
            />
          ) : null}
          {moving && moveTargets.data ? (
            <MoveDialog
              name={doc.title}
              folders={moveTargets.data.folders}
              currentFolderId={doc.folderId ?? null}
              onMove={(folderId) => moveDocument({ variables: { id: doc.id, folderId } })}
              onClose={() => setMoving(false)}
            />
          ) : null}
          {reprocessing ? (
            <ReprocessDocumentDialog
              ocrRequested={doc.ocrRequested}
              ocrAvailable={serverOcr.data?.serverConfig.ocrAvailable}
              // A refusal closes the dialog too, so the alert drawn from `reprocessState` is not behind it.
              onReprocess={(ocr) => reprocess({ variables: { id: doc.id, ocr } }).catch(() => undefined)}
              onClose={() => setReprocessing(false)}
            />
          ) : null}

          {removeState.error && (
            <Alert
              variant="destructive"
              title="Could not delete this document"
              description={removeState.error.message}
            />
          )}
          {reprocessState.error && (
            <Alert
              variant="destructive"
              title="Could not re-run processing"
              description={reprocessState.error.message}
            />
          )}
          {downloadError && (
            <Alert variant="destructive" title="Could not download the file" description={downloadError} />
          )}
          {retryState.error && (
            <Alert variant="destructive" title="Could not retry processing" description={retryState.error.message} />
          )}

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
                  onClick={() => void retry({ variables: { id: doc.id } }).catch(() => undefined)}
                />
              }
            />
          )}

          <DocumentPipelineCard ocrRequested={doc.ocrRequested} steps={doc.processingSteps} />
          <DocumentPreviewCard doc={doc} />
          <DocumentTextCard doc={doc} onDownload={() => void download(DocumentFileVariant.Text)} />
          <DocumentDetailsCard createdAt={doc.createdAt} checksumSha256={doc.checksumSha256} />
        </>
      }
    />
  );
}
