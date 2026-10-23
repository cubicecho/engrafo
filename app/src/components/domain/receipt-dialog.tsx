import { useState } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import type { ReceiptValues } from '@/components/domain/document-receipt-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';
import { messageOf } from '@/lib/error-message';
import { currencyError, totalError } from '@/lib/money';

interface ReceiptDialogProps {
  /** The fields as they stand, which the form opens on. */
  receipt: ReceiptValues;
  /** Saves all three, an empty one as null. The dialog closes once this resolves, and says why when it rejects. */
  onSave: (receipt: ReceiptValues) => Promise<unknown>;
  /** Called when the dialog should go away: saved, cancelled or dismissed. */
  onClose: () => void;
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

/**
 * A receipt's vendor, total and currency, as one form in a dialog. The three are saved together
 * and become the user's together: the pipeline leaves the whole receipt alone from then on.
 *
 * The total is a text field, not a number field, because it is sent as the exact decimal typed:
 * a number field would hand back a float, and `0.1 + 0.2` is not a total anyone paid.
 */
export function ReceiptDialog({ receipt, onSave, onClose }: ReceiptDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: {
      vendor: receipt.vendor ?? '',
      total: receipt.total ?? '',
      currency: receipt.currency ?? '',
    },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onSave({
          vendor: orNull(value.vendor),
          total: orNull(value.total)?.replace(',', '.') ?? null,
          currency: orNull(value.currency)?.toUpperCase() ?? null,
        });
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
        title="Receipt details"
        description="Once you save them, processing the document again leaves them alone."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <InputField form={form} name="vendor" label="Vendor" autoFocus />
            <InputField
              form={form}
              name="total"
              label="Total"
              inputMode="decimal"
              placeholder="12.50"
              validators={{ onSubmit: ({ value }) => totalError(value) }}
            />
            <InputField
              form={form}
              name="currency"
              label="Currency"
              description="A three-letter code: EUR, USD, GBP."
              maxLength={3}
              autoCapitalize="characters"
              placeholder="EUR"
              validators={{ onSubmit: ({ value }) => currencyError(value) }}
            />
            {refusal && <Alert variant="destructive" title="Could not save the receipt" description={refusal} />}
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
