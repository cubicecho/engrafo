import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';

interface RenameDocumentDialogProps {
  /** The title as it stands, which the field opens on. */
  title: string;
  /** Saves the trimmed title. The dialog closes once this resolves. */
  onRename: (title: string) => Promise<unknown>;
  /** Called when the dialog should go away: saved, cancelled or dismissed. */
  onClose: () => void;
}

/**
 * Renaming is a form in a dialog, with a Save and a Cancel, rather than the
 * title turning into an input in place.
 *
 * Mounted only while it is open, so each opening starts from the title as it
 * is now and not from whatever was typed and abandoned last time.
 */
export function RenameDocumentDialog({ title, onRename, onClose }: RenameDocumentDialogProps) {
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
