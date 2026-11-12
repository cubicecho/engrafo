import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { askReply, FinishReason, type SideTaskInput, type SideTaskReply } from '@cubicecho/agent-core';
import type { Document } from '@cubicecho/engrafo-db';
import { ContentFormat, VisionImageDetail } from '@cubicecho/engrafo-db/schema';
import { OCR_DEFAULTS, VISION_DEFAULTS } from '../../core/defaults.ts';
import { errorMessage } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';
import type { StorageSet } from '../../storage/s3.ts';
import { samplerBody, type VisionConfig } from '../../vision/settings.ts';
import { storeContent } from '../content.ts';
import { pngHasTransparency, toOpaquePng } from '../image.ts';
import { isImage, isOcrable, needsPngForOcr } from '../mime.ts';
import type { PipelineStep, StepContext } from '../types.ts';
import { ocrStep } from './ocr.ts';

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
 * The instruction when the admin wants Markdown. The same refusals as `TRANSCRIBE`, plus a rule for
 * each place a scan's Markdown goes wrong, most of them taken from the prompts the OCR-tuned
 * models were trained on (olmOCR, Nanonets-OCR, Zerox):
 *
 * - Columns read across, and a heading level guessed per line rather than from the page.
 * - Every printed line kept as a line, so a paragraph is a run of fragments and a hyphenated word
 *   is two halves that search never finds.
 * - A table drawn without its separator row, or with a ragged row, which is no table at all.
 * - A checkbox, a logo or a photo guessed at in prose, or a word it cannot read invented.
 * - One page of many treated as a whole document: a heading made up over a table that carries
 *   on from the last page.
 *
 * Tables stay Markdown, not the HTML those models write: the Text tab draws no HTML and the index
 * cuts by Markdown headings. A bare page number is left out because it is noise in every passage;
 * running headers and footers are kept, since on an invoice they hold the VAT number and the IBAN.
 * Newline-separated, because the admin starts from it in a textarea.
 */
export const TRANSCRIBE_MARKDOWN = [
  'You are an OCR engine that writes Markdown. Transcribe the page image exactly as it reads, and mark up only the structure the page shows.',
  '',
  '- Reading order: top to bottom. On a page set in columns, finish each column before starting the next. A sidebar or a boxed note goes after the text it sits beside.',
  '- Headings: a # heading for a line the page sets apart as a title or a section heading by its size, weight or the space around it. The largest on the page is #, the next ##, and so on, without skipping a level. A bold word inside a sentence is not a heading.',
  '- Paragraphs: join the lines of one paragraph into one line, rejoining a word hyphenated across a line break, and put a blank line between paragraphs. Keep the lines of an address, a signature block or a poem as separate lines.',
  '- Lists: a bulleted item as "- ", a numbered one as "1. " with the number it has; indent a nested item by two spaces.',
  "- Tables: anything laid out in rows and columns, an invoice's line items included, as a Markdown table: the header row, a | --- | separator row, then one row per line, with the same number of cells in every row. Leave an empty cell empty, put a merged cell's text in its first cell, and write a | inside a cell as \\|. A table with no header row takes its first row as the header.",
  '- Forms: a label and its value as "Label: value" on one line, and a checkbox as ☐ or ☑ as it is marked.',
  '- Emphasis: **bold** and *italic* only where the page shows it.',
  '- Exactness: keep every number, amount, date, code and name as printed, with its currency symbol and decimal separator. Read handwriting too.',
  '- Not text: a logo or a stamp with words in it is its words. A photo, chart or drawing is ![a few words on what it shows]() on a line of its own. A page number standing alone at the top or bottom is left out.',
  '- Unreadable: write [illegible] for a word you cannot make out. Never guess.',
  '',
  'The page may be one of several: a page that starts mid-sentence, mid-list or mid-table starts with it, under no heading of your own.',
  'Do not translate, summarise, correct, explain or add commentary, and add no heading, list, table or emphasis the page does not have. Write no HTML, and do not wrap the answer in a code block.',
  'Output the Markdown of the page and nothing else. A page with no text gets an empty answer.',
].join('\n');

/**
 * The instruction a page is read with.
 *
 * @param vision - The run's settings.
 * @returns The admin's own instruction when there is one, whatever the format; else the built-in
 *   one for the format.
 */
export function visionInstruction(vision: Pick<VisionConfig, 'prompt' | 'textFormat'>): string {
  return vision.prompt ?? builtInInstruction(vision.textFormat);
}

/**
 * The built-in instruction for a format, which the settings page offers to start from.
 *
 * @param format - What the model is asked to write.
 * @returns `TRANSCRIBE_MARKDOWN` for Markdown, else `TRANSCRIBE`.
 */
export function builtInInstruction(format: ContentFormat): string {
  return format === ContentFormat.Markdown ? TRANSCRIBE_MARKDOWN : TRANSCRIBE;
}

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
 * @param position - Which page of how many, for a document of more than one. Each page is read
 *   alone, so this is all the model knows of the pages around it: told it is page 3 of 7, it does
 *   not open a table carried over from page 2 with a title of its own.
 * @returns The instruction's object and the page it applies to, as OpenAI content parts.
 */
export function pageInput(
  image: Buffer,
  mimeType: string,
  detail: VisionImageDetail = VisionImageDetail.Auto,
  position?: { page: number; of: number },
): SideTaskInput {
  const url = `data:${mimeType};base64,${image.toString('base64')}`;
  const ask =
    position === undefined || position.of < 2
      ? 'Transcribe this page.'
      : `Transcribe page ${position.page} of ${position.of}.`;
  return [
    { type: 'text', text: ask },
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
    const markdown = vision.textFormat === ContentFormat.Markdown;
    const input = pageInput(image, page.mimeType, vision.imageDetail, { page: index + 1, of: pages.length });
    let reply: SideTaskReply;
    try {
      reply = await askReply(vision, vision.model, visionInstruction(vision), input, {
        maxTokens: vision.maxResponseTokens,
        temperature: vision.temperature,
        extraBody: samplerBody(vision.sampler),
        onNotice: notice,
      });
    } catch (error) {
      throw new Error(`The vision model did not read ${label}: ${errorMessage(error)}`);
    }
    // A reply that ran into the limit is cut off, and on a page it is almost always a model
    // repeating one line, not a page longer than the limit: saved, it would replace good text
    // with a loop. So it is a page that did not come back, and all-or-nothing applies.
    if (reply.finishReason === FinishReason.Length) {
      throw new Error(
        `The vision model did not finish ${label}: it hit the reply limit of ${vision.maxResponseTokens} tokens, so it likely looped.`,
      );
    }
    transcript.push(markdown ? unfence(reply.text.trim()) : reply.text.trim());
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
 * It runs after `ocr` and by default does not take over from it: ocrmypdf still writes the PDF/A
 * archive, because the archive is the copy that has to outlive this instance and no vision model
 * emits one. Only the text in the text bucket is at stake, which is the half where a model that
 * reads a curved scan, a table or handwriting beats Tesseract. On "Skip OCR and read
 * automatically" (`skipOcr`) the admin trades the archive for not reading every page twice: `ocr`
 * stands aside, there is no archive, and the model is shown the original.
 *
 * Every page has to come back or nothing is written: a transcript missing the page the endpoint
 * choked on would overwrite text that had it. What happens then depends on who wanted the run.
 * When nobody asked (the model is on "auto" and OCR ran), the document is fine without it, so the
 * existing text is kept, the reason is logged, and the step succeeds: an endpoint that is down
 * must not fail every scan filed while it is. When someone asked for this document to be read, a
 * silent success would tell them it worked, so the step fails with the reason, and Retry runs it
 * again from here. When OCR was skipped for the model's sake, the text it would keep is at best a
 * PDF's own text layer, so it runs OCR then, as it would have run without the model.
 */
export const visionStep: PipelineStep = {
  name: VISION_STEP,
  enabled: (doc, { vision }) =>
    vision !== null && isOcrable(doc.mimeType) && (doc.visionRequested || (vision.auto && doc.ocrRequested)),
  async run(context) {
    const { doc, storage, config, tmpDir, reportProgress } = context;
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
      // The ocr step's own check, with the model taken out of it: would OCR have run without it?
      if (vision.skipOcr && ocrStep.enabled(doc, { ...config, vision: null })) {
        notice(`${doc.id}: ${errorMessage(error)} Running OCR instead.`);
        return ocrStep.run(context);
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
