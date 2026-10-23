import { METADATA_DEFAULTS } from '../core/defaults.ts';

// A receipt's vendor, total and currency, read from its text by rules rather than by a model.
// There is no model wired into this codebase, and a wrong total in an expense export is worse
// than an empty one, so every rule here errs towards leaving a field empty: no labelled total,
// no receipt at all; a `$` that could be five currencies, no currency.
//
// `ReceiptExtractor` is the seam. A model-based extractor (a vision model over the image, or a
// language model over the text) can replace `extractReceipt` without the step or the columns
// changing, as long as it keeps the contract: null for anything it is not sure of.

/** What a receipt says, each field null when the text does not say it clearly. */
export interface ReceiptFields {
  /** Who it is from: the shop, the restaurant, the company. */
  vendor: string | null;
  /** What was paid, as an exact decimal string (`12.50`), never a float. */
  total: string | null;
  /** ISO 4217, upper case. */
  currency: string | null;
}

/**
 * Reads a receipt's fields from its text. Async in the type so a model behind a network call fits
 * the same slot; the rules below answer at once.
 */
export type ReceiptExtractor = (text: string) => ReceiptFields | Promise<ReceiptFields>;

/** Nothing found: what a letter, a manual or a photo with no text gives. */
export const NO_RECEIPT: Readonly<ReceiptFields> = Object.freeze({ vendor: null, total: null, currency: null });

// A label that names the amount paid. Longest first, so `grand total` is not read as `total`.
// English and German, as the receipts this was written against are.
const TOTAL_LABEL =
  /\b(?:grand\s+total|total\s+(?:due|amount|to\s+pay|payable|incl\.?)|amount\s+(?:due|payable|paid)|balance\s+due|total|gesamtsumme|gesamtbetrag|gesamt|endbetrag|rechnungsbetrag|zu\s+zahlen|summe)\b/i;
// A labelled amount that is not the total: a part of it, or what was handed over and given back.
// `zwischensumme` needs no rule, as `\bsumme` cannot match inside it.
const NOT_THE_TOTAL =
  /\b(?:sub[\s-]?total|total\s+(?:tax|vat|discount|savings|items?|qty|quantity|net)|(?:tax|vat)\s+total|net\s+total|nettosumme|summe\s+netto|tendered|change|cash\s+back|rückgeld|wechselgeld|gegeben)\b/i;

// An amount as receipts print it: `12.50`, `12,50`, `1,234.56`, `1.234,56`, `1'234.50`, `1200`.
// Grouped thousands first, then a plain run of digits, each with at most two decimals.
const AMOUNT = /(?<![\d.,'])(?:\d{1,3}(?:[.,']\d{3})+|\d+)(?:[.,]\d{1,2})?(?!\d|[.,]\d)/g;

// Codes this reads. A closed list, so a word in capitals (VAT, TAX, QTY) is never a currency.
const CURRENCY_CODES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'JPY',
  'CAD',
  'AUD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'BGN',
  'TRY',
  'INR',
  'CNY',
  'HKD',
  'SGD',
  'KRW',
  'BRL',
  'MXN',
  'ZAR',
  'ILS',
  'AED',
] as const;
const CURRENCY_CODE = new RegExp(`(?<![A-Za-z])(${CURRENCY_CODES.join('|')})(?![A-Za-z])`);

// Symbols that name one currency. `$`, `¥` and `kr` are each several, so they are absent. A
// prefixed dollar is not part of a longer one, so `US$` is not also `S$`.
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![A-Z])US\$/i, 'USD'],
  [/(?<![A-Z])CA?\$/i, 'CAD'],
  [/(?<![A-Z])AU?\$/i, 'AUD'],
  [/(?<![A-Z])NZ\$/i, 'NZD'],
  [/(?<![A-Z])HK\$/i, 'HKD'],
  [/(?<![A-Z])S\$/i, 'SGD'],
  [/(?<![A-Z])R\$/i, 'BRL'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/₹/, 'INR'],
  [/₩/, 'KRW'],
  [/₺/, 'TRY'],
  [/₪/, 'ILS'],
  [/zł/i, 'PLN'],
  [/Kč/, 'CZK'],
  [/円/, 'JPY'],
];

// A first line that names the kind of paper, or a way to reach the shop, rather than the shop.
const NOT_A_VENDOR =
  /^(?:receipt|sales\s+receipt|tax\s+invoice|invoice|rechnung|quittung|kassenbon|kassenbeleg|beleg|bon|welcome|willkommen|thank\s+you|danke)\b|https?:|www\.|@|\b(?:tel|phone|fax)\b/i;
/** A vendor line has to be mostly letters: a line of digits is an address or a till number. */
const MIN_LETTER_SHARE = 0.5;
const MIN_LETTERS = 2;
const LETTER = /\p{L}/gu;
const DECIMAL_DIGITS = 2;

/**
 * An amount as printed, as an exact decimal string.
 *
 * @param printed - One match of `AMOUNT`: `1.234,56`, `12,5`, `1,234`.
 * @returns `1234.56`, `12.50`, `1234`. The separator followed by one or two digits at the end is the
 *   decimal point, whichever it is; every other separator groups thousands.
 */
export function parseAmount(printed: string): string {
  const decimal = /[.,](\d{1,2})$/.exec(printed);
  const whole = (decimal ? printed.slice(0, decimal.index) : printed).replace(/[.,']/g, '');
  const wholeDigits = whole.replace(/^0+(?=\d)/, '');
  return decimal ? `${wholeDigits}.${(decimal[1] ?? '').padEnd(DECIMAL_DIGITS, '0')}` : wholeDigits;
}

/** The currency a line names, by code first and then by an unambiguous symbol. */
function currencyIn(line: string): string | null {
  const code = CURRENCY_CODE.exec(line.toUpperCase());
  if (code) {
    return code[1] ?? null;
  }
  return CURRENCY_SYMBOLS.find(([symbol]) => symbol.test(line))?.[1] ?? null;
}

interface Candidate {
  total: string;
  value: number;
  currency: string | null;
}

/**
 * The amounts on a label's line, after the label. A receipt's columns are often split onto the
 * next line by OCR, so a label with nothing after it takes the next line's amount, if that line is
 * an amount and nothing else.
 */
function labelledAmount(lines: readonly string[], index: number, labelEnd: number): Candidate | null {
  const line = lines[index] ?? '';
  const after = line.slice(labelEnd);
  let amounts = [...after.matchAll(AMOUNT)].map((match) => match[0]);
  let source = line;
  if (amounts.length === 0) {
    const next = (lines[index + 1] ?? '').trim();
    const isBareAmount =
      next
        .replace(AMOUNT, '')
        .replace(CURRENCY_CODE, '')
        .replace(/[\s:€£$*-]/g, '') === '';
    if (next === '' || isBareAmount === false) {
      return null;
    }
    amounts = [...next.matchAll(AMOUNT)].map((match) => match[0]);
    source = `${line} ${next}`;
  }
  // The rightmost column is the amount; anything before it is a count or a rate.
  const printed = amounts.at(-1);
  if (printed === undefined) {
    return null;
  }
  const currency = currencyIn(source);
  // A whole number with no currency beside it is a count, a table number, a till: not money.
  const isMoney = /[.,]\d{1,2}$/.test(printed) || currency !== null;
  if (isMoney === false) {
    return null;
  }
  const total = parseAmount(printed);
  return { total, value: Number(total), currency };
}

/** The one currency the whole text names, or null when it names none or several. */
function onlyCurrency(text: string): string | null {
  const found = new Set<string>();
  for (const match of text.toUpperCase().matchAll(new RegExp(CURRENCY_CODE.source, 'g'))) {
    found.add(match[1] ?? '');
  }
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (symbol.test(text)) {
      found.add(code);
    }
  }
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

/** The first of the opening lines that reads like a name. */
function vendorOf(lines: readonly string[]): string | null {
  const opening = lines
    .map((line) =>
      line
        .replace(/[*=_~#|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line !== '')
    .slice(0, METADATA_DEFAULTS.vendorScanLines);
  for (const line of opening) {
    const letters = line.match(LETTER)?.length ?? 0;
    const visible = line.replace(/\s/g, '').length;
    const isWordy = letters >= MIN_LETTERS && letters / visible >= MIN_LETTER_SHARE;
    const isLabel = NOT_A_VENDOR.test(line) || TOTAL_LABEL.test(line);
    if (isWordy && isLabel === false && line.length <= METADATA_DEFAULTS.vendorMaxLength) {
      return line;
    }
  }
  return null;
}

/**
 * Reads a receipt's vendor, total and currency from its text, by rules.
 *
 * @param text - The document's text, as the pipeline extracted it.
 * @returns The fields. All null unless a labelled total is found: a document with no total is not
 *   taken for a receipt, so a letter's first line is never filed as a vendor.
 *
 * @remarks
 * The total is the largest labelled amount that is not a subtotal, a tax line, or cash handed over
 * or given back. Largest rather than last, because a net and a tax line are each smaller than the
 * total they add up to, wherever the receipt prints them. The currency is the total line's, else
 * the one currency the receipt names anywhere, else nothing. The vendor is the first opening line
 * that reads like a name.
 */
export function extractReceipt(text: string): ReceiptFields {
  const lines = text.slice(0, METADATA_DEFAULTS.receiptScanChars).split('\n');
  const candidates: Candidate[] = [];
  lines.forEach((line, index) => {
    const label = TOTAL_LABEL.exec(line);
    if (label === null || NOT_THE_TOTAL.test(line)) {
      return;
    }
    const candidate = labelledAmount(lines, index, label.index + label[0].length);
    if (candidate) {
      candidates.push(candidate);
    }
  });
  // Ties go to the later line, which is the one printed under the others.
  const best = candidates.reduce<Candidate | null>(
    (top, candidate) => (top === null || candidate.value >= top.value ? candidate : top),
    null,
  );
  if (best === null) {
    return { ...NO_RECEIPT };
  }
  return {
    vendor: vendorOf(lines),
    total: best.total,
    currency: best.currency ?? onlyCurrency(text),
  };
}
