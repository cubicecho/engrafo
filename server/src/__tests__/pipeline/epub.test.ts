import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BookSection, bookText, DrmProtectedError, readEpub } from '../../pipeline/epub.ts';
import { chunkSections } from '../../search/chunk.ts';
import { epubFile } from '../helpers.ts';

/** A package document listing these chapters, in this order, with an optional nav or NCX. */
function opf(chapters: string[], { nav = false, ncx = false, prefix = '' } = {}): string {
  const p = prefix === '' ? '' : `${prefix}:`;
  const ns = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
  const items = chapters.map((href, i) => `<${p}item id="c${i}" href="${href}" media-type="application/xhtml+xml"/>`);
  if (nav) {
    items.push(`<${p}item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  }
  if (ncx) {
    items.push(`<${p}item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<${p}package ${ns}="http://www.idpf.org/2007/opf" version="3.0">
  <${p}metadata/>
  <${p}manifest>${items.join('')}</${p}manifest>
  <${p}spine${ncx ? ' toc="ncx"' : ''}>${chapters.map((_, i) => `<${p}itemref idref="c${i}"/>`).join('')}</${p}spine>
</${p}package>`;
}

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Not the text</title><style>p { color: red }</style></head>
<body>${body}</body></html>`;
}

function nav(links: Array<[string, string]>): string {
  const items = links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('');
  return xhtml(`<nav epub:type="landmarks"><ol><li><a href="cover.xhtml">Cover</a></li></ol></nav>
<nav epub:type="toc"><h1>Contents</h1><ol>${items}</ol></nav>`);
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engrafo-epub-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function read(files: Record<string, string>, options?: { maxUnpackedBytes?: number }): Promise<BookSection[]> {
  const path = join(dir, 'book.epub');
  await writeFile(path, epubFile(files));
  return readEpub(path, options);
}

describe('readEpub', () => {
  it('reads the spine in order, named by the nav document', async () => {
    const sections = await read({
      'OEBPS/content.opf': opf(['one.xhtml', 'two.xhtml'], { nav: true }),
      'OEBPS/nav.xhtml': nav([
        ['one.xhtml', 'Chapter One'],
        ['two.xhtml', 'Chapter Two'],
      ]),
      'OEBPS/one.xhtml': xhtml('<h1>Chapter One</h1><p>It was a dark night.</p><p>The end of one.</p>'),
      'OEBPS/two.xhtml': xhtml('<h1>Chapter Two</h1><p>Morning came.</p>'),
    });

    expect(sections).toEqual([
      { heading: 'Chapter One', text: 'Chapter One\n\nIt was a dark night.\n\nThe end of one.' },
      { heading: 'Chapter Two', text: 'Chapter Two\n\nMorning came.' },
    ]);
  });

  it('takes the markup off: blocks are paragraphs, inline runs on, and scripts and page numbers go', async () => {
    const [section] = await read({
      'OEBPS/content.opf': opf(['one.xhtml']),
      'OEBPS/one.xhtml': xhtml(`
        <div><p>Fish &amp; <em>chips</em>,
          said    the <a href="#x">cook</a>.</p></div>
        <p>Line one<br/>Line two</p>
        <script>alert('no')</script>
        <p>Before<span epub:type="pagebreak" title="12">12</span> after</p>
        <table><tr><td>Name</td><td>Age</td></tr></table>`),
    });

    expect(section?.text).toBe('Fish & chips, said the cook.\n\nLine one\nLine two\n\nBefore after\n\nName Age');
  });

  it('starts a chapter where the table of contents points inside a file', async () => {
    const sections = await read({
      'OEBPS/content.opf': opf(['cover.xhtml', 'book.xhtml', 'more.xhtml'], { nav: true }),
      'OEBPS/nav.xhtml': nav([
        ['book.xhtml#ch1', 'One'],
        ['book.xhtml#ch2', 'Two'],
      ]),
      'OEBPS/cover.xhtml': xhtml('<p>A Novel</p>'),
      'OEBPS/book.xhtml': xhtml('<h2 id="ch1">One</h2><p>First.</p><h2 id="ch2">Two</h2><p>Second.</p>'),
      // No entry of its own: the chapter before it runs on into it.
      'OEBPS/more.xhtml': xhtml('<p>Still two.</p>'),
    });

    expect(sections).toEqual([
      { heading: null, text: 'A Novel' },
      { heading: 'One', text: 'One\n\nFirst.' },
      { heading: 'Two', text: 'Two\n\nSecond.\n\nStill two.' },
    ]);
  });

  it('falls back to the NCX, with prefixed package elements and encoded hrefs', async () => {
    const sections = await read({
      'OEBPS/content.opf': opf(['text/chapter%201.xhtml'], { ncx: true, prefix: 'opf' }),
      'OEBPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="p1"><navLabel><text>The  Beginning</text></navLabel><content src="text/chapter%201.xhtml"/></navPoint>
</navMap></ncx>`,
      'OEBPS/text/chapter 1.xhtml': xhtml('<p>Once upon a time.</p>'),
    });

    expect(sections).toEqual([{ heading: 'The Beginning', text: 'Once upon a time.' }]);
  });

  it('gives a book with no table of contents one section with no heading', async () => {
    const sections = await read({
      'OEBPS/content.opf': opf(['a.xhtml', 'b.xhtml']),
      'OEBPS/a.xhtml': xhtml('<p>A.</p>'),
      'OEBPS/b.xhtml': xhtml('<p>B.</p>'),
    });

    expect(sections).toEqual([{ heading: null, text: 'A.\n\nB.' }]);
  });

  it('refuses a book whose chapters are encrypted, but not one whose fonts are obfuscated', async () => {
    const encryption = (uri: string) => `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>
</encryption>`;
    const book = {
      'OEBPS/content.opf': opf(['one.xhtml']),
      'OEBPS/one.xhtml': xhtml('<p>Words.</p>'),
    };

    await expect(read({ ...book, 'META-INF/encryption.xml': encryption('OEBPS/one.xhtml') })).rejects.toThrow(
      DrmProtectedError,
    );
    await expect(read({ ...book, 'META-INF/encryption.xml': encryption('OEBPS/fonts/serif.otf') })).resolves.toEqual([
      { heading: null, text: 'Words.' },
    ]);
  });

  it('refuses a zip that names no package, and one that unpacks past the limit', async () => {
    await expect(read({ 'META-INF/container.xml': '<container/>' })).rejects.toThrow('names no package');
    await expect(
      read({ 'OEBPS/content.opf': opf(['one.xhtml']), 'OEBPS/one.xhtml': xhtml('<p>x</p>') }, { maxUnpackedBytes: 10 }),
    ).rejects.toThrow('Not a readable EPUB');
  });

  it('refuses a file that is not a zip at all', async () => {
    const path = join(dir, 'fake.epub');
    await writeFile(path, 'just text');
    await expect(readEpub(path)).rejects.toThrow('Not a readable EPUB');
  });
});

describe('bookText', () => {
  it('writes headings that chunkSections reads back as chapters', () => {
    const text = bookText([
      { heading: null, text: 'Title page.' },
      { heading: 'One', text: 'First.\n\nMore of one.' },
      { heading: 'Two', text: 'Second.' },
    ]);

    expect(text).toBe('Title page.\n\n# One\n\nFirst.\n\nMore of one.\n\n# Two\n\nSecond.');
    expect(chunkSections(text, 1000)).toEqual([
      { heading: null, content: 'Title page.' },
      { heading: 'One', content: 'First.\n\nMore of one.' },
      { heading: 'Two', content: 'Second.' },
    ]);
  });
});
