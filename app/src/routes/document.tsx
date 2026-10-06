import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { ActionButton } from '@/components/action-button';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { DialogLayout } from '@/components/dialog-layout';
import { DocumentStatusBadge, isInProgress, StepStatusBadge } from '@/components/domain/status-badge';
import { ListItem } from '@/components/list-item';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryError, RowSkeleton } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { FormElement } from '@/components/ui/form-element';
import { ArrowLeft, Download, FileText, Pencil, RefreshCw, Trash2 } from '@/components/ui/icons';
import { formatAgo, formatBytes, formatDate, joinStats } from '@/lib/format';
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

/** The one-step trail above every state of this page, so it does not jump as the title lands. */
function BackToDocuments() {
  return (
    <Link className="flex items-center gap-1 text-info text-sm hover:underline" to="/">
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

type RenameDialogProps = {
  title: string;
  onRename: (title: string) => Promise<unknown>;
  onClose: () => void;
};

/**
 * Renaming is a form in a dialog, with a Save and a Cancel, rather than the
 * title turning into an input in place.
 *
 * Mounted only while it is open, so each opening starts from the title as it
 * is now and not from whatever was typed and abandoned last time.
 */
function RenameDialog({ title, onRename, onClose }: RenameDialogProps) {
  const form = useAppForm({
    defaultValues: { title },
    onSubmit: async ({ value }) => {
      await onRename(value.title.trim());
      onClose();
    },
  });

  return (
    <form.AppForm>
      <DialogLayout
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        title="Rename document"
        description="The file it was uploaded as keeps its own name."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement onSubmit={() => form.handleSubmit()}>
            <InputField
              form={form}
              name="title"
              label="Title"
              required
              autoFocus
              validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Give the document a title') }}
            />
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton onClick={() => form.handleSubmit()} />
          </>
        )}
      />
    </form.AppForm>
  );
}

export function DocumentRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const result = useQuery(DocumentDetail, { variables: { id } });
  const { data, startPolling, stopPolling } = result;
  const doc = data?.document ?? null;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [retry] = useMutation(RetryProcessing);
  const [rename] = useMutation(RenameDocument);
  const [remove] = useMutation(DeleteDocument);

  const busy = doc ? isInProgress(doc.status) : false;
  useEffect(() => {
    if (busy) {
      startPolling(POLL_MS);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  // Presigned and short-lived, so it is fetched when the page settles rather
  // than cached with the document. The archive is the searchable PDF; before
  // OCR has run there is only the original.
  const variant = doc?.archiveKey ? DocumentFileVariant.Archive : DocumentFileVariant.Original;
  const previewable = doc ? doc.mimeType !== 'text/plain' : false;
  useEffect(() => {
    if (!doc || !previewable) {
      return;
    }
    let current = true;
    client
      .query({ query: FileUrl, variables: { id: doc.id, variant, download: false }, fetchPolicy: 'network-only' })
      .then(({ data }) => {
        if (current && data) {
          setPreviewUrl(data.documentFileUrl);
        }
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
        if (current && text !== undefined) {
          setContent(text);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, doc, contentKey, contentOversize]);

  async function download(variant = DocumentFileVariant.Original) {
    if (!doc) {
      return;
    }
    const { data } = await client.query({
      query: FileUrl,
      variables: { id: doc.id, variant, download: true },
      fetchPolicy: 'network-only',
    });
    if (data) {
      window.location.assign(data.documentFileUrl);
    }
  }

  if (result.error && !doc) {
    return (
      <Placeholder
        contentSlot={<QueryError error={result.error} onRetry={() => void result.refetch()} what="this document" />}
      />
    );
  }
  if (!doc && result.loading) {
    return <Placeholder loading contentSlot={<RowSkeleton />} />;
  }
  if (!doc) {
    return (
      <Placeholder
        contentSlot={
          <EmptyState
            icon={FileText}
            title="No such document"
            description="It may have been deleted, or the link is for someone else's archive."
            actionSlot={<Button variant="outline" content="Back to documents" linkSlot={<Link to="/" />} />}
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
              void remove({ variables: { id: doc.id } }).then(() => navigate('/', { replace: true }));
            }}
          />
        </>
      }
      contentSlot={
        <div className="flex flex-col gap-6 py-4">
          {renaming ? (
            <RenameDialog
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

          <CardLayout
            level={2}
            title="Pipeline"
            description={doc.ocrRequested ? 'OCR was requested for this document.' : 'Uploaded without OCR.'}
            contentSlot={
              <ul className="flex flex-col">
                {doc.processingSteps.map((step) => (
                  <li key={step.id}>
                    <ListItem
                      className="px-0"
                      title={step.step}
                      description={joinStats(
                        step.error,
                        step.attempts > 1 && `${step.attempts} attempts`,
                        step.finishedAt && formatAgo(step.finishedAt),
                      )}
                      meta={<StepStatusBadge status={step.status} />}
                    />
                  </li>
                ))}
              </ul>
            }
          />

          {previewUrl && (
            <CardLayout
              level={2}
              title="Preview"
              description={variant === 'ARCHIVE' ? 'The searchable PDF produced by OCR.' : 'The uploaded file.'}
              contentSlot={
                <iframe
                  title="Document preview"
                  src={previewUrl}
                  className="h-[36rem] w-full rounded-md border border-foreground/10"
                />
              }
            />
          )}

          {doc.contentKey && (
            <CardLayout
              level={2}
              title="Text"
              description={joinStats('What the pipeline extracted', formatBytes(contentBytes))}
              loading={!contentOversize && content === null}
              footerActionsSlot={
                <Button
                  variant="outline"
                  iconSlot={<Download />}
                  content="Download text"
                  onClick={() => void download(DocumentFileVariant.Text)}
                />
              }
              contentSlot={
                contentOversize || content === null ? (
                  <p className="text-foreground/60 text-sm">Too large to show here.</p>
                ) : (
                  <CodeBlock
                    content={content}
                    wrap
                    maxHeight="lg"
                    actionSlot={<CopyButton value={content} label="Copy text" />}
                  />
                )
              }
            />
          )}

          <CardLayout
            level={2}
            title="Details"
            contentSlot={
              <DescriptionList
                contentSlot={
                  <>
                    <PropertyRow label="Added" value={formatDate(doc.createdAt)} hint={formatAgo(doc.createdAt)} />
                    <PropertyRow
                      label="Checksum"
                      value={doc.checksumSha256 ?? '—'}
                      valueClassName="font-mono text-xs break-all"
                      actionSlot={
                        doc.checksumSha256 ? <CopyButton value={doc.checksumSha256} label="Copy checksum" /> : null
                      }
                    />
                  </>
                }
              />
            }
          />
        </div>
      }
    />
  );
}
