// A document's text in passages small enough to embed. OCR and pdftotext give
// no headings to split on, as Markdown gives mcp-ragdown, so paragraphs are the
// unit: they are packed together up to the limit, and one longer than the limit
// is cut at sentence ends, or at a space when a sentence alone is too long.

/** A blank line, with whatever spaces OCR left on it. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;
/** Where a sentence ends: punctuation, then space. The punctuation stays with its sentence. */
const SENTENCE_END = /(?<=[.!?])\s+/;
const WHITESPACE_RUN = /\s+/g;

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
 * @param passage - One passage from `chunkText`.
 */
export function embeddingText(title: string, passage: string): string {
  return `${title}\n\n${passage}`;
}
