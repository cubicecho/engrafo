import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import {
  DocumentFileVariant,
  DocumentMetadataField,
  DocumentStatusEnum as DocumentStatus,
  StepStatusEnum as StepStatus,
} from '@/__generated__/graphql';
import { ConfirmButton } from '@/components/confirm-button';
import { FolderInput } from '@/components/domain/app-icons';
import { DocumentDateDialog } from '@/components/domain/document-date-dialog';
import { DocumentDetailsCard } from '@/components/domain/document-details-card';
import { DocumentFileUrl } from '@/components/domain/document-file';
import { DocumentPipelineCard } from '@/components/domain/document-pipeline-card';
import { DocumentPreviewCard, isPreviewable } from '@/components/domain/document-preview-card';
import { DocumentReceiptCard } from '@/components/domain/document-receipt-card';
import { DocumentTextCard } from '@/components/domain/document-text-card';
import { DuplicateAlert } from '@/components/domain/duplicate-alert';
import { MoveDialog } from '@/components/domain/move-dialog';
import { ReceiptDialog } from '@/components/domain/receipt-dialog';
import { RenameDocumentDialog } from '@/components/domain/rename-document-dialog';
import { ReprocessDocumentDialog } from '@/components/domain/reprocess-document-dialog';
import { DocumentStatusBadge, isInProgress } from '@/components/domain/status-badge';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { SplitLayout } from '@/components/split-layout';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download, Eye, FileText, Pencil, RefreshCw, Trash2 } from '@/components/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { POLLING_DEFAULTS } from '@/defaults';
import { ARCHIVE_QUERY_NAME, useArchive } from '@/lib/archive';
import { DOCUMENT_TAB_PARAM, type DocumentTab, documentTab, tabSearch } from '@/lib/document-tabs';
import { formatBytes, joinStats } from '@/lib/format';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { ROUTES } from '@/lib/routes';
import { TRASH_QUERY_NAMES } from '@/lib/trash';
import { cn, type SlotNode } from '@/lib/utils';

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
      visionRequested
      status
      error
      createdAt
      documentDate
      documentDateSource
      vendor
      total
      currency
      receiptSource
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

// Its own query, not a field of the page's: drizzle-graphql reads only the columns a selection
// names, so a duplicates field on Document could not count on the checksum. Asked once the
// checksum is in, which the page's own poll brings, and its failure costs only the warning.
const DocumentDuplicatesOf = graphql(`
  query DocumentDuplicatesOf($id: UUID!) {
    documentDuplicates(ids: [$id]) {
      document {
        id
      }
      duplicates {
        id
        title
        folderId
      }
    }
  }
`);

// Only the id: the answer is a plain row, with no steps, so a status in it would flip the badge
// while the timeline still showed the failed run. The refetch brings both in one write.
const RetryProcessing = graphql(`
  mutation RetryDocumentProcessing($id: UUID!) {
    retryDocumentProcessing(id: $id) {
      id
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

// Its own query, so the page's own query does not change shape for what the server can do: the
// re-run dialog's OCR switch, and whether there is a vision model to offer at all.
const ServerReaders = graphql(`
  query ServerReaders {
    serverConfig {
      ocrAvailable
      visionAvailable
      visionAuto
    }
  }
`);

const ReadDocumentWithVision = graphql(`
  mutation ReadDocumentWithVision($id: UUID!) {
    readDocumentWithVision(id: $id) {
      id
      status
      error
      visionRequested
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

const SetDocumentDate = graphql(`
  mutation SetDocumentDate($id: UUID!, $date: String) {
    setDocumentDate(id: $id, date: $date) {
      id
      documentDate
      documentDateSource
    }
  }
`);

const SetDocumentReceipt = graphql(`
  mutation SetDocumentReceipt($id: UUID!, $input: DocumentReceiptInput!) {
    setDocumentReceipt(id: $id, input: $input) {
      id
      vendor
      total
      currency
      receiptSource
    }
  }
`);

const ResetDocumentMetadata = graphql(`
  mutation ResetDocumentMetadata($id: UUID!, $fields: [DocumentMetadataField!]!) {
    resetDocumentMetadata(id: $id, fields: $fields) {
      id
      documentDate
      documentDateSource
      vendor
      total
      currency
      receiptSource
    }
  }
`);

const DeleteDocument = graphql(`
  mutation DeleteDocument($id: UUID!) {
    deleteDocument(id: $id)
  }
`);

/**
 * A header button's words, drawn from `sm` up. Six buttons in words do not fit a phone's width, so
 * there the row is icons, each still named by its `aria-label`.
 */
function WideLabel({ text }: { text: string }) {
  return <span className="hidden sm:inline">{text}</span>;
}

/** The step the vision model's run is stored under in `processing_steps`. */
const VISION_STEP = 'vision';

/**
 * Whether the vision model can read a document of this type: it looks at pages, so a PDF or an
 * image, and not text, an ebook or a web page, which have their text already.
 */
function readsWithVision(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}

/**
 * The mark on the History tab while there is something to see there: the pipeline still running,
 * or stopped on a failure. Named, so it is read as part of the tab's name.
 */
function historyMark(status: DocumentStatus): SlotNode {
  if (isInProgress(status)) {
    return <Badge variant="info" pulse label="Processing" />;
  }
  if (status === DocumentStatus.Failed) {
    return <Badge variant="destructive" label="Failed" />;
  }
  return null;
}

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
      contentClassName={FULL_WIDTH_BODY}
      breadcrumbsSlot={<BackToDocuments />}
      title="Document"
      loading={loading}
      contentSlot={contentSlot}
    />
  );
}

/**
 * One document, by the id in the URL: its preview, text and history in tabs (`?tab=`), its
 * receipt and details beside them, and the rename, download, retry, re-run, vision read and
 * delete that act on it. Polls while the document is still being processed.
 */
export function DocumentRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const result = useQuery(DocumentDetail, { variables: { id } });
  const { data, startPolling, stopPolling } = result;
  const doc = data?.document ?? null;
  const duplicatesOf = useQuery(DocumentDuplicatesOf, {
    variables: { id },
    skip: !doc?.checksumSha256,
    // Network as well as cache: the other copy may have been deleted since this page last asked.
    fetchPolicy: 'cache-and-network',
  });
  const duplicates = duplicatesOf.data?.documentDuplicates[0]?.duplicates ?? [];
  // The sidebar's query, answered from the cache, for the other copies' folder paths.
  const { folders } = useArchive();

  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const moveTargets = useQuery(MoveTargets, { skip: !moving, fetchPolicy: 'network-only' });
  const [moveDocument] = useMutation(MoveDocumentHere);
  const [reprocessing, setReprocessing] = useState(false);
  const [retry, retryState] = useMutation(RetryProcessing, {
    refetchQueries: [DocumentDetail],
    awaitRefetchQueries: true,
  });
  // Refetched so the timeline shows every step queued again, not the last run's.
  const [reprocess, reprocessState] = useMutation(ReprocessDocument, {
    refetchQueries: [DocumentDetail],
  });
  // Asked up front, not when the re-run dialog opens: whether to offer the vision model at all
  // depends on it. Its failure costs only that button and the dialog's OCR switch.
  const serverReaders = useQuery(ServerReaders);
  const server = serverReaders.data?.serverConfig;
  // Refetched as reprocess is, so the timeline shows the steps queued again; the answer's
  // `uploaded` status is what starts the page's poll.
  const [readWithVision, visionState] = useMutation(ReadDocumentWithVision, {
    refetchQueries: [DocumentDetail],
  });
  const [searchParams] = useSearchParams();
  const [rename] = useMutation(RenameDocument);
  const [editingDate, setEditingDate] = useState(false);
  const [setDate] = useMutation(SetDocumentDate);
  const [editingReceipt, setEditingReceipt] = useState(false);
  const [setReceipt] = useMutation(SetDocumentReceipt);
  const [resetMetadata, resetState] = useMutation(ResetDocumentMetadata);
  // The sidebar's tree still lists it until the archive is read again.
  const [remove, removeState] = useMutation(DeleteDocument, {
    refetchQueries: [ARCHIVE_QUERY_NAME, ...TRASH_QUERY_NAMES],
  });
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

  function resetFields(documentId: string, fields: DocumentMetadataField[]) {
    // The failure is drawn from `resetState`; the handler only keeps the rejection handled.
    void resetMetadata({ variables: { id: documentId, fields } }).catch(() => undefined);
  }

  function deleteThis(documentId: string) {
    // The failure is drawn from `removeState`; the handler only keeps the rejection handled.
    void remove({ variables: { id: documentId } }).then(
      () => {
        // Out of the cache before the list is drawn: every list there reads it by reference, so
        // the next page paints without it instead of showing it until the refetch lands.
        client.cache.evict({ id: client.cache.identify({ __typename: 'Document', id: documentId }) });
        client.cache.gc();
        navigate(ROUTES.documents, { replace: true });
      },
      () => undefined,
    );
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

  const previewable = isPreviewable(doc.mimeType);
  const tab = documentTab(searchParams.get(DOCUMENT_TAB_PARAM), previewable);
  const settled = doc.status === DocumentStatus.Ready || doc.status === DocumentStatus.Failed;
  const offerVision = server?.visionAvailable === true && readsWithVision(doc.mimeType) && settled;
  const readBefore =
    doc.visionRequested ||
    doc.processingSteps.some((step) => step.step === VISION_STEP && step.status === StepStatus.Succeeded);
  const tabLink = (to: DocumentTab) => <Link to={{ search: tabSearch(searchParams, to) }} replace />;

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
            content={<WideLabel text="Rename" />}
            aria-label="Rename"
            onClick={() => setRenaming(true)}
          />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<FolderInput />}
            content={<WideLabel text="Move" />}
            aria-label="Move to a folder"
            onClick={() => setMoving(true)}
          />
          <Button
            size="sm"
            variant="outline"
            iconSlot={<RefreshCw />}
            content={<WideLabel text="Re-run" />}
            aria-label="Re-run processing"
            hint={busy ? 'Already processing' : undefined}
            disabled={busy || doc.status === DocumentStatus.PendingUpload}
            onClick={() => setReprocessing(true)}
          />
          {offerVision ? (
            <Button
              size="sm"
              variant="outline"
              iconSlot={<Eye />}
              content={<WideLabel text={readBefore ? 'Read again with vision' : 'Read with vision'} />}
              aria-label={readBefore ? 'Read again with vision model' : 'Read with vision model'}
              loading={visionState.loading}
              onClick={() => void readWithVision({ variables: { id: doc.id } }).catch(() => undefined)}
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            iconSlot={<Download />}
            content={<WideLabel text="Download" />}
            aria-label="Download original"
            onClick={() => void download()}
          />
          <ConfirmButton
            size="sm"
            variant="destructive-outline"
            iconSlot={<Trash2 />}
            content={<WideLabel text="Delete" />}
            aria-label="Delete"
            title="Move this document to the trash?"
            description="It waits in the Trash, where it can be restored, until it is deleted for good."
            confirmLabel="Move to trash"
            onConfirm={() => deleteThis(doc.id)}
          />
        </>
      }
      contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
      contentSlot={
        <>
          {renaming ? (
            <RenameDocumentDialog
              title={doc.title}
              onRename={(title) => rename({ variables: { id: doc.id, title } })}
              onClose={() => setRenaming(false)}
            />
          ) : null}
          {editingDate ? (
            <DocumentDateDialog
              date={doc.documentDate ?? null}
              onSave={(date) => setDate({ variables: { id: doc.id, date } })}
              onClose={() => setEditingDate(false)}
            />
          ) : null}
          {editingReceipt ? (
            <ReceiptDialog
              receipt={{ vendor: doc.vendor, total: doc.total, currency: doc.currency }}
              onSave={(input) => setReceipt({ variables: { id: doc.id, input } })}
              onClose={() => setEditingReceipt(false)}
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
              ocrAvailable={server?.ocrAvailable}
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
          {visionState.error && (
            <Alert
              variant="destructive"
              title="Could not read this document with the vision model"
              description={visionState.error.message}
            />
          )}
          {resetState.error && (
            <Alert
              variant="destructive"
              title="Could not read the fields from the text again"
              description={resetState.error.message}
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

          <DuplicateAlert
            duplicates={duplicates}
            folders={folders}
            actionSlot={
              // Plain outline: the destructive red does not reach 4.5:1 on the warning's tint, and
              // the confirmation it opens is where the delete is marked as one.
              <ConfirmButton
                variant="outline"
                iconSlot={<Trash2 />}
                content="Delete this copy"
                title="Move this copy to the trash?"
                description="Your other copies are kept. This one waits in the Trash, where it can be restored, until it is deleted for good."
                confirmLabel="Move to trash"
                onConfirm={() => deleteThis(doc.id)}
              />
            }
          />

          <SplitLayout
            stackBelow="lg"
            secondWidth="md"
            firstSlot={
              // Tabs that are links: the URL holds the tab, so a reload or a shared link opens the
              // same one, and the route, not `onValueChange`, is what changes it.
              <Tabs value={tab}>
                <TabsList aria-label="Document view" className="self-start">
                  {previewable ? (
                    <TabsTrigger value="preview" linkSlot={tabLink('preview')}>
                      Preview
                    </TabsTrigger>
                  ) : null}
                  <TabsTrigger value="text" linkSlot={tabLink('text')}>
                    Text
                  </TabsTrigger>
                  <TabsTrigger value="history" linkSlot={tabLink('history')} trailingSlot={historyMark(doc.status)}>
                    History
                  </TabsTrigger>
                </TabsList>
                {previewable ? (
                  <TabsContent value="preview">
                    <DocumentPreviewCard doc={doc} />
                  </TabsContent>
                ) : null}
                <TabsContent value="text">
                  <DocumentTextCard doc={doc} onDownload={() => void download(DocumentFileVariant.Text)} />
                </TabsContent>
                <TabsContent value="history">
                  <DocumentPipelineCard
                    ocrRequested={doc.ocrRequested}
                    visionRequested={doc.visionRequested}
                    uploadedAt={doc.createdAt}
                    steps={doc.processingSteps}
                  />
                </TabsContent>
              </Tabs>
            }
            secondClassName="gap-4"
            secondSlot={
              <>
                <DocumentReceiptCard
                  vendor={doc.vendor}
                  total={doc.total}
                  currency={doc.currency}
                  source={doc.receiptSource}
                  onEdit={() => setEditingReceipt(true)}
                  onReset={() => resetFields(doc.id, [DocumentMetadataField.Receipt])}
                />
                <DocumentDetailsCard
                  createdAt={doc.createdAt}
                  checksumSha256={doc.checksumSha256}
                  documentDate={doc.documentDate ?? null}
                  documentDateSource={doc.documentDateSource ?? null}
                  onEditDate={() => setEditingDate(true)}
                  onResetDate={() => resetFields(doc.id, [DocumentMetadataField.Date])}
                />
              </>
            }
          />
        </>
      }
    />
  );
}
