import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { archiveKey } from '../../storage/s3.ts';
import { storeContent } from '../content.ts';
import { isImage, isOcrable } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

const exec = promisify(execFile);

// A long scanned PDF on one core takes minutes, not seconds. This is the bound
// on a wedged process, not an estimate of a slow one.
const OCR_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Whether ocrmypdf is on the PATH. Asked once at boot: the Docker image ships
 * it, but a dev server on a bare host usually does not, and a missing binary
 * should read as "OCR unavailable" rather than as every document failing.
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
 * The arguments Paperless-ngx passes by default: skip pages that already carry a
 * text layer (born-digital PDFs keep their text untouched), straighten and
 * rotate scans, and write a PDF/A archive plus a plain-text sidecar.
 */
export function ocrArgs(options: {
  input: string;
  output: string;
  sidecar: string;
  languages: string;
  image: boolean;
}) {
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
    // Images often carry no DPI metadata, and img2pdf refuses to guess.
    ...(options.image ? ['--image-dpi', '300'] : []),
    options.input,
    options.output,
  ];
}

// ocrmypdf writes this into the sidecar for every page --skip-text left alone.
const SKIPPED_PAGE_MARKER = /\[OCR skipped on page\(s\) [\d-]+\]/g;

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
        { timeout: OCR_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (error) {
      // ocrmypdf explains itself on stderr; the exec error's own message is just
      // the command line.
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new Error(stderr ? stderr.split('\n').slice(-5).join('\n') : (error as Error).message);
    }

    const key = archiveKey(doc.userId, doc.id);
    await storage.files.putFile(key, output, 'application/pdf');

    const content = (await readFile(sidecar, 'utf-8')).replace(SKIPPED_PAGE_MARKER, '');
    return { archiveKey: key, ...(await storeContent(storage, doc, content)) };
  },
};
