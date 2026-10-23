import { SwitchField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';

interface ReprocessDocumentDialogProps {
  /** Whether the document was last processed with OCR, which the switch opens on. */
  ocrRequested: boolean;
  /** Whether this server can run OCR at all. Undefined while that is still being asked. */
  ocrAvailable: boolean | undefined;
  /** Starts the run with OCR on or off. The dialog closes once this resolves. */
  onReprocess: (ocr: boolean) => Promise<unknown>;
  /** Called when the dialog should go away: started, cancelled or dismissed. */
  onClose: () => void;
}

/**
 * Re-running processing is a form in a dialog: whether to OCR this time, and a button that says
 * what it will do. Mounted only while open, so each opening starts from the document as it is.
 */
export function ReprocessDocumentDialog({
  ocrRequested,
  ocrAvailable,
  onReprocess,
  onClose,
}: ReprocessDocumentDialogProps) {
  const form = useAppForm({
    defaultValues: { ocr: ocrRequested },
    onSubmit: async ({ value }) => {
      // Never ask for OCR the server cannot run: it would refuse the whole re-run.
      await onReprocess(value.ocr && ocrAvailable === true);
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
        title="Re-run processing"
        description="Every step runs again from the uploaded file. The searchable PDF and text from the last run are replaced."
        contentSlot={
          <FormElement onSubmit={() => form.handleSubmit()}>
            <SwitchField
              form={form}
              name="ocr"
              label="Run OCR"
              description={
                ocrAvailable === undefined
                  ? 'Checking whether this server can run OCR…'
                  : ocrAvailable
                    ? 'Recognise text in scanned pages. Pages that already have text keep it.'
                    : 'ocrmypdf is not installed on the server.'
              }
              disabled={ocrAvailable !== true}
            />
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Re-run" pendingLabel="Starting…" disabled={ocrAvailable === undefined} />
          </>
        )}
      />
    </form.AppForm>
  );
}
