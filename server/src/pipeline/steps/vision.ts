import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ask, type SideTaskInput } from '@cubicecho/agent-core';
import type { Document } from '@cubicecho/engrafo-db';
import { ContentFormat, VisionImageDetail } from '@cubicecho/engrafo-db/schema';
import { OCR_DEFAULTS, VISION_DEFAULTS } from '../../core/defaults.ts';
import { errorMessage } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';
import type { StorageSet } from '../../storage/s3.ts';
import type { VisionConfig } from '../../vision/settings.ts';
import { storeContent } from '../content.ts';
import { pngHasTransparency, toOpaquePng } from '../image.ts';
import { isImage, isOcrable, needsPngForOcr } from '../mime.ts';
import type { PipelineStep, StepContext } from '../types.ts';

const exec = promisify(execFile);

// Ghostscript is already in the image, rendering ocrmypdf's PDF/A. Rasterising with it costs no
// new package in either Docker stage.
const RASTER_TIMEOUT_MS = VISION_DEFAULTS.rasterTimeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** The step's name, stored on every document's step rows; the app labels it "Vision model". */
export const VISION_STEP = 'vision';

/** The one image type every OpenAI-compatible server reads, and what a page is rendered as. */
const PNG = 'image/png';

/**
 * The instruction. Blunt about what not to do, because the failure mode of a general vision model
 * on a page of text is helpfulness: it summarises the invoice, or answers the letter, and the
 * archive stores that instead of the page.
 */
export const TRANSCRIBE = [
  'You are an OCR engine. Transcribe the page image exactly as it reads, top to bottom.',
  'Preserve the reading order, the line breaks and the table rows; write a table as pipe-separated rows.',
  'Do not translate, summarise, correct, explain, or add commentary of any kind.',
  'Output the text of the page and nothing else. A page with no text gets an empty answer.',
].join(' ');

/**
 * The instruction when the admin wants Markdown. The same refusals as `TRANSCRIBE`, plus the two
 * ways a model asked for Markdown goes wrong: inventing structure the page does not have, and
 * wrapping the whole answer in a code fence.
 */
export const TRANSCRIBE_MARKDOWN = [
  'You are an OCR engine. Transcribe the page image exactly as it reads, top to bottom, as Markdown.',
  'Write headings as # headings at the level the page gives them, lists as Markdown lists, tables as Markdown tables, and bold or italic only where the page shows it.',
  'Keep the reading order and the paragraphs; add no headings, lists or emphasis the page does not have.',
  'Do not translate, summarise, correct, explain, or add commentary of any kind, and do not wrap the answer in a code block.',
  'Output the Markdown of the page and nothing else. A page with no text gets an empty answer.',
].join(' ');

// A whole answer inside one fence, which models write for "Markdown" however they are told not to.
const WHOLE_ANSWER_FENCE = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n?```$/i;

/**
 * Takes the code fence off an answer that is nothing but one fenced block.
 *
 * @param answer - One page's answer, trimmed.
 * @returns What is inside the fence, or the answer untouched when it is not one fenced block, so
 *   a page that holds a code block among its text keeps it.
 */
export function unfence(answer: string): string {
  return WHOLE_ANSWER_FENCE.exec(answer)?.[1]?.trim() ?? answer;
}

// Every frame of a TIFF as its own PNG, laid on white. A scanner's multi-page TIFF is a document
// of many pages, unlike an animated GIF, so toOpaquePng's first frame alone would drop the rest;
// and few vision servers take a TIFF at all. Pillow, because ocrmypdf already needs it.
const TIFF_TO_PNGS = `
import sys
from PIL import Image, ImageSequence
source, pattern, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
with Image.open(source) as image:
    for index, frame in enumerate(ImageSequence.Iterator(image)):
        if index >= limit:
            break
        rgba = frame.convert("RGBA")
        page = Image.new("RGB", rgba.size, "white")
        page.paste(rgba, mask=rgba.getchannel("A"))
        page.save(pattern % (index + 1), "PNG")
`;

/**
 * Builds the Ghostscript command line that writes one numbered PNG per page.
 *
 * @param input - Path of the PDF to rasterise.
 * @param pattern - Output path with a `%d` placeholder for the page number.
 * @param lastPage - The last page to render.
 * @param dpi - Resolution to render at. Defaults to `VISION_DEFAULTS.pageDpi`.
 * @returns The arguments, in the order Ghostscript takes them.
 *
 * @remarks
 * The caller asks for one page more than the cap, so it can tell "exactly at the cap" from "over
 * it" without first counting the pages in a separate pass.
 */
export function rasterArgs(
  input: string,
  pattern: string,
  lastPage: number,
  dpi: number = VISION_DEFAULTS.pageDpi,
): string[] {
  return [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=png16m',
    `-r${dpi}`,
    `-dLastPage=${lastPage}`,
    `-sOutputFile=${pattern}`,
    input,
  ];
}

/**
 * Builds the user turn for one page.
 *
 * @param image - The page's bytes.
 * @param mimeType - The image's media type, which the data URL carries.
 * @param detail - How closely the model looks at it, the admin's setting.
 * @returns The instruction's object and the page it applies to, as OpenAI content parts.
 */
export function pageInput(
  image: Buffer,
  mimeType: string,
  detail: VisionImageDetail = VisionImageDetail.Auto,
): SideTaskInput {
  const url = `data:${mimeType};base64,${image.toString('base64')}`;
  return [
    { type: 'text', text: 'Transcribe this page.' },
    // `auto` is sent as no `detail` at all, which is what it means, and what a server that does
    // not know the field has always been sent.
    { type: 'image_url', image_url: detail === VisionImageDetail.Auto ? { url } : { url, detail } },
  ];
}

interface Page {
  file: string;
  mimeType: string;
}

/** The numbered PNGs a renderer wrote into `dir`, in page order, or null past the cap. */
async function renderedPages(dir: string): Promise<Page[] | null> {
  // Zero-padded to four digits, so lexical order is page order.
  const files = (await readdir(dir)).filter((name) => name.startsWith('page-') && name.endsWith('.png')).sort();
  if (files.length > VISION_DEFAULTS.maxPages) {
    return null;
  }
  return files.map((name) => ({ file: join(dir, name), mimeType: PNG }));
}

/**
 * The pages to show the model, as files on disk, or null where there are too many.
 *
 * A JPEG or an opaque PNG is already a page and goes as it was uploaded: rasterising ocrmypdf's
 * archive back out would re-encode the same pixels for nothing. A WebP, a GIF or a see-through
 * PNG goes as the opaque PNG ocrmypdf is given (`toOpaquePng`), since not every server reads the
 * first two and a transparent page is read as black by some. A TIFF goes a PNG per frame. A PDF
 * is rendered from the archive where ocrmypdf wrote one, whose pages have been deskewed and
 * rotated upright, which is preprocessing the model would otherwise have to see past, and from
 * the original where it did not.
 */
async function pageImages(storage: StorageSet, doc: Document, dir: string): Promise<Page[] | null> {
  const pattern = join(dir, 'page-%04d.png');

  if (isImage(doc.mimeType)) {
    const original = join(dir, 'original');
    await storage.files.download(doc.originalKey, original);
    if (doc.mimeType === 'image/tiff') {
      await exec(
        OCR_DEFAULTS.pngConverter,
        ['-c', TIFF_TO_PNGS, original, pattern, String(VISION_DEFAULTS.maxPages + 1)],
        {
          timeout: RASTER_TIMEOUT_MS,
        },
      );
      return renderedPages(dir);
    }
    if (needsPngForOcr(doc.mimeType) || (doc.mimeType === PNG && (await pngHasTransparency(original)))) {
      const file = join(dir, 'page-0001.png');
      await toOpaquePng(original, file);
      return [{ file, mimeType: PNG }];
    }
    return [{ file: original, mimeType: doc.mimeType }];
  }

  const source = join(dir, 'source.pdf');
  await storage.files.download(doc.archiveKey ?? doc.originalKey, source);
  await exec('gs', rasterArgs(source, pattern, VISION_DEFAULTS.maxPages + 1), { timeout: RASTER_TIMEOUT_MS });
  return renderedPages(dir);
}

/**
 * Reads every page with the model.
 *
 * @returns The transcript, pages separated by a blank line.
 * @throws When there are too many pages, a page does not come back, or every page came back
 *   blank, with a message saying which.
 */
async function transcribe(
  storage: StorageSet,
  doc: Document,
  vision: VisionConfig,
  dir: string,
  reportProgress: StepContext['reportProgress'],
): Promise<string> {
  const pages = await pageImages(storage, doc, dir);
  if (pages === null) {
    throw new Error(`More than ${VISION_DEFAULTS.maxPages} pages, which is more than the vision model is given.`);
  }
  if (pages.length === 0) {
    throw new Error('The document has no pages to read.');
  }

  const transcript: string[] = [];
  for (const [index, page] of pages.entries()) {
    const label = `page ${index + 1} of ${pages.length}`;
    await reportProgress(index, pages.length);
    const image = await readFile(page.file);
    try {
      const markdown = vision.textFormat === ContentFormat.Markdown;
      const instruction = markdown ? TRANSCRIBE_MARKDOWN : TRANSCRIBE;
      const text = await ask(vision, vision.model, instruction, pageInput(image, page.mimeType, vision.imageDetail), {
        maxTokens: vision.maxResponseTokens,
        temperature: vision.temperature,
        onNotice: notice,
      });
      transcript.push(markdown ? unfence(text.trim()) : text.trim());
    } catch (error) {
      throw new Error(`The vision model did not read ${label}: ${errorMessage(error)}`);
    }
  }
  await reportProgress(pages.length, pages.length);

  // Every page blank is a model that answered without reading, not a blank document, and
  // `storeContent` would take the empty string as "no text" and drop the object the text is in.
  const content = transcript.join('\n\n').trim();
  if (content === '') {
    throw new Error('The vision model returned nothing for any page.');
  }
  return content;
}

/**
 * Re-reads a PDF's or an image's pages with a vision model and replaces the text the steps before
 * it extracted.
 *
 * It runs after `ocr` and deliberately does not take over from it: ocrmypdf still writes the PDF/A
 * archive, because the archive is the copy that has to outlive this instance and no vision model
 * emits one. Only the text in the text bucket is at stake, which is the half where a model that
 * reads a curved scan, a table or handwriting beats Tesseract.
 *
 * Every page has to come back or nothing is written: a transcript missing the page the endpoint
 * choked on would overwrite text that had it. What happens then depends on who wanted the run.
 * When nobody asked (the model is on "auto" and OCR ran), the document is fine without it, so the
 * existing text is kept, the reason is logged, and the step succeeds: an endpoint that is down
 * must not fail every scan filed while it is. When someone asked for this document to be read, a
 * silent success would tell them it worked, so the step fails with the reason, and Retry runs it
 * again from here.
 */
export const visionStep: PipelineStep = {
  name: VISION_STEP,
  enabled: (doc, { vision }) =>
    vision !== null && isOcrable(doc.mimeType) && (doc.visionRequested || (vision.auto && doc.ocrRequested)),
  async run({ doc, storage, config, tmpDir, reportProgress }) {
    const { vision } = config;
    if (vision === null) {
      return undefined;
    }

    // Its own directory: `ocr` has already written `original`, `archive.pdf` and `content.txt`
    // into the run's tmpDir, and the page listing must not find them.
    const dir = join(tmpDir, VISION_STEP);
    await mkdir(dir, { recursive: true });

    let content: string;
    try {
      content = await transcribe(storage, doc, vision, dir, reportProgress);
    } catch (error) {
      if (doc.visionRequested) {
        throw error;
      }
      notice(`${doc.id}: ${errorMessage(error)} Keeping the text it had.`);
      return undefined;
    }
    return storeContent(storage, doc, content, vision.textFormat);
  },
};

function notice(message: string): void {
  console.warn(`[vision] ${message}`);
}
