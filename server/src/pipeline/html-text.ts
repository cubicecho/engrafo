import { type AnyNode, type Element, isTag, isText } from 'domhandler';
import { DomUtils, parseDocument } from 'htmlparser2';
import { headingLine } from '../search/chunk.ts';

// HTML with the markup taken off, as paragraphs grouped into sections. An EPUB's
// chapters and an uploaded web page are both read through here: the EPUB
// starts its sections where the table of contents points, a web page at its
// own h1-h6.

/** One section of a document's text, under the heading that starts it. */
export interface TextSection {
  /** The heading, or null for what comes before the first one. */
  heading: string | null;
  /** The heading's depth, 1 to 6, and 1 when not given: a book's chapters are stored flat. */
  level?: number;
  /** The section's paragraphs, separated by blank lines. */
  text: string;
}

/** Elements that end a paragraph. Anything else is inline and runs on. */
const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tr',
  'ul',
]);
/** Elements whose content is not the document's text. */
const SKIPPED_ELEMENTS = new Set(['head', 'script', 'style', 'noscript', 'template', 'svg', 'title']);
/** Table cells sit side by side, so a row reads as one line rather than a paragraph per cell. */
const CELL_ELEMENTS = new Set(['td', 'th']);
const HEADING_ELEMENT = /^h([1-6])$/;
// No stylesheet is applied here, so only what the markup itself says is hidden can be left out.
// A mailed receipt's preview line is the usual case: an inline `display:none` above the content.
const INLINE_HIDDEN = /(?:^|;)\s*display\s*:\s*none/i;
const WHITESPACE_RUN = /\s+/g;

/** Collects text into paragraphs and paragraphs into sections. */
export interface SectionBuilder {
  /** Starts a new section. Text before the first one goes in a section with no heading. */
  startSection(heading: string, level?: number): void;
  text(value: string): void;
  /** A `<br>`: a new line in the same paragraph. */
  lineBreak(): void;
  /** The end of a block element: the end of a paragraph. */
  endParagraph(): void;
  /**
   * The sections, in order.
   *
   * @param options.keepEmptyHeadings - Keep a heading with no text of its own, as a web page's
   *   `<h1>` straight above its `<h2>`: it is still part of the breadcrumb under it.
   */
  finish(options?: { keepEmptyHeadings?: boolean }): TextSection[];
}

/**
 * A builder to walk HTML into.
 *
 * @returns An empty builder.
 */
export function createSectionBuilder(): SectionBuilder {
  const sections: Array<{ heading: string | null; level?: number; paragraphs: string[] }> = [
    { heading: null, paragraphs: [] },
  ];
  let paragraph = '';

  const endParagraph = () => {
    const lines = paragraph
      .split('\n')
      .map((line) => line.replace(WHITESPACE_RUN, ' ').trim())
      .filter((line) => line !== '');
    if (lines.length > 0) {
      sections[sections.length - 1]?.paragraphs.push(lines.join('\n'));
    }
    paragraph = '';
  };

  return {
    startSection(heading, level) {
      endParagraph();
      sections.push({ heading, level, paragraphs: [] });
    },
    text(value) {
      // The source's own line breaks are its formatting, not the writer's.
      paragraph += value.replace(WHITESPACE_RUN, ' ');
    },
    lineBreak() {
      paragraph += '\n';
    },
    endParagraph,
    finish({ keepEmptyHeadings = false } = {}) {
      endParagraph();
      return sections
        .filter((section) => section.paragraphs.length > 0 || (keepEmptyHeadings && section.heading !== null))
        .map((section) => ({ heading: section.heading, level: section.level, text: section.paragraphs.join('\n\n') }));
    },
  };
}

/**
 * Feeds parsed HTML to a builder, paragraph by paragraph.
 *
 * @param nodes - The parsed document's nodes.
 * @param builder - Where the text goes.
 * @param enter - Called on every element that is not skipped, before its content. Returning
 *   true means it has dealt with the element, and its content is not walked.
 */
export function walkHtml(
  nodes: AnyNode[],
  builder: SectionBuilder,
  enter: (element: Element) => boolean = () => false,
) {
  const visit = (node: AnyNode) => {
    if (isText(node)) {
      builder.text(node.data);
      return;
    }
    if (isTag(node) === false) {
      if ('children' in node) {
        node.children.forEach(visit);
      }
      return;
    }

    const name = node.name.toLowerCase();
    if (SKIPPED_ELEMENTS.has(name) || isHidden(node) || enter(node)) {
      return;
    }
    if (name === 'br') {
      builder.lineBreak();
      return;
    }

    const isBlock = BLOCK_ELEMENTS.has(name);
    if (isBlock) {
      builder.endParagraph();
    }
    node.children.forEach(visit);
    if (isBlock) {
      builder.endParagraph();
    } else if (CELL_ELEMENTS.has(name)) {
      builder.text(' ');
    }
  };
  nodes.forEach(visit);
  builder.endParagraph();
}

function isHidden(element: Element): boolean {
  return element.attribs.hidden !== undefined || INLINE_HIDDEN.test(element.attribs.style ?? '');
}

/**
 * A web page's text, its h1-h6 kept as Markdown headings.
 *
 * @param html - The page, as uploaded.
 * @returns The text as it is stored, which `chunkSections` cuts at the headings. A heading
 *   carries its depth, so a passage under "Order 1234 › Items" says where it is from.
 */
export function htmlText(html: string): string {
  const builder = createSectionBuilder();
  walkHtml(parseDocument(html).children, builder, (element) => {
    const level = HEADING_ELEMENT.exec(element.name.toLowerCase())?.[1];
    if (level === undefined) {
      return false;
    }
    const heading = DomUtils.textContent(element).replace(WHITESPACE_RUN, ' ').trim();
    // A heading with no words (a logo, say) starts nothing: there is no name to put on it.
    if (heading === '') {
      return false;
    }
    builder.startSection(heading, Number(level));
    return true;
  });
  return sectionsText(builder.finish({ keepEmptyHeadings: true }));
}

/**
 * Sections as they are stored: each heading on a line of its own above its text.
 *
 * @param sections - From a `SectionBuilder`.
 * @returns The text, which `chunkSections` reads the headings back out of.
 */
export function sectionsText(sections: TextSection[]): string {
  return sections
    .map((section) => {
      if (section.heading === null) {
        return section.text;
      }
      const line = headingLine(section.heading, section.level);
      return section.text === '' ? line : `${line}\n\n${section.text}`;
    })
    .join('\n\n');
}
