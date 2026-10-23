// A receipt's total arrives as an exact decimal string (`12.50`), never a float, and is sent back
// the same way. These are the only two places it becomes anything else: drawn for a reader, and
// read from what the reader typed.

/**
 * A total as the reader writes money: `€12.50`, `$1,200.00`, or the bare amount when there is no
 * currency to put beside it.
 *
 * @param total - The exact decimal the server holds.
 * @param currency - Its ISO 4217 code, when the receipt named one.
 */
export function formatMoney(total: string, currency: string | null): string {
  if (currency === null) {
    return total;
  }
  try {
    // Display only: a float is close enough to draw, and the stored amount stays exact.
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(total));
  } catch {
    // A code Intl does not know still says what was paid.
    return `${total} ${currency}`;
  }
}

/** An amount as typed: digits, then a point or a comma and up to three more. */
const TOTAL = /^\d{1,12}(?:[.,]\d{1,3})?$/;

/**
 * What is wrong with a total as typed, or undefined when nothing is. Empty is fine: it clears it.
 *
 * @param total - The field's text.
 */
export function totalError(total: string): string | undefined {
  return total.trim() === '' || TOTAL.test(total.trim()) ? undefined : 'An amount such as 12.50';
}

/**
 * What is wrong with a currency as typed, or undefined when nothing is. Empty is fine.
 *
 * @param currency - The field's text.
 */
export function currencyError(currency: string): string | undefined {
  return currency.trim() === '' || /^[A-Za-z]{3}$/.test(currency.trim())
    ? undefined
    : 'A three-letter code such as EUR';
}
