import { useState } from 'react';
import { SwitchField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';

interface ReadFolderWithVisionDialogProps {
  /** The folder's path, as the tree names it: `Taxes/2026`. */
  path: string;
  /** Whether the folder has folders inside it, so the switch is only offered where it means something. */
  hasSubfolders: boolean;
  /** Starts the read. The dialog closes once this resolves, and stays open saying why when it rejects. */
  onRead: (includeSubfolders: boolean) => Promise<unknown>;
  /** Called when the dialog should go away: started, cancelled or dismissed. */
  onClose: () => void;
}

/**
 * Reading a whole folder with the vision model is a form in a dialog: whether to go into the
 * folders inside it, and a button that says what it will do. It is asked first because it is
 * slow and it replaces text, not because it cannot be undone.
 */
export function ReadFolderWithVisionDialog({ path, hasSubfolders, onRead, onClose }: ReadFolderWithVisionDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: { includeSubfolders: true },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onRead(hasSubfolders && value.includeSubfolders);
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
          if (!open) {
            onClose();
          }
        }}
        title={`Read “${path}” with the vision model?`}
        description="Every PDF and image in it is read again by the vision model, and the text it writes replaces what OCR found. A document still being processed is left as it is. Each is queued, and the Processing page shows how far it has got."
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            {hasSubfolders ? (
              <SwitchField
                form={form}
                name="includeSubfolders"
                label="Include folders inside it"
                description="Off, only the documents directly in this folder are read."
              />
            ) : null}
            {refusal && <Alert variant="destructive" title="Could not start the read" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Read with vision" pendingLabel="Queueing…" />
          </>
        )}
      />
    </form.AppForm>
  );
}
