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
}

/** The fewest documents a merge takes. The server says the same. */
export const MERGE_MIN_DOCUMENTS = 2;

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
