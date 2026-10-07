/** A header the presigned URL was signed with, which the PUT has to repeat. */
export interface UploadHeader {
  name: string;
  value: string;
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
 * @param file - The file, sent as the browser's own `File` so it is streamed.
 * @param headers - The headers the URL was signed with.
 * @param onProgress - Called with the fraction sent so far, from 0 to 1.
 * @param signal - Aborts the upload when it fires.
 * @returns A promise that resolves once the bucket accepts the file, and rejects
 *   when it refuses, cannot be reached or the upload is aborted.
 */
export function putFile(
  url: string,
  file: File,
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
