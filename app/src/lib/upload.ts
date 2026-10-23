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
};

/** What a browser calls a type that the server knows by another name. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  'text/x-markdown': 'text/markdown',
};

/**
 * The type an upload is declared as.
 *
 * @param file - The picked file's name and the type the browser gave it.
 * @returns The browser's type, or one from the extension when it gave none. The server reads the
 *   file's bytes afterwards either way, so this only has to get past the allowlist.
 */
export function uploadMimeType(file: { name: string; type: string }): string {
  if (file.type !== '') {
    return TYPE_ALIASES[file.type] ?? file.type;
  }
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
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
