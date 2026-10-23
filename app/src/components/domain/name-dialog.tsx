import { useState } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';

interface NameDialogProps {
  /** The dialog's heading: "New folder", "Rename document". */
  title: string;
  description?: string | undefined;
  /** What the one field is called. */
  label: string;
  /** The name the field opens on: empty for a new thing, the current one for a rename. */
  initial?: string | undefined;
  /** The submit's words. */
  submitLabel?: string | undefined;
  /** What is wrong with the name as typed, before anything is sent, or undefined when nothing is. */
  validate: (name: string) => string | undefined;
  /** Saves the trimmed name. The dialog closes once this resolves, and stays open saying why when it rejects. */
  onSave: (name: string) => Promise<unknown>;
  /** Called when the dialog should go away: saved, cancelled or dismissed. */
  onClose: () => void;
}

/**
 * One name in a dialog, with a Save and a Cancel: a new folder, a rename. A name is never edited
 * where it is drawn.
 *
 * A refusal only the server can make — "something called that is already there" — is an alert
 * under the field, and the dialog stays open so the name can be changed and sent again. Mounted
 * only while open, so each opening starts from `initial`, not from what was typed last time.
 */
export function NameDialog({
  title,
  description,
  label,
  initial = '',
  submitLabel = 'Save',
  validate,
  onSave,
  onClose,
}: NameDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: { name: initial },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onSave(value.name.trim());
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
        title={title}
        description={description}
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <InputField
              form={form}
              name="name"
              label={label}
              required
              autoFocus
              validators={{ onSubmit: ({ value }) => validate(value) }}
            />
            {refusal && (
              <Alert variant="destructive" title={`Could not save the ${label.toLowerCase()}`} description={refusal} />
            )}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content={submitLabel} requireChanges={initial !== ''} />
          </>
        )}
      />
    </form.AppForm>
  );
}
