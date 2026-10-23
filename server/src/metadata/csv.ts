// CSV as RFC 4180 writes it, for a spreadsheet to open. Every cell is text the user or a receipt
// supplied, so two things are guarded: a comma, quote or line break in it is quoted, and a cell
// a spreadsheet would run as a formula (`=HYPERLINK(…)` as a vendor's name) is defused with a
// leading apostrophe, as OWASP's CSV-injection advice has it.

/** What a spreadsheet takes for the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** What has to be quoted for the cell to stay one cell. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/**
 * One cell, quoted when it has to be.
 *
 * @param value - The cell's text, or nothing for an empty cell.
 * @param [options.isNumber] - The cell is a number this server wrote (a total), which may start
 *   with a minus and is never a formula.
 */
export function csvCell(value: string | null | undefined, { isNumber = false } = {}): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const safe = isNumber === false && FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Rows as CSV, with a header, each line ended by CRLF as RFC 4180 says.
 *
 * @param header - The column names.
 * @param rows - The cells, already passed through `csvCell`.
 */
export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.join(','), ...rows.map((row) => row.join(','))].map((line) => `${line}\r\n`).join('');
}
