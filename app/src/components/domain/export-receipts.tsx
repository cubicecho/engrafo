import { useApolloClient } from '@apollo/client/react';
import { useState } from 'react';
import { graphql } from '@/__generated__';
import { SelectField, useAppForm } from '@/components/app-form';
import { type DateRange, DateRangeField } from '@/components/date-field';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/components/ui/download-button';
import { FormElement } from '@/components/ui/form-element';
import { Download } from '@/components/ui/icons';
import { toCalendarDay } from '@/lib/calendar-day';
import { messageOf } from '@/lib/error-message';
import { type FolderRow, folderOptions, TOP_LEVEL } from '@/lib/folder-tree';
import { exportFilename, type ReceiptsExport } from '@/lib/receipts';

export const ReceiptsCsv = graphql(`
  query ReceiptsCsv($from: String, $to: String, $folderId: UUID) {
    receiptsCsv(from: $from, to: $to, folderId: $folderId)
  }
`);

interface ExportReceiptsDialogProps {
  /** Every folder of the caller's, for the picker. */
  folders: readonly FolderRow[];
  /** Fetches and saves the file. The dialog closes once this resolves, and says why when it rejects. */
  onExport: (request: ReceiptsExport) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Which receipts go in the CSV: a date range by the date on each receipt, and a folder. Both may
 * be left empty for every receipt there is. A receipt with no date is only in an export with no
 * range, which the description says, since a missing row is otherwise a mystery.
 */
export function ExportReceiptsDialog({ folders, onExport, onClose }: ExportReceiptsDialogProps) {
  const [refusal, setRefusal] = useState<string | undefined>();
  const form = useAppForm({
    defaultValues: { range: null as DateRange | null, folderId: null as string | null },
    onSubmit: async ({ value }) => {
      setRefusal(undefined);
      try {
        await onExport({
          from: value.range?.from ? toCalendarDay(value.range.from) : null,
          to: value.range?.to ? toCalendarDay(value.range.to) : null,
          folderId: value.folderId,
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
        title="Export receipts"
        description="A CSV of date, vendor, total, currency, title and folder, for a spreadsheet or an accountant."
        contentSlot={
          <FormElement className="grid gap-4" onSubmit={() => form.handleSubmit()}>
            <DateRangeField
              form={form}
              name="range"
              label="Dated"
              placeholder="Any date"
              description="By the date on each receipt. A receipt with no date is only in an export of any date."
            />
            <SelectField
              form={form}
              name="folderId"
              label="Folder"
              options={folderOptions(folders).filter((option) => 'value' in option && option.value !== TOP_LEVEL)}
              clearable
              emptyLabel="Every folder"
              description="With every folder inside it."
            />
            {refusal && <Alert variant="destructive" title="Could not export the receipts" description={refusal} />}
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" content="Cancel" onClick={close} />
            <form.SubmitButton content="Download CSV" pendingLabel="Exporting…" />
          </>
        )}
      />
    </form.AppForm>
  );
}

interface ExportReceiptsButtonProps {
  folders: readonly FolderRow[];
}

/**
 * Opens the export, and saves what it returns. A GraphQL query rather than a link: a session is a
 * bearer token, not a cookie, so a plain `<a href>` to a CSV route would arrive signed out.
 */
export function ExportReceiptsButton({ folders }: ExportReceiptsButtonProps) {
  const client = useApolloClient();
  const [open, setOpen] = useState(false);

  async function exportReceipts(request: ReceiptsExport) {
    const { data } = await client.query({ query: ReceiptsCsv, variables: request, fetchPolicy: 'network-only' });
    if (!data) {
      throw new Error('The server returned no file');
    }
    await downloadBlob(data.receiptsCsv, exportFilename(request), { mimeType: 'text/csv' });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        iconSlot={<Download />}
        content="Export receipts"
        onClick={() => setOpen(true)}
      />
      {open && <ExportReceiptsDialog folders={folders} onExport={exportReceipts} onClose={() => setOpen(false)} />}
    </>
  );
}
