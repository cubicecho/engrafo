import { useState } from 'react';
import { InputField, SelectField, SwitchField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { titleError } from '@/components/domain/rename-document-dialog';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { ChevronDown, ChevronUp, X } from '@/components/ui/icons';
import { messageOf } from '@/lib/error-message';
import { type FolderRow, folderOptions, TOP_LEVEL } from '@/lib/folder-tree';
import { MERGE_MIN_DOCUMENTS, type MergeCandidate, moveCandidate } from '@/lib/merge';

/** What the dialog asks the server for. */
export interface MergeRequest {
  /** In page order. */
  ids: string[];
  title: string;
  folderId: string | null;
  trashOriginals: boolean;
}

interface MergeDocumentsDialogProps {
  /** The documents picked on the page, in the order their pages go in. */
  documents: readonly MergeCandidate[];
  /** Every folder the caller has, for the picker. */
  folders: readonly FolderRow[];
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
 * "Merge documents": the picked PDFs and images in the order their pages go in, with a button
 * each to move it or take it out, then the merged copy's title and folder and whether the
 * originals go to the trash. Mounted only while open, so the title and folder start from the first
 * document each time.
 */
export function MergeDocumentsDialog({
  documents,
  folders,
  onDocumentsChange,
  onMerge,
  onClose,
}: MergeDocumentsDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const first = documents[0];
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
        description="Their pages are put into one PDF, in this order, filed as a new document and processed like an upload."
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <List
              label="Documents to merge, in page order"
              contentSlot={documents.map((doc, index) => (
                <ListItem
                  key={doc.id}
                  leadingSlot={
                    <span className="w-5 text-right text-foreground/60 text-sm tabular-nums">{index + 1}</span>
                  }
                  title={doc.title}
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
            <InputField
              form={form}
              name="title"
              label="Title"
              required
              validators={{ onSubmit: ({ value }) => titleError(value) }}
            />
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
