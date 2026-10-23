import { useState } from 'react';
import { useAppForm } from '@/components/app-form';
import { DateField } from '@/components/date-field';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { fromCalendarDay, toCalendarDay } from '@/lib/calendar-day';
import { messageOf } from '@/lib/error-message';

interface DocumentDateDialogProps {
  /** The date as it stands, `YYYY-MM-DD`, or null when the document has none. */
  date: string | null;
  /** Saves the day chosen, or null to clear it. The dialog closes once this resolves, and says why when it rejects. */
  onSave: (date: string | null) => Promise<unknown>;
  /** Called when the dialog should go away: saved, cancelled or dismissed. */
  onClose: () => void;
}

/**
 * The date on a document, as a form in a dialog. Saving, a date or a cleared one, makes it the
 * user's: the pipeline does not read another from the text when the document is processed again,
 * which the description says so the choice is not a surprise later.
 */
export function DocumentDateDialog({ date, onSave, onClose }: DocumentDateDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: { date: fromCalendarDay(date) },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onSave(value.date ? toCalendarDay(value.date) : null);
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
        title="Document date"
        description="The date on the document itself. Once you set or clear it, processing again leaves it alone."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <DateField form={form} name="date" label="Date" placeholder="No date" clearable />
            {refusal && <Alert variant="destructive" title="Could not save the date" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Save" requireChanges />
          </>
        )}
      />
    </form.AppForm>
  );
}
