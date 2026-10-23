import { useState } from 'react';
import { SelectField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { type FolderRow, folderOptions, TOP_LEVEL } from '@/lib/folder-tree';

interface MoveDialogProps {
  /** What is moving, as the heading names it: a document's title or a folder's name. */
  name: string;
  /** Every folder the caller has, for the picker. */
  folders: readonly FolderRow[];
  /** Where it is now, or null for the top level. The picker opens on it. */
  currentFolderId: string | null;
  /** Folders it may not go into: for a folder, itself and everything under it. */
  exclude?: ReadonlySet<string> | undefined;
  /** Moves it into the folder chosen, or to the top level for null. Rejecting keeps the dialog open. */
  onMove: (folderId: string | null) => Promise<unknown>;
  onClose: () => void;
}

/**
 * "Move to…": the way to move a row without dragging it, which needs a pointer. Every row in the
 * tree has it, and it calls the same mutation the drag does.
 */
export function MoveDialog({ name, folders, currentFolderId, exclude, onMove, onClose }: MoveDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: { folderId: currentFolderId ?? TOP_LEVEL },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onMove(value.folderId === TOP_LEVEL ? null : value.folderId);
      } catch (error) {
        setRefusal(messageOf(error) ?? 'The server refused it');
        return;
      }
      onClose();
    },
  });

  return (
    <form.AppForm>
      <DialogLayout
        open
        onOpenChange={(open) => {
          if (open === false) {
            onClose();
          }
        }}
        title={`Move “${name}”`}
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <SelectField
              form={form}
              name="folderId"
              label="Folder"
              options={folderOptions(folders, exclude)}
              searchable
              searchPlaceholder="Find a folder"
            />
            {refusal && <Alert variant="destructive" title="Could not move it" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Move" pendingLabel="Moving…" requireChanges />
          </>
        )}
      />
    </form.AppForm>
  );
}
