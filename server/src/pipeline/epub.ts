import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { type AnyNode, type Element, isTag } from 'domhandler';
import { strFromU8, type UnzipFileInfo, unzipSync } from 'fflate';
import { DomUtils, parseDocument } from 'htmlparser2';
import { EBOOK_DEFAULTS } from '../core/defaults.ts';
import { createSectionBuilder, type SectionBuilder, sectionsText, type TextSection, walkHtml } from './html-text.ts';

// An EPUB is a zip: META-INF/container.xml names the package (OPF), the
// package's spine lists the chapters in reading order, and its table of
// contents (an EPUB 3 nav document, or an EPUB 2 NCX) names them. The text is
// the spine's XHTML with the markup taken off, cut into sections where the
// table of contents says a chapter starts, so search can say which chapter a
// passage is from.

/** One chapter of a book, as the table of contents names it. */
export type BookSection = TextSection;

/** The book's own lock: its chapters are encrypted, so there is no text to read. */
export class DrmProtectedError extends Error {
  constructor() {
    super('This book is DRM-protected, so its text cannot be read.');
    this.name = 'DrmProtectedError';
  }
}

/** The files read out of the zip. Images, fonts and styles are left packed. */
const TEXT_ENTRY = /\.(?:x?html?|xml|opf|ncx)$/i;
const CONTAINER_PATH = 'META-INF/container.xml';
const ENCRYPTION_PATH = 'META-INF/encryption.xml';
const HTML_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html']);
const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

const WHITESPACE_RUN = /\s+/g;

/**
 * Reads an EPUB's text, chapter by chapter.
 *
 * @param path - An EPUB on disk.
 * @param options - Limits, for tests.
 * @param options.maxUnpackedBytes - The most its text files may unpack to.
 * @returns The sections in reading order. A section with no text is left out.
 * @throws DrmProtectedError when the chapters are encrypted.
 */
export async function readEpub(
  path: string,
  { maxUnpackedBytes = EBOOK_DEFAULTS.maxUnpackedBytes }: { maxUnpackedBytes?: number } = {},
): Promise<BookSection[]> {
  const files = unpack(await readFile(path), maxUnpackedBytes);
  const read = (name: string): string | null => {
    const bytes = files[name];
    // A BOM is common in files written on Windows, and the XML parser would keep it as text.
    return bytes ? strFromU8(bytes).replace(/^﻿/, '') : null;
  };

  const container = read(CONTAINER_PATH);
  const packagePath = container ? packagePathFrom(container) : null;
  const packageXml = packagePath ? read(packagePath) : null;
  if (!packagePath || packageXml === null) {
    throw new Error('Not an EPUB: it names no package document.');
  }

  const book = readPackage(packageXml, posix.dirname(packagePath));
  const encrypted = encryptedPaths(read(ENCRYPTION_PATH));
  // Fonts are often "encrypted" too, by the spec's harmless obfuscation. Only a locked chapter is DRM.
  if (book.spine.some((chapter) => encrypted.has(chapter))) {
    throw new DrmProtectedError();
  }

  const contents = tableOfContents(book, read);
  const builder = createSectionBuilder();
  for (const chapter of book.spine) {
    const html = read(chapter);
    if (html === null) {
      continue;
    }
    walkChapter(html, contents.get(chapter) ?? [], builder);
  }
  return builder.finish();
}

/**
 * The book's text as it is stored: each chapter's name on a line of its own above it.
 *
 * @param sections - From `readEpub`.
 * @returns The text, which `chunkSections` reads the chapters back out of.
 */
export function bookText(sections: BookSection[]): string {
  return sectionsText(sections);
}

/** The zip's text files, refusing one whose declared sizes add up past the limit. */
function unpack(data: Uint8Array, maxUnpackedBytes: number): Record<string, Uint8Array> {
  let unpacked = 0;
  try {
    return unzipSync(data, {
      filter: (file: UnzipFileInfo) => {
        if (TEXT_ENTRY.test(file.name) === false) {
          return false;
        }
        unpacked += file.originalSize;
        if (unpacked > maxUnpackedBytes) {
          throw new Error(`Its text unpacks to more than ${maxUnpackedBytes} bytes.`);
        }
        return true;
      },
    });
  } catch (error) {
    throw new Error(`Not a readable EPUB: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What the package document says: the chapters in order, and where the table of contents is. */
interface BookPackage {
  /** Paths inside the zip of the spine's HTML documents, in reading order. */
  spine: string[];
  /** The EPUB 3 nav document's path, if there is one. */
  nav: string | null;
  /** The EPUB 2 NCX's path, if there is one. */
  ncx: string | null;
}

/** An element's name without its namespace prefix: some packages write `opf:item`. */
function localName(element: Element): string {
  const colon = element.name.indexOf(':');
  return colon === -1 ? element.name : element.name.slice(colon + 1);
}

function findAllNamed(nodes: AnyNode[], name: string): Element[] {
  return DomUtils.findAll((element) => localName(element) === name, nodes);
}

function childrenNamed(element: Element, name: string): Element[] {
  return element.children.filter((child): child is Element => isTag(child) && localName(child) === name);
}

function parseXml(xml: string): AnyNode[] {
  return parseDocument(xml, { xmlMode: true }).children;
}

/** An href, resolved against the file it is written in to a path inside the zip. Its fragment is dropped. */
function resolveHref(baseDir: string, href: string): { path: string; fragment: string | null } {
  const hash = href.indexOf('#');
  const file = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? null : decode(href.slice(hash + 1));
  return { path: posix.normalize(posix.join(baseDir, decode(file))).replace(/^\.\//, ''), fragment };
}

/** Percent-decoding that leaves a stray `%` alone rather than failing the book over it. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function packagePathFrom(containerXml: string): string | null {
  const rootfiles = findAllNamed(parseXml(containerXml), 'rootfile');
  const opf = rootfiles.find((rootfile) => rootfile.attribs['media-type'] === 'application/oebps-package+xml');
  return (opf ?? rootfiles[0])?.attribs['full-path'] ?? null;
}

function readPackage(xml: string, baseDir: string): BookPackage {
  const nodes = parseXml(xml);
  const items = new Map(
    findAllNamed(nodes, 'item').map((item) => [
      item.attribs.id,
      {
        path: resolveHref(baseDir, item.attribs.href ?? '').path,
        mediaType: item.attribs['media-type'] ?? '',
        properties: (item.attribs.properties ?? '').split(WHITESPACE_RUN),
      },
    ]),
  );
  const navItem = [...items.values()].find((item) => item.properties.includes('nav'));
  const spineElement = findAllNamed(nodes, 'spine')[0];
  const ncxItem =
    items.get(spineElement?.attribs.toc ?? '') ?? [...items.values()].find((item) => item.mediaType === NCX_MEDIA_TYPE);

  const spine = findAllNamed(nodes, 'itemref')
    .map((itemref) => items.get(itemref.attribs.idref ?? ''))
    // The nav document is sometimes in the spine as well; its text is the table of contents again.
    .filter((item) => item !== undefined && HTML_MEDIA_TYPES.has(item.mediaType) && item !== navItem)
    .map((item) => item?.path ?? '');
  return { spine, nav: navItem?.path ?? null, ncx: ncxItem?.path ?? null };
}

function encryptedPaths(xml: string | null): Set<string> {
  if (xml === null) {
    return new Set();
  }
  // Paths in encryption.xml are relative to the root of the zip, not to the package.
  return new Set(
    findAllNamed(parseXml(xml), 'CipherReference').map(
      (reference) => resolveHref('', reference.attribs.URI ?? '').path,
    ),
  );
}

/** Where a chapter starts inside a file: at its top, or at the element with this id. */
interface ContentsEntry {
  fragment: string | null;
  label: string;
}

/** The table of contents, as the entries pointing into each file, in order. The nav document wins over the NCX. */
function tableOfContents(book: BookPackage, read: (path: string) => string | null): Map<string, ContentsEntry[]> {
  const entries = new Map<string, ContentsEntry[]>();
  const add = (baseDir: string, href: string, label: string) => {
    const name = label.replace(WHITESPACE_RUN, ' ').trim();
    if (href === '' || name === '') {
      return;
    }
    const { path, fragment } = resolveHref(baseDir, href);
    const forFile = entries.get(path) ?? [];
    forFile.push({ fragment, label: name });
    entries.set(path, forFile);
  };

  const nav = book.nav ? read(book.nav) : null;
  if (book.nav && nav !== null) {
    const navs = DomUtils.findAll((element) => element.name === 'nav', parseDocument(nav).children);
    const toc = navs.find((element) => (element.attribs['epub:type'] ?? '').split(WHITESPACE_RUN).includes('toc'));
    for (const link of DomUtils.findAll((element) => element.name === 'a', toc ?? navs[0] ?? [])) {
      add(posix.dirname(book.nav), link.attribs.href ?? '', DomUtils.textContent(link));
    }
  }

  const ncx = book.ncx && entries.size === 0 ? read(book.ncx) : null;
  if (book.ncx && ncx !== null) {
    // Every navPoint, nested ones included, in document order: the order they are read in.
    for (const point of findAllNamed(parseXml(ncx), 'navPoint')) {
      const label = childrenNamed(point, 'navLabel').flatMap((navLabel) => childrenNamed(navLabel, 'text'))[0];
      const content = childrenNamed(point, 'content')[0];
      add(posix.dirname(book.ncx), content?.attribs.src ?? '', label ? DomUtils.textContent(label) : '');
    }
  }
  return entries;
}

/** Feeds one chapter file to the builder, starting a section wherever the table of contents points into it. */
function walkChapter(html: string, entries: ContentsEntry[], builder: SectionBuilder) {
  // Lenient HTML parsing, not XML: plenty of EPUBs ship XHTML that is not well-formed.
  const root = parseDocument(html, { recognizeSelfClosing: true });
  const anchors = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.fragment === null) {
      builder.startSection(entry.label);
    } else {
      anchors.set(entry.fragment, [...(anchors.get(entry.fragment) ?? []), entry.label]);
    }
  }

  // An anchor no element carries would otherwise be lost; it starts its section at the top instead.
  const ids = new Set(
    DomUtils.findAll((element) => element.attribs.id !== undefined, root.children).map((e) => e.attribs.id),
  );
  for (const [fragment, labels] of anchors) {
    if (ids.has(fragment) === false) {
      for (const label of labels) {
        builder.startSection(label);
      }
      anchors.delete(fragment);
    }
  }

  walkHtml(root.children, builder, (element) => {
    if (isPageBreak(element)) {
      return true;
    }
    for (const label of anchors.get(element.attribs.id ?? '') ?? []) {
      builder.startSection(label);
    }
    return false;
  });
}

/** A printed edition's page number, which would otherwise land mid-sentence. */
function isPageBreak(element: Element): boolean {
  const type = element.attribs['epub:type'] ?? '';
  return type.split(WHITESPACE_RUN).includes('pagebreak') || element.attribs.role === 'doc-pagebreak';
}
