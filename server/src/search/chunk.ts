// A document's text in passages small enough to embed. OCR and pdftotext give
// no headings to split on, as Markdown gives mcp-ragdown, so paragraphs are the
// unit: they are packed together up to the limit, and one longer than the limit
// is cut at sentence ends, or at a space when a sentence alone is too long.
//
// Markdown has headings, as an ebook does in its table of contents (stored
// as `# Chapter 3` lines). For both, `chunkSections` cuts each section on its
// own, so no passage straddles two sections, and each passage knows the
// headings it sits under: `Backups › Restore`, mcp-ragdown's breadcrumb. An
// uploaded web page's h1-h6 are stored the same way.
//
// A CSV is rows, not paragraphs: `chunkRows` packs whole rows, with the header
// row in front of each passage's embedding.

/** A blank line, with whatever spaces OCR left on it. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;
/** Where a sentence ends: punctuation, then space. The punctuation stays with its sentence. */
const SENTENCE_END = /(?<=[.!?])\s+/;
const WHITESPACE_RUN = /\s+/g;
/** An ATX heading: one to six `#`, a space, the text, and any closing `#`s. Up to three spaces may lead. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
/** A fence opening or closing a code block. A `#` line inside one is a comment, not a heading. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** YAML front matter: a `---` block at the very top. It is metadata, not text to find. */
const FRONT_MATTER = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
/** What a breadcrumb puts between a heading and the one under it. */
const BREADCRUMB_SEPARATOR = ' › ';

/** A passage, and the headings it sits under when the text has them. */
export interface Passage {
  /** The breadcrumb of headings, outermost first, or null before the first heading. For a CSV, its header row. */
  heading: string | null;
  content: string;
}

/**
 * A chapter's or a web page heading's name as a line of stored text.
 *
 * @param heading - The name, on one line.
 * @param level - Its depth, 1 to 6: a top-level heading by default.
 * @returns A Markdown heading, which `chunkSections` starts a section at.
 */
export function headingLine(heading: string, level = 1): string {
  return `${'#'.repeat(level)} ${heading}`;
}

/**
 * Cuts text written with Markdown headings into passages, each section on its own.
 *
 * @param text - Markdown, or an ebook's text as `bookText` writes it.
 * @param maxChars - The longest passage, in characters.
 * @returns The passages in reading order, each with the breadcrumb of headings above it: null
 *   before the first. Front matter is left out, and a `#` inside a code block is not a heading.
 */
export function chunkSections(text: string, maxChars: number): Passage[] {
  const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
  // One heading per level; a heading clears the ones below it.
  const trail: string[] = [];
  let fence: string | null = null;

  for (const line of text.replace(/\r\n?/g, '\n').replace(FRONT_MATTER, '').split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      // A fence closes on the same character, at least as long as the one that opened it.
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
    }

    const heading = fence === null ? HEADING.exec(line) : null;
    const level = heading?.[1]?.length ?? 0;
    const name = heading?.[2]?.trim() ?? '';
    if (heading === null || name === '') {
      sections[sections.length - 1]?.lines.push(line);
      continue;
    }
    trail.length = level - 1;
    trail[level - 1] = name;
    sections.push({ heading: trail.filter((part) => part !== undefined).join(BREADCRUMB_SEPARATOR), lines: [] });
  }

  return sections.flatMap(({ heading, lines }) =>
    chunkText(lines.join('\n'), maxChars).map((content) => ({ heading, content })),
  );
}

/**
 * Cuts text into passages.
 *
 * @param text - Extracted text, as stored in the text bucket.
 * @param maxChars - The longest passage, in characters.
 * @returns The passages in reading order, each trimmed, none empty and none longer than `maxChars`.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(PARAGRAPH_BREAK)
    // A line break inside a paragraph is the page's width, not the writer's.
    .map((paragraph) => paragraph.replace(WHITESPACE_RUN, ' ').trim())
    .filter((paragraph) => paragraph !== '');

  const pieces = paragraphs.flatMap((paragraph) =>
    paragraph.length > maxChars ? split(paragraph, maxChars) : [paragraph],
  );

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const joined = current === '' ? piece : `${current}\n\n${piece}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    chunks.push(current);
    current = piece;
  }
  if (current !== '') {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Cuts a CSV into passages of whole rows.
 *
 * @param text - The file, as stored.
 * @param maxChars - The longest passage, in characters.
 * @returns The rows after the first, packed up to the limit in order, each passage with the
 *   first row as its heading: that is the column names, so "-23.40" is embedded as an amount.
 *   A file of one row is that row, with no heading. A row longer than the limit alone is cut
 *   at spaces, as a long sentence is.
 *
 * @remarks
 * `chunkText` would read a CSV as one paragraph, since it has no blank lines: its line breaks
 * become spaces, and passages end wherever a cell happens to end in a full stop, mid-row.
 * The header is assumed rather than detected; a file without one gets its first row repeated
 * in front of each passage, which costs a line of context and loses nothing.
 */
export function chunkRows(text: string, maxChars: number): Passage[] {
  const [header, ...rows] = csvRecords(text)
    .map((record) => record.trim())
    .filter((record) => record !== '');
  if (header === undefined) {
    return [];
  }
  if (rows.length === 0) {
    return hardWrap(header, maxChars).map((content) => ({ heading: null, content }));
  }

  const chunks: string[] = [];
  let current = '';
  for (const row of rows.flatMap((record) => hardWrap(record, maxChars))) {
    const joined = current === '' ? row : `${current}\n${row}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    chunks.push(current);
    current = row;
  }
  if (current !== '') {
    chunks.push(current);
  }
  return chunks.map((content) => ({ heading: header, content }));
}

/** What a quoted cell can follow: the start of a row, or a separator. Banks use all three. */
const CELL_START = new Set([undefined, '\n', ',', ';', '\t']);

/** A CSV's records. A line break inside a quoted cell is part of the cell, not the end of the row. */
function csvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  const source = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted && char === '"') {
      // Two quotes in a row are one quote in the cell, and the cell goes on.
      if (source[i + 1] === '"') {
        i++;
      } else {
        quoted = false;
      }
    } else if (char === '"' && CELL_START.has(source[i - 1])) {
      // Only a quote opening a cell quotes it: a stray one, as in `24" monitor`, would otherwise
      // run the rest of the file into one row.
      quoted = true;
    } else if (char === '\n' && quoted === false) {
      records.push(source.slice(start, i));
      start = i + 1;
    }
  }
  records.push(source.slice(start));
  return records;
}

/** A paragraph longer than the limit, as sentences packed up to it. */
function split(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(SENTENCE_END).flatMap((sentence) => hardWrap(sentence, maxChars));
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const joined = current === '' ? sentence : `${current} ${sentence}`;
    if (joined.length <= maxChars) {
      current = joined;
      continue;
    }
    out.push(current);
    current = sentence;
  }
  if (current !== '') {
    out.push(current);
  }
  return out;
}

/** A sentence longer than the limit, cut at the last space before it, or mid-word when there is none. */
function hardWrap(sentence: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(' ', maxChars);
    const cut = space > 0 ? space : maxChars;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== '') {
    out.push(rest);
  }
  return out;
}

/**
 * What is embedded for a passage: the document's title in front of it, as mcp-ragdown puts a
 * section's heading in front. A passage that only says "due on the 1st" is then found by a
 * question about the lease it belongs to. Indexing the body alone cost ragdown 22 points of
 * top-1 recall.
 *
 * @param title - The document's title.
 * @param passage - One passage from `chunkText`, `chunkSections` or `chunkRows`.
 * @param heading - Its breadcrumb, or a CSV's header row, which goes in front of it under the title.
 */
export function embeddingText(title: string, passage: string, heading: string | null = null): string {
  return heading === null ? `${title}\n\n${passage}` : `${title}\n${heading}\n\n${passage}`;
}
