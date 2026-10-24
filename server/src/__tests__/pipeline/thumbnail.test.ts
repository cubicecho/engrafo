import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DB } from '@cubicecho/engrafo-db';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coverPath, readEpubCover } from '../../pipeline/epub.ts';
import { thumbnailStep } from '../../pipeline/steps/thumbnail.ts';
import {
  detectThumbnailTools,
  pdfThumbnailArgs,
  renderPdfThumbnail,
  resizeImageThumbnail,
  thumbnailSource,
} from '../../pipeline/thumbnail.ts';
import type { RunConfig } from '../../pipeline/types.ts';
import { bornDigitalPdf, createFakeEmbedder, createFakeStorage, epubFile, type FakeStorage } from '../helpers.ts';

const exec = promisify(execFile);

const ALL_TOOLS = { pdf: true, image: true };
const NO_TOOLS = { pdf: false, image: false };

const CONFIG: RunConfig = {
  ocrAvailable: false,
  pdfTextAvailable: false,
  thumbnailTools: ALL_TOOLS,
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: null,
};

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Scan',
    originalFilename: 'scan.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    checksumSha256: null,
    deletedAt: null,
    originalKey: 'originals/u/scan',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    thumbnailKey: null,
    documentDate: null,
    documentDateSource: null,
    vendor: null,
    total: null,
    currency: null,
    receiptSource: null,
    ocrRequested: false,
    visionRequested: false,
    status: 'processing',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

// Either tool can be missing on a dev host; the image ships both. The tests that draw skip without them.
const tools = await detectThumbnailTools();

/** Width and height of an image, by Pillow. */
async function sizeOf(path: string): Promise<[number, number]> {
  const { stdout } = await exec('python3', [
    '-c',
    'import sys\nfrom PIL import Image\nwith Image.open(sys.argv[1]) as i: print(i.format, i.width, i.height)',
    path,
  ]);
  const [format, width, height] = stdout.trim().split(' ');
  expect(format).toBe('JPEG');
  return [Number(width), Number(height)];
}

describe('thumbnailSource', () => {
  it('draws a PDF from its archive when OCR made one, else from the original', () => {
    expect(thumbnailSource(doc(), ALL_TOOLS)).toEqual({ render: 'pdf', key: 'originals/u/scan' });
    expect(thumbnailSource(doc({ archiveKey: 'archive/u/scan.pdf' }), ALL_TOOLS)).toEqual({
      render: 'pdf',
      key: 'archive/u/scan.pdf',
    });
  });

  it('draws an image from the original, not the PDF its archive wraps around it', () => {
    expect(thumbnailSource(doc({ mimeType: 'image/png', archiveKey: 'archive/u/scan.pdf' }), ALL_TOOLS)).toEqual({
      render: 'image',
      key: 'originals/u/scan',
    });
    expect(thumbnailSource(doc({ mimeType: 'application/epub+zip' }), ALL_TOOLS)?.render).toBe('epub');
  });

  it('gives text none, and nothing a missing tool would draw', () => {
    for (const mimeType of ['text/plain', 'text/markdown', 'text/csv', 'text/html']) {
      expect(thumbnailSource(doc({ mimeType }), ALL_TOOLS)).toBeNull();
    }
    expect(thumbnailSource(doc(), { pdf: false, image: true })).toBeNull();
    expect(thumbnailSource(doc({ mimeType: 'image/jpeg' }), { pdf: true, image: false })).toBeNull();
  });

  it('asks pdftoppm for the first page only, at the thumbnail width', () => {
    const args = pdfThumbnailArgs('in.pdf', 'out');
    expect(args.slice(0, 4)).toEqual(['-f', '1', '-l', '1']);
    expect(args).toContain('-singlefile');
    expect(args.at(-1)).toBe('out');
    expect(args[args.indexOf('-scale-to-x') + 1]).toBe('320');
  });
});

describe('coverPath', () => {
  it('reads the EPUB 3 cover-image property, then the EPUB 2 meta', () => {
    const epub3 = `<package><manifest>
      <item id="c" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    </manifest></package>`;
    expect(coverPath(epub3, 'OEBPS')).toBe('OEBPS/images/cover.jpg');
    const epub2 = `<package><metadata><meta name="cover" content="pic"/></metadata><manifest>
      <item id="pic" href="../cover.png" media-type="image/png"/>
    </manifest></package>`;
    expect(coverPath(epub2, 'OEBPS')).toBe('cover.png');
  });

  it('is null for a book that names no image as its cover', () => {
    expect(
      coverPath(
        '<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest></package>',
        '',
      ),
    ).toBeNull();
    const notAnImage = `<package><metadata><meta name="cover" content="a"/></metadata><manifest>
      <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest></package>`;
    expect(coverPath(notAnImage, '')).toBeNull();
  });
});

// Each of these starts Python at least once, which on a loaded host takes seconds.
describe('thumbnail step', { timeout: 60_000 }, () => {
  let dir: string;
  let storage: FakeStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engrafo-thumbnail-test-'));
    storage = createFakeStorage();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // The step reads no rows, and a Postgres per test is the heaviest thing a test here can build.
  const noDatabase = {} as DB;

  function run(document: Document, config: RunConfig = CONFIG) {
    return thumbnailStep.run({
      doc: document,
      db: noDatabase,
      storage,
      config,
      embedder: createFakeEmbedder(),
      tmpDir: dir,
    });
  }

  it('is skipped for text, and where the tool is missing', () => {
    expect(thumbnailStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
    expect(thumbnailStep.enabled(doc(), { ...CONFIG, thumbnailTools: NO_TOOLS })).toBe(false);
    expect(thumbnailStep.enabled(doc(), CONFIG)).toBe(true);
  });

  it('succeeds with no thumbnail when the render fails, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.files.objects.set('originals/u/scan', { body: Buffer.from('not an image'), contentType: 'image/png' });
    const patch = await run(doc({ mimeType: 'image/png' }));
    expect(patch).toEqual({ thumbnailKey: null });
    expect(storage.files.objects.size).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[thumbnail\] /));
  });

  it('succeeds with no thumbnail for a book with no cover', async () => {
    const opf =
      '<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest></package>';
    storage.files.objects.set('originals/u/scan', {
      body: epubFile({ 'OEBPS/content.opf': opf }),
      contentType: 'application/epub+zip',
    });
    expect(await run(doc({ mimeType: 'application/epub+zip' }))).toEqual({ thumbnailKey: null });
  });

  it.skipIf(tools.image === false)('resizes an image to the width, as a JPEG beside the archive', async () => {
    const source = join(dir, 'wide.png');
    await exec('python3', [
      '-c',
      'import sys\nfrom PIL import Image\nImage.new("RGBA", (1000, 500), (0, 0, 0, 0)).save(sys.argv[1])',
      source,
    ]);
    storage.files.objects.set('originals/u/scan', { body: await readFile(source), contentType: 'image/png' });
    const document = doc({ mimeType: 'image/png' });
    const patch = await run(document);
    const key = `thumbnails/${document.userId}/${document.id}.jpg`;
    expect(patch).toEqual({ thumbnailKey: key });
    const stored = storage.files.objects.get(key);
    expect(stored?.contentType).toBe('image/jpeg');
    const out = join(dir, 'stored.jpg');
    await writeFile(out, stored?.body ?? Buffer.alloc(0));
    expect(await sizeOf(out)).toEqual([320, 160]);
  });

  it.skipIf(tools.image === false)('cuts a long image at the tallest a thumbnail may be', async () => {
    const source = join(dir, 'roll.png');
    const output = join(dir, 'roll.jpg');
    await exec('python3', [
      '-c',
      'import sys\nfrom PIL import Image\nImage.new("L", (100, 2000), 255).save(sys.argv[1])',
      source,
    ]);
    await resizeImageThumbnail(source, output);
    expect(await sizeOf(output)).toEqual([100, 640]);
  });

  it.skipIf(tools.image === false)('draws an ebook from the cover its package names', async () => {
    const coverFile = join(dir, 'cover.png');
    await exec('python3', [
      '-c',
      'import sys\nfrom PIL import Image\nImage.new("RGB", (640, 960), "red").save(sys.argv[1])',
      coverFile,
    ]);
    const opf = `<package><manifest>
      <item id="c" href="cover.png" media-type="image/png" properties="cover-image"/>
    </manifest></package>`;
    const book = join(dir, 'book.epub');
    // The fixture writes text entries; the cover goes in as the latin1 string of its bytes, which
    // strToU8 would mangle, so the zip is written by hand here instead.
    const { zipSync, strToU8 } = await import('fflate');
    await writeFile(
      book,
      zipSync({
        mimetype: [strToU8('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': strToU8(
          '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        ),
        'OEBPS/content.opf': strToU8(opf),
        'OEBPS/cover.png': await readFile(coverFile),
      }),
    );
    expect(Buffer.from((await readEpubCover(book)) ?? [])).toEqual(await readFile(coverFile));
    expect(await readEpubCover(book, { maxCoverBytes: 1 })).toBeNull();

    storage.files.objects.set('originals/u/scan', { body: await readFile(book), contentType: 'application/epub+zip' });
    const patch = await run(doc({ mimeType: 'application/epub+zip' }));
    expect(patch?.thumbnailKey).toMatch(/^thumbnails\//);
  });

  it.skipIf(tools.pdf === false || tools.image === false)("draws a PDF's first page at the width", async () => {
    const pdf = join(dir, 'page.pdf');
    await writeFile(pdf, bornDigitalPdf('Hello'));
    const drawn = await renderPdfThumbnail(pdf, join(dir, 'page'));
    const [width] = await sizeOf(drawn);
    expect(width).toBe(320);
  });
});
