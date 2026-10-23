/** What a receipts export is asked for: calendar days, and a folder that includes everything inside it. */
export interface ReceiptsExport {
  from: string | null;
  to: string | null;
  folderId: string | null;
}

/**
 * The export's file name: the range it covers, so two exports do not land as `receipts (1).csv`.
 *
 * @param request - What was exported.
 */
export function exportFilename({ from, to }: ReceiptsExport): string {
  if (from && to) {
    return `receipts-${from}-to-${to}.csv`;
  }
  if (from) {
    return `receipts-from-${from}.csv`;
  }
  return to ? `receipts-to-${to}.csv` : 'receipts.csv';
}
