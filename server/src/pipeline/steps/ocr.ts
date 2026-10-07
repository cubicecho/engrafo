import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OCR_DEFAULTS } from '../../core/defaults.ts';
import { errorMessage } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';
import { archiveKey } from '../../storage/s3.ts';
import { storeContent } from '../content.ts';
import { isImage, isOcrable } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

const exec = promisify(execFile);

const OCR_TIMEOUT_MS = OCR_DEFAULTS.timeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Asks whether ocrmypdf is on the PATH.
 *
 * @returns Its version string, or null when it cannot be run.
 *
 * @remarks
 * Asked once at boot: the Docker image ships it, but a dev server on a bare host usually does
 * not, and a missing binary should read as "OCR unavailable" rather than as every document
 * failing.
 */
export async function detectOcr(): Promise<string | null> {
  try {
    const { stdout } = await exec('ocrmypdf', ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Builds the ocrmypdf command line from the arguments Paperless-ngx passes by default.
 *
 * @param options - The run's paths and settings.
 * @param options.input - Path of the file to recognise.
 * @param options.output - Path the PDF/A archive is written to.
 * @param options.sidecar - Path the plain text is written to.
 * @param options.languages - Tesseract language codes joined with `+`.
 * @param options.image - Whether the input is an image, which needs a resolution stated.
 * @returns The arguments, in the order ocrmypdf takes them.
 *
 * @remarks
 * Pages that already carry a text layer are skipped, so a born-digital PDF keeps its text
 * untouched; scans are straightened and rotated.
 */
export function ocrArgs(options: {
  input: string;
  output: string;
  sidecar: string;
  languages: string;
  image: boolean;
}): string[] {
  return [
    '--skip-text',
    '--rotate-pages',
    '--deskew',
    '--output-type',
    'pdfa',
    '--sidecar',
    options.sidecar,
    '-l',
    options.languages,
    ...(options.image ? ['--image-dpi', String(OCR_DEFAULTS.imageDpi)] : []),
    options.input,
    options.output,
  ];
}

// ocrmypdf writes this into the sidecar for every page --skip-text left alone.
const SKIPPED_PAGE_MARKER = /\[OCR skipped on page\(s\) [\d-]+\]/g;

/**
 * Runs ocrmypdf over a PDF or an image, and stores the PDF/A archive and the text it recognised.
 * Skipped when OCR was not requested, is unavailable here, or the type is not one ocrmypdf takes.
 */
export const ocrStep: PipelineStep = {
  name: 'ocr',
  enabled: (doc, config) => doc.ocrRequested && config.ocrAvailable && isOcrable(doc.mimeType),
  async run({ doc, storage, config, tmpDir }) {
    const input = join(tmpDir, 'original');
    const output = join(tmpDir, 'archive.pdf');
    const sidecar = join(tmpDir, 'content.txt');

    await storage.files.download(doc.originalKey, input);

    try {
      await exec(
        'ocrmypdf',
        ocrArgs({ input, output, sidecar, languages: config.ocrLanguages, image: isImage(doc.mimeType) }),
        { timeout: OCR_TIMEOUT_MS, maxBuffer: OCR_DEFAULTS.maxOutputBytes },
      );
    } catch (error) {
      // ocrmypdf explains itself on stderr; the exec error's own message is just
      // the command line.
      const stderr =
        error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      throw new Error(stderr ? stderr.split('\n').slice(-OCR_DEFAULTS.errorTailLines).join('\n') : errorMessage(error));
    }

    const key = archiveKey(doc.userId, doc.id);
    await storage.files.putFile(key, output, 'application/pdf');

    const content = (await readFile(sidecar, 'utf-8')).replace(SKIPPED_PAGE_MARKER, '');
    return { archiveKey: key, ...(await storeContent(storage, doc, content)) };
  },
};
