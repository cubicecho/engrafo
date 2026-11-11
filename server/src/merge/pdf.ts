import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MERGE_DEFAULTS, OCR_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

const exec = promisify(execFile);

const MERGE_TIMEOUT_MS = MERGE_DEFAULTS.timeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

// What the script exits with when a source file is the problem rather than the script: a
// password-protected PDF, an image Pillow cannot read. That is the user's to fix, so it is told to
// them as it is; anything else is a server fault.
const REFUSED_EXIT_CODE = 2;

// pikepdf copies the pages as they are, so a PDF's own text layer, fonts and images survive and
// nothing is drawn again (Ghostscript would re-render every page). An image becomes a page through
// img2pdf, which embeds a JPEG or PNG without re-encoding it, at the resolution it states or OCR's
// assumed one: img2pdf's own fallback of 96 DPI makes a 300 DPI scan a poster. Each source gets a
// bookmark with its title, so the merged file still says where each document starts.
//
// The sources stay open until the save, because pikepdf copies foreign pages lazily.
const MERGE = `
import io, json, sys
import img2pdf, pikepdf
from PIL import Image

parts = json.loads(sys.argv[1])
output = sys.argv[2]
default_dpi = float(sys.argv[3])

def refuse(part, why):
    print(f"“{part['title']}”: {why}", file=sys.stderr)
    sys.exit(${REFUSED_EXIT_CODE})

def open_part(part):
    if part["kind"] == "image":
        with Image.open(part["path"]) as image:
            dpi = image.info.get("dpi")
        # A density of 1 is a JFIF aspect ratio, not a resolution.
        if not dpi or any(value <= 1 for value in dpi):
            dpi = (default_dpi, default_dpi)
        layout = img2pdf.get_fixed_dpi_layout_fun(tuple(float(value) for value in dpi))
        return pikepdf.open(io.BytesIO(img2pdf.convert(part["path"], layout_fun=layout)))
    return pikepdf.open(part["path"])

merged = pikepdf.new()
sources = []
with merged.open_outline() as outline:
    for part in parts:
        try:
            source = open_part(part)
        except pikepdf.PasswordError:
            refuse(part, "the PDF is password-protected")
        except Exception as error:
            refuse(part, str(error) or type(error).__name__)
        sources.append(source)
        outline.root.append(pikepdf.OutlineItem(part["title"], len(merged.pages)))
        merged.pages.extend(source.pages)
merged.save(output)
`;

/** One document's pages, on disk, in the order they go in. */
export interface MergePart {
  path: string;
  /** A PDF is copied page for page; an image becomes a page of its own (one per frame of a TIFF). */
  kind: 'pdf' | 'image';
  /** The bookmark that marks where it starts. */
  title: string;
}

/** A source the merge could not read, said in words a person can act on. */
export class MergeRefusedError extends Error {}

/**
 * Whether this host can merge: Python with pikepdf and img2pdf, which ocrmypdf brings.
 *
 * @returns true when both import.
 */
export async function detectMerge(): Promise<boolean> {
  return exec(MERGE_DEFAULTS.python, ['-c', 'import pikepdf, img2pdf']).then(
    () => true,
    () => false,
  );
}

/**
 * Writes the parts, in order, as one PDF.
 *
 * @param parts - The sources, first page first.
 * @param output - Where the PDF goes.
 * @throws MergeRefusedError when a source cannot be read, naming it; an Error when the script
 *   itself failed or timed out.
 */
export async function mergeToPdf(parts: readonly MergePart[], output: string): Promise<void> {
  try {
    await exec(MERGE_DEFAULTS.python, ['-c', MERGE, JSON.stringify(parts), output, String(OCR_DEFAULTS.imageDpi)], {
      timeout: MERGE_TIMEOUT_MS,
    });
  } catch (error) {
    // A traceback's last line is the exception, which is the part that says what went wrong.
    const stderr =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const lastLine = stderr.split('\n').at(-1) || errorMessage(error);
    if (error instanceof Error && 'code' in error && error.code === REFUSED_EXIT_CODE) {
      throw new MergeRefusedError(lastLine);
    }
    throw new Error(`Could not merge the documents: ${lastLine}`);
  }
}
