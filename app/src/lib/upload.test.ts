import { describe, expect, it } from 'vitest';
import { uploadMimeType } from './upload';

describe('uploadMimeType', () => {
  it("keeps the browser's type when it gave one", () => {
    expect(uploadMimeType({ name: 'scan.pdf', type: 'application/pdf' })).toBe('application/pdf');
  });

  it('knows an EPUB by its extension when the browser does not', () => {
    expect(uploadMimeType({ name: 'Moby Dick.EPUB', type: '' })).toBe('application/epub+zip');
  });

  it('knows Markdown by its extension, and by the name some browsers give it', () => {
    expect(uploadMimeType({ name: 'notes.md', type: '' })).toBe('text/markdown');
    expect(uploadMimeType({ name: 'README.markdown', type: '' })).toBe('text/markdown');
    expect(uploadMimeType({ name: 'notes.md', type: 'text/x-markdown' })).toBe('text/markdown');
  });

  it('leaves anything else to the allowlist to refuse', () => {
    expect(uploadMimeType({ name: 'notes.xyz', type: '' })).toBe('application/octet-stream');
    expect(uploadMimeType({ name: 'README', type: '' })).toBe('application/octet-stream');
  });
});
