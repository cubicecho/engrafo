import { describe, expect, it } from 'vitest';
import { folderNameError } from './folder-tree';
import { createLimiter, planFolderUpload, uploadMimeType } from './upload';

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

describe('planFolderUpload', () => {
  const plan = (...paths: string[]) =>
    planFolderUpload(
      paths.map((path) => ({ path })),
      folderNameError,
    );

  it('files each file under the folders it sat in, the picked folder first', () => {
    expect(plan('Taxes/2026/scan.pdf', 'Taxes/summary.md').files).toEqual([
      { file: { path: 'Taxes/2026/scan.pdf' }, folderPath: ['Taxes', '2026'] },
      { file: { path: 'Taxes/summary.md' }, folderPath: ['Taxes'] },
    ]);
  });

  it('drops what the OS leaves behind without a word', () => {
    const { files, refused } = plan(
      'Scans/.DS_Store',
      'Scans/._a.pdf',
      'Scans/Thumbs.db',
      'Scans/~$report.docx',
      'Scans/@eaDir/a.pdf/SYNOPHOTO_THUMB.jpg',
      'Scans/.git/HEAD',
      'Scans/a.pdf',
    );
    expect(files.map(({ file }) => file.path)).toEqual(['Scans/a.pdf']);
    expect(refused).toEqual([]);
  });

  it('leaves out a folder whose name cannot be one, naming it once, outermost only', () => {
    const { files, refused } = plan('Scans/Old (2019)/a.pdf', 'Scans/Old (2019)/Deep/b.pdf', 'Scans/c.pdf');
    expect(files.map(({ file }) => file.path)).toEqual(['Scans/c.pdf']);
    expect(refused).toEqual([{ path: 'Scans/Old (2019)', reason: expect.stringContaining('letters') }]);
  });
});

describe('createLimiter', () => {
  it('never runs more than the limit at once, and runs everything in order', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      order.push(n);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(task(n))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
