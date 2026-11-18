import { useApolloClient } from '@apollo/client/react';
import { useState } from 'react';
import { graphql } from '@/__generated__';
import { InputField, SelectField, SwitchField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { useDocumentPreviewUrl } from '@/components/domain/document-preview-card';
import { DocumentThumbnail } from '@/components/domain/document-thumbnail';
import { titleError } from '@/components/domain/rename-document-dialog';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { ChevronDown, ChevronUp, Sparkles, X } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { ARCHIVE_QUERY_NAME } from '@/lib/archive';
import { messageOf } from '@/lib/error-message';
import { type FolderRow, folderOptions, folderPaths, TOP_LEVEL, TOP_LEVEL_LABEL } from '@/lib/folder-tree';
import { formatBytes, joinStats } from '@/lib/format';
import { MERGE_MIN_DOCUMENTS, type MergeCandidate, mergeTypeLabel, moveCandidate } from '@/lib/merge';
import { MERGE_SUGGESTION_QUERY_NAMES } from '@/lib/merge-suggestions';
import { useThumbnailUrls } from '@/lib/thumbnails';
import { TRASH_QUERY_NAMES } from '@/lib/trash';

// Asked anew on every press, never from the cache: pressing again is asking for another.
const SuggestDocumentTitle = graphql(`
  query SuggestDocumentTitle($ids: [UUID!]!) {
    suggestDocumentTitle(ids: $ids)
  }
`);

/** What the dialog asks the server for. */
export interface MergeRequest {
  /** In page order. */
  ids: string[];
  title: string;
  folderId: string | null;
  trashOriginals: boolean;
}

/** The merge itself, sent by whichever page opened the dialog. */
export const MergeDocumentsMutation = graphql(`
  mutation MergeDocuments($input: MergeDocumentsInput!) {
    mergeDocuments(input: $input) {
      id
      title
    }
  }
`);

/**
 * What a merge changes that is on screen somewhere: the new document is in the tree and the
 * lists, a suggestion of that set is merged, and trashed originals leave the lists for the trash.
 *
 * @param request - The merge sent.
 * @returns The Apollo names to refetch.
 */
export function mergeRefetchQueries(request: MergeRequest): string[] {
  return [
    ARCHIVE_QUERY_NAME,
    'BrowseDocuments',
    'SearchDocuments',
    ...MERGE_SUGGESTION_QUERY_NAMES,
    ...(request.trashOriginals ? TRASH_QUERY_NAMES : []),
  ];
}

interface MergeDocumentsDialogProps {
  /** The documents picked on the page, in the order their pages go in. */
  documents: readonly MergeCandidate[];
  /** Every folder the caller has, for the picker. */
  folders: readonly FolderRow[];
  /** `serverConfig.visionAvailable`: a model is set up, so the title can be suggested by it. */
  visionAvailable?: boolean | undefined;
  /**
   * The documents reordered, or one taken out. The page owns the selection, so taking one out
   * here unchecks it there too.
   */
  onDocumentsChange: (next: MergeCandidate[]) => void;
  /** Merges them. The dialog closes once this resolves, and says why when it rejects. */
  onMerge: (request: MergeRequest) => Promise<unknown>;
  onClose: () => void;
}

/**
 * One document's file beside the merge list, so its pages can be checked before they go in: the
 * file the merge takes, which is the searchable PDF once OCR has made one, else the upload. The
 * browser's own viewer pages through it.
 */
function MergePreview({ doc }: { doc: MergeCandidate }) {
  const { url, failed } = useDocumentPreviewUrl(doc);
  const frame = 'h-72 w-full rounded-md border border-foreground/10 md:h-96';
  return (
    <section aria-label={`Preview of “${doc.title}”`} className="grid content-start gap-2">
      <p className="truncate text-foreground/60 text-xs">
        {doc.archiveKey ? `“${doc.title}”, the searchable PDF` : `“${doc.title}”, as uploaded`}
      </p>
      {url ? (
        <iframe title={`Preview of “${doc.title}”`} src={url} className={frame} />
      ) : failed ? (
        <Alert
          variant="destructive"
          title="Could not load the preview"
          description="The server did not return an address for the file. The merge can still go ahead."
        />
      ) : (
        <Skeleton className={frame} />
      )}
    </section>
  );
}

/**
 * "Merge documents": the picked PDFs and images in the order their pages go in, each with its
 * first page, its folder, its type and size, and a button each to move it or take it out; the one
 * pressed is previewed beside the list, the first until another is. Then the merged copy's title
 * and folder and whether the originals go to the trash. With a vision model set up, the title can
 * be suggested from the documents' text and then edited. Mounted only while open, so the title and
 * folder start from the first document each time.
 */
export function MergeDocumentsDialog({
  documents,
  folders,
  visionAvailable = false,
  onDocumentsChange,
  onMerge,
  onClose,
}: MergeDocumentsDialogProps) {
  const client = useApolloClient();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionFailure, setSuggestionFailure] = useState<string | undefined>();
  const [previewId, setPreviewId] = useState<string | undefined>();
  const first = documents[0];
  // Falls back to the first when the one previewed is left out.
  const previewing = documents.find((doc) => doc.id === previewId) ?? first;
  const thumbnails = useThumbnailUrls(documents.map((doc) => doc.id));
  const paths = folderPaths(folders);
  const tooFew = documents.length < MERGE_MIN_DOCUMENTS;
  const form = useAppForm({
    defaultValues: {
      title: first?.title ?? '',
      folderId: first?.folderId ?? TOP_LEVEL,
      trashOriginals: false,
    },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onMerge({
          ids: documents.map((doc) => doc.id),
          title: value.title.trim(),
          folderId: value.folderId === TOP_LEVEL ? null : value.folderId,
          trashOriginals: value.trashOriginals,
        });
      } catch (error) {
        setRefusal(messageOf(error) ?? 'The server refused it');
        return;
      }
      onClose();
    },
  });

  // Only a title that came back replaces the field, so a failure leaves what was typed there.
  async function suggestTitle() {
    setSuggesting(true);
    setSuggestionFailure(undefined);
    try {
      const { data } = await client.query({
        query: SuggestDocumentTitle,
        variables: { ids: documents.map((doc) => doc.id) },
        fetchPolicy: 'no-cache',
      });
      if (!data) {
        throw new Error('The server returned no title');
      }
      form.setFieldValue('title', data.suggestDocumentTitle);
    } catch (error) {
      setSuggestionFailure(messageOf(error) ?? 'The server refused it');
    } finally {
      setSuggesting(false);
    }
  }

  const last = documents.length - 1;
  return (
    <form.AppForm>
      <DialogLayout
        open
        onOpenChange={(open) => {
          if (open === false) {
            onClose();
          }
        }}
        title="Merge documents"
        description="Their pages are put into one PDF, in this order, and filed as a new document. When every one is ready, their text comes with them rather than being read again. Press one to preview it."
        size="xl"
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <div className="grid gap-4 md:grid-cols-2 md:gap-8">
              <div className="grid content-start gap-2">
                <List
                  label="Documents to merge, in page order"
                  contentSlot={documents.map((doc, index) => (
                    <ListItem
                      key={doc.id}
                      leadingSlot={
                        <div className="flex items-center gap-3">
                          <span className="w-5 text-right text-foreground/60 text-sm tabular-nums">{index + 1}</span>
                          <DocumentThumbnail url={thumbnails.get(doc.id)} mimeType={doc.mimeType} />
                        </div>
                      }
                      title={doc.title}
                      // Two documents can share a title in different folders; this says which is which.
                      description={joinStats(
                        doc.folderId === null ? TOP_LEVEL_LABEL : (paths.get(doc.folderId) ?? TOP_LEVEL_LABEL),
                        mergeTypeLabel(doc.mimeType),
                        formatBytes(doc.sizeBytes),
                      )}
                      selected={doc.id === previewing?.id}
                      onClick={() => setPreviewId(doc.id)}
                      actionSlot={
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Move “${doc.title}” up`}
                            hint="Move up"
                            iconSlot={<ChevronUp />}
                            disabled={index === 0}
                            onClick={() => onDocumentsChange(moveCandidate(documents, index, -1))}
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Move “${doc.title}” down`}
                            hint="Move down"
                            iconSlot={<ChevronDown />}
                            disabled={index === last}
                            onClick={() => onDocumentsChange(moveCandidate(documents, index, 1))}
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Leave out “${doc.title}”`}
                            hint="Leave out"
                            iconSlot={<X />}
                            onClick={() => onDocumentsChange(documents.filter((other) => other.id !== doc.id))}
                          />
                        </>
                      }
                    />
                  ))}
                />
                {tooFew && (
                  <Alert
                    title="Pick at least two documents"
                    description="Check another PDF or image in the list to merge it with this one."
                  />
                )}
              </div>
              {previewing && <MergePreview doc={previewing} />}
            </div>
            <InputField
              form={form}
              name="title"
              label="Title"
              required
              validators={{ onSubmit: ({ value }) => titleError(value) }}
              actionSlot={
                visionAvailable && (
                  <Button
                    variant="outline"
                    size="xs"
                    iconSlot={<Sparkles />}
                    content="Suggest a title"
                    loading={suggesting}
                    loadingLabel="Suggesting…"
                    hint="The vision model reads each document's title, date and the start of its text"
                    onClick={suggestTitle}
                  />
                )
              }
            />
            {suggestionFailure && (
              <Alert variant="destructive" title="Could not suggest a title" description={suggestionFailure} />
            )}
            <SelectField
              form={form}
              name="folderId"
              label="Folder"
              options={folderOptions(folders)}
              searchable
              searchPlaceholder="Find a folder"
            />
            <SwitchField
              form={form}
              name="trashOriginals"
              label="Move the originals to the trash"
              description="They can be restored from the trash until it is emptied. Left off, they stay where they are."
            />
            {refusal && <Alert variant="destructive" title="Could not merge them" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton createLabel="Merge" loadingLabel="Merging…" disabled={tooFew} />
          </>
        )}
      />
    </form.AppForm>
  );
}
