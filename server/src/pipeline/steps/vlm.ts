import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ask, type SideTaskInput, tryAsk } from '@cubicecho/agent-core';
import type { Document } from '@cubicecho/engrafo-db';
import { VLM_DEFAULTS } from '../../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';
import type { StorageSet } from '../../storage/s3.ts';
import { storeContent } from '../content.ts';
import { isImage, isOcrable } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

const exec = promisify(execFile);

// Ghostscript is already in the image, rendering ocrmypdf's PDF/A. Rasterising
// with it costs no new package in either Docker stage.
const GHOSTSCRIPT_TIMEOUT_MS = VLM_DEFAULTS.rasterTimeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * The instruction. Blunt about what not to do, because the failure mode of a
 * general vision model on a page of text is helpfulness — it summarises the
 * invoice, or answers the letter, and the archive stores that instead of the
 * page.
 */
export const TRANSCRIBE = [
  'You are an OCR engine. Transcribe the page image exactly as it reads, top to bottom.',
  'Preserve the reading order, the line breaks and the table rows; write a table as pipe-separated rows.',
  'Do not translate, summarise, correct, explain, or add commentary of any kind.',
  'Output the text of the page and nothing else. A page with no text gets an empty answer.',
].join(' ');

/**
 * Builds the Ghostscript command line that writes one numbered PNG per page.
 *
 * @param input - Path of the PDF to rasterise.
 * @param pattern - Output path with a `%d` placeholder for the page number.
 * @param lastPage - The last page to render.
 * @param dpi - Resolution to render at. Defaults to `VLM_DEFAULTS.pageDpi`.
 * @returns The arguments, in the order Ghostscript takes them.
 *
 * @remarks
 * The caller asks for one page more than the cap, so it can tell "exactly at the cap" from
 * "over it" without first counting the pages in a separate pass.
 */
export function rasterArgs(
  input: string,
  pattern: string,
  lastPage: number,
  dpi: number = VLM_DEFAULTS.pageDpi,
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
 * @returns The instruction's object and the page it applies to, as OpenAI content parts.
 */
export function pageInput(image: Buffer, mimeType: string): SideTaskInput {
  return [
    { type: 'text', text: 'Transcribe this page.' },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
  ];
}

interface Page {
  file: string;
  mimeType: string;
}

/**
 * The pages to show the model, as files on disk, or null where there are too
 * many.
 *
 * An image is already a page and goes as it was uploaded: ocrmypdf wrapped it in
 * a PDF to produce the archive, and rasterising that back out would re-encode
 * the same pixels twice for nothing. A PDF is rendered from the archive where
 * ocrmypdf wrote one — those pages have been deskewed and rotated upright, which
 * is preprocessing the model would otherwise have to see past — and from the
 * original where it did not.
 */
async function pageImages(storage: StorageSet, doc: Document, dir: string): Promise<Page[] | null> {
  if (isImage(doc.mimeType)) {
    const file = join(dir, 'page');
    await storage.files.download(doc.originalKey, file);
    return [{ file, mimeType: doc.mimeType }];
  }

  const source = join(dir, 'source.pdf');
  await storage.files.download(doc.archiveKey ?? doc.originalKey, source);

  await exec('gs', rasterArgs(source, join(dir, 'page-%04d.png'), VLM_DEFAULTS.maxPages + 1), {
    timeout: GHOSTSCRIPT_TIMEOUT_MS,
  });

  // Zero-padded to four digits by Ghostscript, so lexical order is page order.
  const files = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort();
  if (files.length > VLM_DEFAULTS.maxPages) {
    return null;
  }
  return files.map((name) => ({ file: join(dir, name), mimeType: 'image/png' }));
}

/**
 * Re-reads the pages with a vision model and replaces the text ocrmypdf
 * extracted.
 *
 * It runs after `ocr` and deliberately does not take over from it: ocrmypdf
 * still writes the PDF/A archive, because the archive is the copy that has to
 * outlive this instance and no vision model emits one. Only the text in the text
 * bucket is at stake here, which is the half where a model that reads a curved
 * scan, a table or handwriting beats Tesseract.
 *
 * Every page has to come back or nothing is written. A transcript missing the
 * page the endpoint choked on would overwrite text that had it, and losing a
 * page of an archived document to an enhancement is worse than not enhancing it
 * — so a failure here leaves Tesseract's text in place and the step still
 * succeeds, because the document itself is fine.
 */
export const vlmStep: PipelineStep = {
  name: 'vlm',
  enabled: (doc, config) => doc.ocrRequested && config.vlm !== null && isOcrable(doc.mimeType),
  async run({ doc, storage, config, tmpDir }) {
    const { vlm } = config;
    if (vlm === null) {
      return undefined;
    }

    // Its own directory: `ocr` has already written `original`, `archive.pdf` and
    // `content.txt` into the run's tmpDir, and the page glob must not find them.
    const dir = join(tmpDir, 'vlm');
    await mkdir(dir, { recursive: true });

    const pages = await pageImages(storage, doc, dir);
    if (pages === null) {
      notice(`${doc.id}: more than ${VLM_DEFAULTS.maxPages} pages, keeping the ocrmypdf text`);
      return undefined;
    }
    if (pages.length === 0) {
      return undefined;
    }

    const transcript: string[] = [];
    for (const [index, page] of pages.entries()) {
      const label = `page ${index + 1} of ${pages.length}`;
      const image = await readFile(page.file);
      const text = await tryAsk(
        label,
        () =>
          ask(vlm, vlm.model, TRANSCRIBE, pageInput(image, page.mimeType), {
            maxTokens: VLM_DEFAULTS.pageMaxTokens,
            // Transcription, not generation: the same page twice should read the
            // same way twice.
            temperature: 0,
          }),
        { onNotice: notice },
      );
      if (text === undefined) {
        notice(`${doc.id}: ${label} did not come back, keeping the ocrmypdf text`);
        return undefined;
      }
      transcript.push(text.trim());
    }

    // Every page blank is a model that answered without reading, not a blank
    // document — and `storeContent` would take the empty string as "no text" and
    // drop the object ocrmypdf's text is in.
    const content = transcript.join('\n\n').trim();
    if (content === '') {
      notice(`${doc.id}: the model returned nothing for any page, keeping the ocrmypdf text`);
      return undefined;
    }

    return storeContent(storage, doc, content);
  },
};

function notice(message: string): void {
  console.warn(`[vlm] ${message}`);
}
