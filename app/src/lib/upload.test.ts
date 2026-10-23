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

  it("calls a .csv a CSV when Windows says it is Excel's, and leaves a real .xls alone", () => {
    expect(uploadMimeType({ name: 'statement.CSV', type: 'application/vnd.ms-excel' })).toBe('text/csv');
    expect(uploadMimeType({ name: 'statement.xls', type: 'application/vnd.ms-excel' })).toBe(
      'application/vnd.ms-excel',
    );
    expect(uploadMimeType({ name: 'statement.csv', type: 'text/x-csv' })).toBe('text/csv');
    expect(uploadMimeType({ name: 'statement.csv', type: '' })).toBe('text/csv');
  });

  it('knows HTML, WebP and GIF by their extensions', () => {
    expect(uploadMimeType({ name: 'order.htm', type: '' })).toBe('text/html');
    expect(uploadMimeType({ name: 'order.xhtml', type: 'application/xhtml+xml' })).toBe('text/html');
    expect(uploadMimeType({ name: 'receipt.webp', type: '' })).toBe('image/webp');
    expect(uploadMimeType({ name: 'receipt.gif', type: '' })).toBe('image/gif');
  });

  it('leaves anything else to the allowlist to refuse', () => {
    expect(uploadMimeType({ name: 'notes.xyz', type: '' })).toBe('application/octet-stream');
    expect(uploadMimeType({ name: 'README', type: '' })).toBe('application/octet-stream');
  });
});
