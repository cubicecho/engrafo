import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { findDates } from '../metadata/document-date.ts';
import { isOcrable } from '../pipeline/mime.ts';

// The traces a scan filed as several documents leaves, read for one question about an ordered
// pair: does B carry on where A stops? Each signal says what it found and, when that counts for
// or against, why, in words for the person deciding. score.ts weighs them.
//
// Pure: everything comes from the two candidates and the settings.

/** What the scorer knows about one document: only what is cheap to read for every recent one. */
export interface MergeCandidate {
  id: string;
  /** When it was filed: the nearest thing to when it was scanned that every upload has. */
  createdAt: Date;
  /** The name it was uploaded under, which is where a scanner's or a phone's numbering is. */
  originalFilename: string;
  /** Null is the top level. */
  folderId: string | null;
  mimeType: string;
  /** The day printed on it, `YYYY-MM-DD`, as extracted or as the user set it. */
  documentDate: string | null;
  /** The receipt's vendor, as extracted or as the user set it. */
  vendor: string | null;
  /** The first `aiContextChars` characters of its extracted text; empty when it has none. */
  textHead: string;
  /** The last `aiContextChars` characters; the whole text again when it is shorter. */
  textTail: string;
  /** The mean of its passages' embeddings, or null when it has none. */
  meanEmbedding: number[] | null;
}

/** What one signal found about a pair. */
export interface Signal<Kind extends string> {
  kind: Kind;
  /** Why it counts, for the person deciding; null when it has nothing to say. */
  reason: string | null;
}

export type TimeGapKind = 'close' | 'near' | 'apart' | 'far';
export type FilenameKind = 'next' | 'series' | 'unrelated';
export type PageMarkerKind = 'consecutive' | 'sameSet' | 'restart' | 'complete' | 'conflict' | 'none';
export type IdentifierKind = 'shared' | 'none';
/** How a field both documents may carry compares: the first's only is what a continuation looks like. */
export type FieldKind = 'agree' | 'onlyFirst' | 'conflict' | 'none';
export type TextFlowKind = 'runsOn' | 'freshStart' | 'none';
export type EmbeddingKind = 'similar' | 'dissimilar' | 'none';

export interface TimeGapSignal extends Signal<TimeGapKind> {
  /** How far apart the two were filed, either way round. */
  seconds: number;
}

/** "Page 2 of 3", as printed on a page. */
export interface PageMarker {
  page: number;
  /** Null when the page states no count, as in a lone "Page 2". */
  total: number | null;
}

export interface PageMarkerSignal extends Signal<PageMarkerKind> {
  /** The last marker A shows: the page it ends on. */
  end: PageMarker | null;
  /** The first marker B shows: the page it starts on. */
  start: PageMarker | null;
}

/** A labelled number, such as an invoice's, printed on both documents. */
export interface SharedIdentifier {
  /** What the label calls it, ready for a sentence: `invoice no.`. */
  label: string;
  /** As printed where it was labelled. */
  value: string;
}

export interface IdentifierSignal extends Signal<IdentifierKind> {
  identifiers: SharedIdentifier[];
}

export interface EmbeddingSignal extends Signal<EmbeddingKind> {
  /** Null when either document has no embedding, or they have different lengths. */
  cosine: number | null;
}

/** Every signal for "B continues A". */
export interface PairSignals {
  timeGap: TimeGapSignal;
  filename: Signal<FilenameKind>;
  pageMarkers: PageMarkerSignal;
  identifiers: IdentifierSignal;
  documentDate: Signal<FieldKind>;
  vendor: Signal<FieldKind>;
  textFlow: Signal<TextFlowKind>;
  embedding: EmbeddingSignal;
}

/**
 * Whether two documents are compared at all: both have pages to merge, they are in the same
 * folder, and they were filed within `pairWindowHours` of each other.
 *
 * @param a - One candidate.
 * @param b - The other; the order does not matter.
 * @param settings - The window.
 * @returns true when the pair is worth scoring.
 */
export function isCandidatePair(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): boolean {
  // The merge's own rule: only PDFs and images have pages.
  const bothHavePages = isOcrable(a.mimeType) && isOcrable(b.mimeType);
  const sameFolder = a.folderId === b.folderId;
  const withinWindow = gapSeconds(a, b) <= settings.pairWindowHours * SECONDS_PER_HOUR;
  return a.id !== b.id && bothHavePages && sameFolder && withinWindow;
}

/**
 * Reads every signal for "B continues A".
 *
 * @param a - The document that would come first.
 * @param b - The document that would follow it.
 * @param settings - The cutoffs each signal decides by.
 * @returns One value per signal, each with its reason when it has one.
 */
export function readSignals(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): PairSignals {
  return {
    timeGap: timeGapSignal(a, b, settings),
    filename: filenameSignal(a, b),
    pageMarkers: pageMarkerSignal(a, b, settings),
    identifiers: identifierSignal(a, b, settings),
    documentDate: documentDateSignal(a, b),
    vendor: vendorSignal(a, b),
    textFlow: textFlowSignal(a, b, settings),
    embedding: embeddingSignal(a, b, settings),
  };
}

function gapSeconds(a: MergeCandidate, b: MergeCandidate): number {
  return Math.abs(b.createdAt.getTime() - a.createdAt.getTime()) / MS_PER_SECOND;
}

/**
 * How far apart in time the two were filed. A sheet feeder files a page every few seconds; an
 * unrelated document usually comes hours later.
 *
 * @param a - The first document.
 * @param b - The second.
 * @param settings - `closeSeconds`, `nearSeconds` and `farSeconds`.
 * @returns The gap, and its reason unless it is too long to help and too short to hurt.
 */
export function timeGapSignal(a: MergeCandidate, b: MergeCandidate, settings: MergeSuggestionSettings): TimeGapSignal {
  const seconds = gapSeconds(a, b);
  const kind = timeGapKind(seconds, settings);
  const isNeutral = kind === 'apart';
  return { kind, seconds, reason: isNeutral ? null : `scanned ${formatGap(seconds)} apart` };
}

function timeGapKind(seconds: number, settings: MergeSuggestionSettings): TimeGapKind {
  if (seconds <= settings.closeSeconds) {
    return 'close';
  }
  if (seconds <= settings.nearSeconds) {
    return 'near';
  }
  return seconds > settings.farSeconds ? 'far' : 'apart';
}

function formatGap(seconds: number): string {
  if (seconds < SECONDS_PER_MINUTE) {
    return `${Math.round(seconds)} s`;
  }
  if (seconds < SECONDS_PER_HOUR) {
    return `${Math.round(seconds / SECONDS_PER_MINUTE)} min`;
  }
  return `${Math.round(seconds / SECONDS_PER_HOUR)} h`;
}

/** A file name read as a place in a numbered series. */
interface NumberedName {
  /** Lower case, without its extension. */
  name: string;
  /** What every name in its series shares; `#` stands where the number is. */
  stem: string;
  number: number | null;
  /** Numbered by a copy counter, `Scan (2)`, which is added to a name that had none. */
  isCopy: boolean;
}

/** Where two names sit in one numbered series. */
export interface SeriesPlace {
  first: number;
  second: number;
  /** The second is the next number after the first. */
  isNext: boolean;
}

const EXTENSION = /\.[a-z0-9]{1,5}$/i;
// `Scan (2)`: what a browser, an OS or a scanner app adds when the name is taken.
const COPY_COUNTER = /^(.*?)\s*\((\d+)\)$/;
// The last run of digits: `scan_0003`, `IMG_1234`, `page3-final`.
const LAST_NUMBER = /^(.*?)(\d+)(\D*)$/;
/** Where the name a copy counter was added to sits: before `(1)`. */
const UNNUMBERED_POSITION = 0;
// Windows numbers the first copy `(2)`, macOS and most scanner apps `(1)`, so either follows the
// plain name.
const FIRST_COPY_NUMBERS: ReadonlySet<number> = new Set([1, 2]);

function numberedName(filename: string): NumberedName {
  const name = filename.trim().toLowerCase().replace(EXTENSION, '');
  const copy = COPY_COUNTER.exec(name);
  if (copy) {
    return { name, stem: copy[1] ?? '', number: Number(copy[2]), isCopy: true };
  }
  const numbered = LAST_NUMBER.exec(name);
  if (numbered) {
    return { name, stem: `${numbered[1]}#${numbered[3]}`, number: Number(numbered[2]), isCopy: false };
  }
  return { name, stem: name, number: null, isCopy: false };
}

/**
 * Where two file names sit in one numbered series, ignoring case, zero padding and extensions:
 * `scan_0003.pdf` and `SCAN_4.jpg`, `IMG_1234` and `IMG_1235`, `Scan (1)` and `Scan (2)`, and a
 * plain `Scan` before its first copy.
 *
 * @param first - One file name.
 * @param second - The other.
 * @returns Both positions, or null when the names are not one series.
 */
export function seriesPlace(first: string, second: string): SeriesPlace | null {
  const a = numberedName(first);
  const b = numberedName(second);
  if (a.number !== null && b.number !== null && a.isCopy === b.isCopy && a.stem === b.stem) {
    return { first: a.number, second: b.number, isNext: b.number === a.number + 1 };
  }
  if (b.isCopy && b.number !== null && b.stem === a.name) {
    return { first: UNNUMBERED_POSITION, second: b.number, isNext: FIRST_COPY_NUMBERS.has(b.number) };
  }
  if (a.isCopy && a.number !== null && a.stem === b.name) {
    return { first: a.number, second: UNNUMBERED_POSITION, isNext: false };
  }
  return null;
}

/**
 * Whether B's file name is the next in A's series, as a scanner or a phone numbers its files.
 *
 * @param a - The first document.
 * @param b - The second.
 * @returns `next`, `series` for the same series in any other order, or `unrelated`. The reasons
 *   name no file, so a group's steps share one.
 */
export function filenameSignal(a: MergeCandidate, b: MergeCandidate): Signal<FilenameKind> {
  const place = seriesPlace(a.originalFilename, b.originalFilename);
  if (place === null) {
    return { kind: 'unrelated', reason: 'unrelated file names' };
  }
  if (place.isNext) {
    return { kind: 'next', reason: 'named in sequence' };
  }
  return { kind: 'series', reason: 'from the same numbered series' };
}

// "Page 2 of 3", "Seite 2 von 3", "page 2/3": anywhere, since it states a count.
const WORD_MARKER = /(?<!\p{L})(?:page|seite|blatt)\s+(\d{1,3})\s*(?:of|von|\/)\s*(\d{1,3})(?!\d)/giu;
// "p. 2 of 3", "S. 2 von 3".
const ABBREVIATED_MARKER = /(?<!\p{L})(?:p|pg|s)\.\s*(\d{1,3})\s*(?:of|von|\/)\s*(\d{1,3})(?!\d)/giu;
// A lone "Page 2" or a bare "2/3" is too common in running text ("see page 2", "2/3 of the
// amount") to count anywhere but on a line of its own, where a footer puts it.
const LONE_WORD_MARKER = /^[\s\-–]*(?:page|seite|blatt)\s+(\d{1,3})[\s\-–]*$/gimu;
const BARE_MARKER = /^[\s\-–]*(\d{1,3})\s*\/\s*(\d{1,3})[\s\-–]*$/gmu;
const MARKER_PATTERNS = [WORD_MARKER, ABBREVIATED_MARKER, LONE_WORD_MARKER, BARE_MARKER];

interface FoundMarker extends PageMarker {
  index: number;
}

function findMarkers(text: string, maxPageTotal: number): FoundMarker[] {
  const found = MARKER_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      index: match.index,
      page: Number(match[1]),
      total: match[2] === undefined ? null : Number(match[2]),
    })),
  );
  const plausible = found.filter(
    (marker) =>
      marker.page >= 1 && (marker.total === null || (marker.page <= marker.total && marker.total <= maxPageTotal)),
  );
  return plausible.sort((x, y) => x.index - y.index);
}

/**
 * The page a document starts on, from the first marker in its head, else its tail (a footer on
 * a page longer than the head).
 *
 * @param candidate - The document.
 * @param settings - `maxPageTotal`.
 * @returns The marker, or null when it prints none.
 */
export function pageStart(
  candidate: MergeCandidate,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): PageMarker | null {
  const [first] = [
    ...findMarkers(candidate.textHead, settings.maxPageTotal),
    ...findMarkers(candidate.textTail, settings.maxPageTotal),
  ];
  return first ? { page: first.page, total: first.total } : null;
}

/**
 * The page a document ends on, from the last marker in its tail, else its head.
 *
 * @param candidate - The document.
 * @param settings - `maxPageTotal`.
 * @returns The marker, or null when it prints none.
 */
export function pageEnd(
  candidate: MergeCandidate,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): PageMarker | null {
  const last = [
    ...findMarkers(candidate.textHead, settings.maxPageTotal),
    ...findMarkers(candidate.textTail, settings.maxPageTotal),
  ].at(-1);
  return last ? { page: last.page, total: last.total } : null;
}

function formatMarker(marker: PageMarker): string {
  return marker.total === null ? `page ${marker.page}` : `page ${marker.page} of ${marker.total}`;
}

/**
 * Whether the pages A and B print say B comes next. A "page 1" on B is a document starting,
 * whatever A says, and A on its last page with B unnumbered is a document that has ended.
 *
 * @param a - The first document.
 * @param b - The second.
 * @param settings - `maxPageTotal`.
 * @returns The page A ends on and B starts on, and how they fit.
 */
export function pageMarkerSignal(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings,
): PageMarkerSignal {
  const end = pageEnd(a, settings);
  const start = pageStart(b, settings);
  if (start === null) {
    const endsOnLastPage = end !== null && end.page === end.total;
    return endsOnLastPage
      ? { kind: 'complete', reason: `${a.originalFilename} ends on its last page (${formatMarker(end)})`, end, start }
      : { kind: 'none', reason: null, end, start };
  }
  if (start.page === 1) {
    return { kind: 'restart', reason: `${b.originalFilename} is a first page (${formatMarker(start)})`, end, start };
  }
  if (end === null) {
    return { kind: 'none', reason: null, end, start };
  }
  const total = start.total ?? end.total;
  const countsDiffer = start.total !== null && end.total !== null && start.total !== end.total;
  if (countsDiffer) {
    return {
      kind: 'conflict',
      reason: `page counts differ (${formatMarker(end)}, ${formatMarker(start)})`,
      end,
      start,
    };
  }
  if (start.page === end.page + 1) {
    return {
      kind: 'consecutive',
      reason: `${formatMarker({ page: start.page, total })} follows page ${end.page}`,
      end,
      start,
    };
  }
  if (total !== null) {
    return { kind: 'sameSet', reason: `pages ${end.page} and ${start.page} of ${total}`, end, start };
  }
  return { kind: 'none', reason: null, end, start };
}

// The words a reference number is labelled with, English and German, as the documents that are
// filed are both. Each is read with an optional "no." / "Nr." / "number" / "nummer" after it.
const IDENTIFIER_LABELS: ReadonlyArray<{ label: string; stems: string }> = [
  { label: 'invoice no.', stems: 'invoice|inv|rechnungs?|rg' },
  { label: 'customer no.', stems: 'customer|client|kunden|kd' },
  { label: 'account no.', stems: 'account|acct|konto' },
  { label: 'order no.', stems: 'order|bestell|auftrags?' },
  { label: 'contract no.', stems: 'contract|vertrags?' },
  { label: 'policy no.', stems: 'policy|police|versicherungsschein' },
  { label: 'reference', stems: 'reference|referenz|ref|aktenzeichen|case' },
];
// Up to four letters in front (`RE-2026-10432`), then digits, with single separators between them.
// Spaces are not read as separators: `10432 03.11.2026` would join a number to a date.
const IDENTIFIER_VALUE = String.raw`(?:\p{L}{1,4}[\-/]?)?\d(?:\d|[\-/.](?=\d))*`;
const LABEL_SUFFIX = String.raw`(?:\.?-?\s*(?:no|nr|number|nummer|num|id)(?!\p{L})\.?)?\s*[:#]?\s*`;
const LABELLED_IDENTIFIERS = IDENTIFIER_LABELS.map(({ label, stems }) => ({
  label,
  pattern: new RegExp(String.raw`(?<!\p{L})(?:${stems})${LABEL_SUFFIX}(${IDENTIFIER_VALUE})(?![\p{L}\d])`, 'giu'),
}));
const IDENTIFIER_TOKEN = new RegExp(String.raw`(?<![\p{L}\d])${IDENTIFIER_VALUE}(?![\p{L}\d])`, 'gu');
const DIGIT = /\d/g;
const IDENTIFIER_SEPARATORS = /[-/.]/g;
/** `YYYY-MM-DD`'s length, the part of an ISO timestamp that is the day. */
const CALENDAR_DAY_LENGTH = 10;

function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(IDENTIFIER_SEPARATORS, '');
}

function wholeText(candidate: MergeCandidate): string {
  return `${candidate.textHead}\n${candidate.textTail}`;
}

/** The filing day stands in for today: a date read from a scan is not later than the scan. */
function filingDay(candidate: MergeCandidate): string {
  return candidate.createdAt.toISOString().slice(0, CALENDAR_DAY_LENGTH);
}

// The order only changes which day an all-numeric date is, not whether there is one.
const containsDate = (text: string, today: string) => findDates(text, 'DMY', today).length > 0;

function labelledIdentifiers(candidate: MergeCandidate, minDigits: number): SharedIdentifier[] {
  const text = wholeText(candidate);
  const today = filingDay(candidate);
  return LABELLED_IDENTIFIERS.flatMap(({ label, pattern }) =>
    [...text.matchAll(pattern)]
      .map((match) => ({ label, value: match[1] ?? '' }))
      .filter(({ value }) => (value.match(DIGIT)?.length ?? 0) >= minDigits && containsDate(value, today) === false),
  );
}

function identifierTokens(candidate: MergeCandidate): Set<string> {
  return new Set([...wholeText(candidate).matchAll(IDENTIFIER_TOKEN)].map((match) => normalizeIdentifier(match[0])));
}

/**
 * Labelled numbers, such as an invoice or customer number, printed on both: labelled on one, and
 * the same number anywhere on the other, since a later page often repeats it in a bare header.
 * Dates and numbers shorter than `minIdentifierDigits` digits are not identifiers.
 *
 * @param a - The first document.
 * @param b - The second.
 * @param settings - `minIdentifierDigits`.
 * @returns The shared identifiers, each once.
 */
export function identifierSignal(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings,
): IdentifierSignal {
  const inA = identifierTokens(a);
  const inB = identifierTokens(b);
  const candidates = [
    ...labelledIdentifiers(a, settings.minIdentifierDigits).filter(({ value }) => inB.has(normalizeIdentifier(value))),
    ...labelledIdentifiers(b, settings.minIdentifierDigits).filter(({ value }) => inA.has(normalizeIdentifier(value))),
  ];
  const identifiers = [...new Map(candidates.map((found) => [normalizeIdentifier(found.value), found])).values()];
  if (identifiers.length === 0) {
    return { kind: 'none', reason: null, identifiers };
  }
  const named = identifiers.map(({ label, value }) => `${label} ${value}`).join(' and ');
  return { kind: 'shared', reason: `same ${named}`, identifiers };
}

function compareField(first: string | null, second: string | null, same: (x: string, y: string) => boolean): FieldKind {
  if (first === null) {
    return 'none';
  }
  if (second === null) {
    return 'onlyFirst';
  }
  return same(first, second) ? 'agree' : 'conflict';
}

/**
 * Whether the two documents' dates agree. Only the first being dated is what a later page looks
 * like; two different dates are two documents.
 *
 * @param a - The first document.
 * @param b - The second.
 * @returns How the dates compare, with a reason unless neither or only B is dated.
 */
export function documentDateSignal(a: MergeCandidate, b: MergeCandidate): Signal<FieldKind> {
  const kind = compareField(a.documentDate, b.documentDate, (x, y) => x === y);
  const reasons: Record<FieldKind, string | null> = {
    agree: `both dated ${a.documentDate}`,
    onlyFirst: `only ${a.originalFilename} is dated`,
    conflict: `dated ${a.documentDate} and ${b.documentDate}`,
    none: null,
  };
  return { kind, reason: reasons[kind] };
}

const NOT_ALPHANUMERIC = /[^\p{L}\d]+/gu;

// "ACME" and "ACME Supplies GmbH" are one vendor: OCR and the extractor do not always read the
// same line of a letterhead.
function sameVendor(x: string, y: string): boolean {
  const first = x.toLowerCase().replace(NOT_ALPHANUMERIC, '');
  const second = y.toLowerCase().replace(NOT_ALPHANUMERIC, '');
  return first.includes(second) || second.includes(first);
}

/**
 * Whether the two documents' vendors agree. A vendor is only read beside a total, so two
 * different ones are the strongest sign there are two receipts.
 *
 * @param a - The first document.
 * @param b - The second.
 * @returns How the vendors compare, with a reason unless neither or only B names one.
 */
export function vendorSignal(a: MergeCandidate, b: MergeCandidate): Signal<FieldKind> {
  const kind = compareField(a.vendor, b.vendor, sameVendor);
  const reasons: Record<FieldKind, string | null> = {
    agree: `both from ${a.vendor}`,
    onlyFirst: `only ${a.originalFilename} names a vendor`,
    conflict: `from ${a.vendor} and from ${b.vendor}`,
    none: null,
  };
  return { kind, reason: reasons[kind] };
}

/** What a page opening like a new document opens with. */
type FreshStartCue = 'letterhead' | 'date' | 'greeting';

const LINE_BREAK = /\r?\n/;
// A letter or a comma last: the sentence has not ended. A capitalised word counts, since German
// capitalises every noun.
const MID_SENTENCE_END = /[\p{L},\-–]$/u;
// The first letter or digit is a lower-case letter, past any opening quote or bullet.
const LOWERCASE_START = /^[^\p{L}\d]*\p{Ll}/u;
const LEGAL_FORM =
  /(?<!\p{L})(?:GmbH|mbH|AG|KG|OHG|UG|e\.\s?V\.|Ltd\.?|Inc\.?|LLC|plc|Corp\.?|S\.A\.|B\.V\.)(?!\p{L})/u;
const GREETING = /^(?:dear|sehr geehrte|liebe|lieber|hallo|hello|to whom)/iu;
const CUE_WORDS: Record<FreshStartCue, string> = { letterhead: 'a letterhead', date: 'a date', greeting: 'a greeting' };

// A line carrying a page marker is a running header or footer, not where the text starts or stops.
function contentLines(text: string, settings: MergeSuggestionSettings): string[] {
  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && findMarkers(line, settings.maxPageTotal).length === 0);
}

function freshStartCue(candidate: MergeCandidate, settings: MergeSuggestionSettings): FreshStartCue | null {
  const today = filingDay(candidate);
  for (const line of contentLines(candidate.textHead, settings).slice(0, settings.letterheadLines)) {
    if (LEGAL_FORM.test(line)) {
      return 'letterhead';
    }
    if (GREETING.test(line)) {
      return 'greeting';
    }
    if (containsDate(line, today)) {
      return 'date';
    }
  }
  return null;
}

/**
 * Whether A's text stops mid-sentence and B's picks it up in lower case, or B instead opens like
 * a new document: with a letterhead, a date or a greeting in its first lines.
 *
 * @param a - The first document.
 * @param b - The second.
 * @param settings - `letterheadLines`.
 * @returns `runsOn`, `freshStart` or `none`.
 */
export function textFlowSignal(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings,
): Signal<TextFlowKind> {
  const lastLine = contentLines(a.textTail, settings).at(-1) ?? '';
  const firstLine = contentLines(b.textHead, settings)[0] ?? '';
  const runsOn = MID_SENTENCE_END.test(lastLine) && LOWERCASE_START.test(firstLine);
  if (runsOn) {
    return { kind: 'runsOn', reason: 'the text runs on mid-sentence' };
  }
  const cue = freshStartCue(b, settings);
  if (cue) {
    return { kind: 'freshStart', reason: `${b.originalFilename} opens with ${CUE_WORDS[cue]}` };
  }
  return { kind: 'none', reason: null };
}

/**
 * The cosine of two vectors.
 *
 * @returns Null when they differ in length or either is all zeros.
 */
export function cosine(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) {
    return null;
  }
  let dot = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    dot += xi * yi;
    xx += xi * xi;
    yy += yi * yi;
  }
  const isZero = xx === 0 || yy === 0;
  return isZero ? null : dot / Math.sqrt(xx * yy);
}

/**
 * How alike the two documents' content is. Weak on purpose: pages of one document and two
 * documents on one subject look alike, so only a very low value counts against.
 *
 * @param a - The first document.
 * @param b - The second.
 * @param settings - `similarCosine` and `dissimilarCosine`.
 * @returns The cosine and what it says.
 */
export function embeddingSignal(
  a: MergeCandidate,
  b: MergeCandidate,
  settings: MergeSuggestionSettings,
): EmbeddingSignal {
  const value = a.meanEmbedding && b.meanEmbedding ? cosine(a.meanEmbedding, b.meanEmbedding) : null;
  if (value === null) {
    return { kind: 'none', reason: null, cosine: value };
  }
  if (value >= settings.similarCosine) {
    return { kind: 'similar', reason: 'similar content', cosine: value };
  }
  if (value < settings.dissimilarCosine) {
    return { kind: 'dissimilar', reason: 'unrelated content', cosine: value };
  }
  return { kind: 'none', reason: null, cosine: value };
}
