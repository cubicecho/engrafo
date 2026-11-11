// Documents picked on the documents page to merge into one PDF. The selection is a list rather
// than a set because its order is the merged file's page order: first checked, first in, until the
// merge dialog moves one.

/** A document picked to merge, with what the dialog draws and defaults from. */
export interface MergeCandidate {
  id: string;
  title: string;
  mimeType: string;
  /** Where it is filed; the first one's folder is where the merged copy goes unless changed. */
  folderId: string | null;
  sizeBytes: number;
  /** The searchable PDF, when OCR made one: what the merge takes, so what the dialog previews. */
  archiveKey: string | null;
}

/** The fewest documents a merge takes. The server says the same. */
export const MERGE_MIN_DOCUMENTS = 2;

/**
 * A merged document's type, in the words the dialog's rows use.
 *
 * @param mimeType - A PDF or an image's type.
 * @returns `PDF`, or the image's format and the word: `JPEG image`, `TIFF image`.
 */
export function mergeTypeLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') {
    return 'PDF';
  }
  const format = mimeType.split('/')[1] ?? '';
  return format === '' ? 'Image' : `${format.toUpperCase()} image`;
}

/**
 * Whether a document has pages to merge.
 *
 * @param mimeType - The document's type.
 * @returns true for a PDF or an image; text, Markdown, CSV, HTML and EPUB have no pages.
 */
export function isMergeable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}

/**
 * The selection with a document added at the end, or taken out when it was already in.
 *
 * @param selected - The selection as it stands.
 * @param candidate - The document checked or unchecked.
 */
export function toggleCandidate(selected: readonly MergeCandidate[], candidate: MergeCandidate): MergeCandidate[] {
  return selected.some((doc) => doc.id === candidate.id)
    ? selected.filter((doc) => doc.id !== candidate.id)
    : [...selected, candidate];
}

/**
 * The selection with one document moved a place towards the start (`-1`) or the end (`1`).
 *
 * @param selected - The selection as it stands.
 * @param index - Which one moves.
 * @param by - The direction. Past either end, nothing moves.
 */
export function moveCandidate(selected: readonly MergeCandidate[], index: number, by: -1 | 1): MergeCandidate[] {
  const target = index + by;
  const moving = selected[index];
  const other = selected[target];
  if (moving === undefined || other === undefined) {
    return [...selected];
  }
  const next = [...selected];
  next[index] = other;
  next[target] = moving;
  return next;
}

/**
 * The selection with several documents picked or unpicked at once: "Select all" over a list.
 *
 * @param selected - The selection as it stands.
 * @param candidates - The documents shown, in the list's order.
 * @param picked - true adds those not already in, at the end and in the list's order, so what was
 *   picked before keeps its place; false takes all of them out.
 */
export function setCandidates(
  selected: readonly MergeCandidate[],
  candidates: readonly MergeCandidate[],
  picked: boolean,
): MergeCandidate[] {
  if (picked === false) {
    const out = new Set(candidates.map((doc) => doc.id));
    return selected.filter((doc) => out.has(doc.id) === false);
  }
  const already = new Set(selected.map((doc) => doc.id));
  return [...selected, ...candidates.filter((doc) => already.has(doc.id) === false)];
}
