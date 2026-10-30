/** A header the presigned URL was signed with, which the PUT has to repeat. */
export interface UploadHeader {
  name: string;
  value: string;
}

// Browsers leave the type blank for extensions they do not know; the server's
// allowlist says no with a clearer message than S3 would.
const UNKNOWN_MIME_TYPE = 'application/octet-stream';

/** Types the server accepts that a browser may not know, by extension. */
const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  // Windows without an ebook reader installed has no type for it.
  epub: 'application/epub+zip',
  // Most browsers have none for Markdown, and some call it text/x-markdown.
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  htm: 'text/html',
  html: 'text/html',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** What a browser calls a type that the server knows by another name. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  'text/x-markdown': 'text/markdown',
  'application/csv': 'text/csv',
  'text/x-csv': 'text/csv',
  'application/x-csv': 'text/csv',
  'text/comma-separated-values': 'text/csv',
  'application/xhtml+xml': 'text/html',
};

/**
 * Windows names a type by the program that opens the extension, and with Excel installed a
 * `.csv` is Excel's. That type is also a real `.xls`'s, so it is renamed only for a `.csv`.
 */
const EXCEL_MIME_TYPE = 'application/vnd.ms-excel';

/**
 * The type an upload is declared as.
 *
 * @param file - The picked file's name and the type the browser gave it.
 * @returns The browser's type, or one from the extension when it gave none. The server reads the
 *   file's bytes afterwards either way, so this only has to get past the allowlist.
 */
export function uploadMimeType(file: { name: string; type: string }): string {
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (file.type === EXCEL_MIME_TYPE && extension === 'csv') {
    return 'text/csv';
  }
  if (file.type !== '') {
    return TYPE_ALIASES[file.type] ?? file.type;
  }
  return TYPES_BY_EXTENSION[extension] ?? UNKNOWN_MIME_TYPE;
}

// The 2xx range: from here up to the first redirect is the bucket saying yes.
const HTTP_SUCCESS_MIN = 200;
const HTTP_REDIRECT_MIN = 300;

/**
 * PUTs a file straight to the presigned bucket URL.
 *
 * XHR rather than fetch: fetch still reports no upload progress, and a 100 MB
 * scan with no progress bar looks exactly like a hung page.
 *
 * @param url - The presigned URL to PUT to.
 * @param file - The file, sent as the browser's own `Blob` handle so it is streamed.
 * @param headers - The headers the URL was signed with.
 * @param onProgress - Called with the fraction sent so far, from 0 to 1.
 * @param signal - Aborts the upload when it fires.
 * @returns A promise that resolves once the bucket accepts the file, and rejects
 *   when it refuses, cannot be reached or the upload is aborted.
 */
export function putFile(
  url: string,
  file: Blob,
  headers: UploadHeader[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const { name, value } of headers) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= HTTP_SUCCESS_MIN && xhr.status < HTTP_REDIRECT_MIN) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (HTTP ${xhr.status})`));
      }
    };
    // A CORS refusal and an unreachable bucket look identical from here.
    xhr.onerror = () => reject(new Error('Could not reach storage'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}

/**
 * Names a NAS, a desktop or an editor leaves beside the files, which nobody means to file: the
 * watched folder's own rule. Dotfiles (`.DS_Store`, `._scan.pdf`), Office's `~$` owner files, and
 * Windows's thumbnail cache and folder settings.
 */
const IGNORED_FILE_NAMES = new Set(['thumbs.db', 'desktop.ini']);

function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || IGNORED_FILE_NAMES.has(name.toLowerCase());
}

/** Directories a NAS or a desktop keeps for itself: dot-directories, `@eaDir`, `#recycle`, `$RECYCLE.BIN`. */
function isIgnoredDir(name: string): boolean {
  return ['.', '@', '#', '$'].some((prefix) => name.startsWith(prefix));
}

/** A file from a picked folder, with the folders it sat in. */
export interface FolderFile<F> {
  file: F;
  /** The folder names from the picked folder down, the picked folder's own first. */
  folderPath: string[];
}

/** A folder whose files are left out, and why. */
export interface RefusedFolder {
  path: string;
  reason: string;
}

/** What a picked folder comes to. */
export interface FolderUpload<F> {
  files: FolderFile<F>[];
  /** Folders left out, with everything under them, because their name cannot be a folder's. */
  refused: RefusedFolder[];
}

/**
 * Sorts a folder pick into what to upload and what to leave.
 *
 * @param files - The picked files, each with its `path` in the folder (`Taxes/2026/scan.pdf`).
 * @param nameError - What is wrong with a folder name, or undefined when nothing is.
 * @returns The files to upload with their folder paths, and each folder refused once, outermost
 *   only. Junk the OS leaves behind is dropped without a word.
 */
export function planFolderUpload<F extends { path: string }>(
  files: readonly F[],
  nameError: (name: string) => string | undefined,
): FolderUpload<F> {
  const accepted: FolderFile<F>[] = [];
  const refused = new Map<string, string>();
  for (const file of files) {
    const parts = file.path.split('/').filter((part) => part !== '');
    const name = parts.pop();
    if (name === undefined || isIgnoredName(name) || parts.some(isIgnoredDir)) {
      continue;
    }
    const bad = parts.findIndex((part) => nameError(part) !== undefined);
    if (bad === -1) {
      accepted.push({ file, folderPath: parts });
      continue;
    }
    const path = parts.slice(0, bad + 1).join('/');
    if (refused.has(path) === false) {
      refused.set(path, nameError(parts[bad]) ?? '');
    }
  }
  return { files: accepted, refused: Array.from(refused, ([path, reason]) => ({ path, reason })) };
}

/**
 * Runs at most `limit` tasks at once and queues the rest, in the order they came.
 *
 * Uploads go through one, so a dropped folder of five hundred scans does not sign five hundred
 * URLs at once: a URL signed now and sent ten minutes later, behind the browser's own queue,
 * has expired.
 *
 * @param limit - How many may run at once.
 * @returns A function that runs a task when a slot is free, resolving with what it resolves to.
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (running < limit) {
      running += 1;
    } else {
      // The slot is handed over by the task that frees it, so `running` never dips in between
      // and a task arriving at that moment cannot take it first.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const handOver = waiting.shift();
      if (handOver) {
        handOver();
      } else {
        running -= 1;
      }
    }
  };
}
