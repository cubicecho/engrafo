import { describe, expect, it } from 'vitest';
import {
  isMergeable,
  type MergeCandidate,
  mergeTypeLabel,
  moveCandidate,
  setCandidates,
  toggleCandidate,
} from './merge';

const doc = (id: string): MergeCandidate => ({
  id,
  title: id,
  mimeType: 'application/pdf',
  folderId: null,
  sizeBytes: 1,
  archiveKey: null,
});

describe('the merge selection', () => {
  it('adds at the end and takes out what was in', () => {
    const one = toggleCandidate([], doc('a'));
    const two = toggleCandidate(one, doc('b'));
    expect(two.map((d) => d.id)).toEqual(['a', 'b']);
    expect(toggleCandidate(two, doc('a')).map((d) => d.id)).toEqual(['b']);
  });

  it('moves one place either way, and not past an end', () => {
    const list = [doc('a'), doc('b'), doc('c')];
    expect(moveCandidate(list, 2, -1).map((d) => d.id)).toEqual(['a', 'c', 'b']);
    expect(moveCandidate(list, 0, 1).map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(moveCandidate(list, 0, -1).map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(moveCandidate(list, 2, 1).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('picks a list at once after what was picked before, and unpicks only that list', () => {
    const before = [doc('x'), doc('b')];
    const shown = [doc('a'), doc('b'), doc('c')];
    const all = setCandidates(before, shown, true);
    expect(all.map((d) => d.id)).toEqual(['x', 'b', 'a', 'c']);
    expect(setCandidates(all, shown, false).map((d) => d.id)).toEqual(['x']);
  });

  it('names a PDF, and an image by its format', () => {
    expect(mergeTypeLabel('application/pdf')).toBe('PDF');
    expect(mergeTypeLabel('image/tiff')).toBe('TIFF image');
  });

  it('takes PDFs and images, which have pages', () => {
    expect(isMergeable('application/pdf')).toBe(true);
    expect(isMergeable('image/tiff')).toBe(true);
    expect(isMergeable('text/markdown')).toBe(false);
    expect(isMergeable('application/epub+zip')).toBe(false);
  });
});
