export interface UploadHeader {
  name: string;
  value: string;
}

/**
 * PUTs a file straight to the presigned bucket URL.
 *
 * XHR rather than fetch: fetch still reports no upload progress, and a 100 MB
 * scan with no progress bar looks exactly like a hung page.
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
    for (const { name, value } of headers) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
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
