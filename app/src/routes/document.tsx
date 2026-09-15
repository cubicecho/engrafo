import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { ArrowLeft, Check, Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DocumentStatusBadge, isInProgress, StepStatusBadge } from '@/components/domain/status-badge';
import { PageLayout } from '@/components/page-layout';
import { QueryError, RowSkeleton } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBytes, formatDateTime } from '@/lib/format';

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

const FileUrl = graphql(`
  query DocumentFileUrl($id: UUID!, $variant: DocumentFileVariant!, $download: Boolean!) {
    documentFileUrl(id: $id, variant: $variant, download: $download)
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

const POLL_MS = 3000;

// The text is an object in its own bucket, so the page fetches it rather than
// receiving it with the document. Past this much, showing it in the browser
// helps nobody — the download link stands in for it.
const TEXT_PREVIEW_BYTES = 512 * 1024;

export function DocumentRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const result = useQuery(DocumentDetail, { variables: { id } });
  const { data, startPolling, stopPolling } = result;
  const doc = data?.document ?? null;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [retry] = useMutation(RetryProcessing);
  const [rename] = useMutation(RenameDocument);
  const [remove] = useMutation(DeleteDocument);

  const busy = doc ? isInProgress(doc.status) : false;
  useEffect(() => {
    if (busy) startPolling(POLL_MS);
    else stopPolling();
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  // Presigned and short-lived, so it is fetched when the page settles rather
  // than cached with the document. The archive is the searchable PDF; before
  // OCR has run there is only the original.
  const variant = doc?.archiveKey ? DocumentFileVariant.Archive : DocumentFileVariant.Original;
  const previewable = doc ? doc.mimeType !== 'text/plain' : false;
  useEffect(() => {
    if (!doc || !previewable) return;
    let current = true;
    client
      .query({ query: FileUrl, variables: { id: doc.id, variant, download: false }, fetchPolicy: 'network-only' })
      .then(({ data }) => {
        if (current && data) setPreviewUrl(data.documentFileUrl);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, doc, previewable, variant]);

  const contentKey = doc?.contentKey ?? null;
  const contentBytes = doc?.contentBytes ?? 0;
  const contentOversize = contentBytes > TEXT_PREVIEW_BYTES;
  useEffect(() => {
    if (!doc || !contentKey || contentOversize) {
      setContent(null);
      return;
    }
    let current = true;
    client
      .query({
        query: FileUrl,
        variables: { id: doc.id, variant: DocumentFileVariant.Text, download: false },
        fetchPolicy: 'network-only',
      })
      .then(({ data }) => (data ? fetch(data.documentFileUrl) : null))
      .then((response) => response?.text())
      .then((text) => {
        if (current && text !== undefined) setContent(text);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, doc, contentKey, contentOversize]);

  async function download(variant = DocumentFileVariant.Original) {
    if (!doc) return;
    const { data } = await client.query({
      query: FileUrl,
      variables: { id: doc.id, variant, download: true },
      fetchPolicy: 'network-only',
    });
    if (data) window.location.assign(data.documentFileUrl);
  }

  if (result.error && !doc) {
    return (
      <div className="p-4">
        <QueryError error={result.error} onRetry={() => void result.refetch()} what="this document" />
      </div>
    );
  }
  if (!doc) return <RowSkeleton className="p-4" />;

  return (
    <PageLayout
      width="prose"
      breadcrumbs={
        <Link className="flex items-center gap-1 hover:underline" to="/">
          <ArrowLeft className="size-3.5" aria-hidden />
          Documents
        </Link>
      }
      title={
        renaming === null ? (
          doc.title
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void rename({ variables: { id: doc.id, title: renaming } });
              setRenaming(null);
            }}
          >
            <Input value={renaming} onChange={(event) => setRenaming(event.target.value)} autoFocus />
            <ActionButton type="submit" label="Save title" size="icon" variant="ghost">
              <Check className="size-4" aria-hidden />
            </ActionButton>
          </form>
        )
      }
      description={`${doc.originalFilename} · ${doc.mimeType} · ${formatBytes(doc.sizeBytes)}`}
      action={
        <div className="flex items-center gap-1">
          <DocumentStatusBadge status={doc.status} />
          <ActionButton
            label="Rename"
            variant="ghost"
            size="icon"
            onClick={() => setRenaming(renaming === null ? doc.title : null)}
          >
            <Pencil className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton label="Download original" variant="ghost" size="icon" onClick={() => void download()}>
            <Download className="size-4" aria-hidden />
          </ActionButton>
          <ConfirmButton
            label="Delete"
            variant="ghost"
            size="icon"
            title="Delete this document?"
            description="The file and everything extracted from it are removed from storage. This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => {
              void remove({ variables: { id: doc.id } }).then(() => navigate('/', { replace: true }));
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </ConfirmButton>
        </div>
      }
      content={
        <div className="flex flex-col gap-6 py-4">
          {doc.error && (
            <CardLayout
              className="border-destructive/50"
              title="Processing failed"
              description={doc.error}
              footerActions={
                <Button variant="outline" onClick={() => void retry({ variables: { id: doc.id } })}>
                  <RefreshCw className="size-3.5" aria-hidden />
                  Retry
                </Button>
              }
            />
          )}

          <CardLayout
            title="Pipeline"
            description={doc.ocrRequested ? 'OCR was requested for this document.' : 'Uploaded without OCR.'}
            content={
              <ul className="flex flex-col gap-2 text-sm">
                {doc.processingSteps.map((step) => (
                  <li key={step.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{step.step}</span>
                    <span className="flex items-center gap-2 text-muted-foreground text-xs">
                      {step.error && <span className="text-destructive">{step.error}</span>}
                      {step.attempts > 1 && <span>{step.attempts} attempts</span>}
                      {step.finishedAt && <span>{formatDateTime(step.finishedAt)}</span>}
                      <StepStatusBadge status={step.status} />
                    </span>
                  </li>
                ))}
              </ul>
            }
          />

          {previewUrl && (
            <CardLayout
              title="Preview"
              description={variant === 'ARCHIVE' ? 'The searchable PDF produced by OCR.' : 'The uploaded file.'}
              contentClassName="p-0"
              content={
                <iframe title="Document preview" src={previewUrl} className="h-[36rem] w-full rounded-md border" />
              }
            />
          )}

          {doc.contentKey && (
            <CardLayout
              title="Text"
              description={`What the pipeline extracted · ${formatBytes(contentBytes)}`}
              footerActions={
                <Button variant="outline" onClick={() => void download(DocumentFileVariant.Text)}>
                  <Download className="size-3.5" aria-hidden />
                  Download text
                </Button>
              }
              content={
                contentOversize ? (
                  <p className="text-muted-foreground text-sm">Too large to show here.</p>
                ) : (
                  <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap font-mono text-xs">
                    {content ?? 'Loading…'}
                  </pre>
                )
              }
            />
          )}

          <CardLayout
            title="Details"
            content={
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Added</dt>
                <dd>{formatDateTime(doc.createdAt)}</dd>
                <dt className="text-muted-foreground">Checksum</dt>
                <dd className="truncate font-mono text-xs">{doc.checksumSha256 ?? '—'}</dd>
              </dl>
            }
          />
        </div>
      }
    />
  );
}
