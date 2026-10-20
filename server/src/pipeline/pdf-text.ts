import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDF_TEXT_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

// A PDF that was made rather than scanned already carries its text. ocrmypdf
// leaves those pages alone (--skip-text) and its sidecar holds only a marker
// for them, so the text has to be read from the PDF itself, as Paperless-ngx
// does with the same tool.

const exec = promisify(execFile);

const PDF_TEXT_TIMEOUT_MS = PDF_TEXT_DEFAULTS.timeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
/** What pdftotext puts between pages. */
const PAGE_BREAK = /\f/g;

/**
 * Asks whether pdftotext is on the PATH.
 *
 * @returns true when it can be run.
 *
 * @remarks
 * Asked once at boot, like ocrmypdf: the image ships it (poppler-utils), a bare dev host may not.
 */
export async function detectPdfText(): Promise<boolean> {
  try {
    await exec('pdftotext', ['-v']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every page's text layer.
 *
 * @param path - A PDF on disk.
 * @returns The text, pages separated by a blank line. Empty for a PDF with no text layer.
 */
export async function readPdfText(path: string): Promise<string> {
  const { stdout } = await exec('pdftotext', ['-enc', 'UTF-8', path, '-'], {
    timeout: PDF_TEXT_TIMEOUT_MS,
    maxBuffer: PDF_TEXT_DEFAULTS.maxOutputBytes,
  });
  return stdout.replace(PAGE_BREAK, '\n\n');
}
