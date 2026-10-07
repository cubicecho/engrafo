/**
 * Reads a text object from the address the server signed for it.
 *
 * @param url - A presigned GET URL.
 * @returns The object's text.
 * @throws When storage cannot be reached or answers with anything but success. An expired
 *   signature is answered with an XML error body, which must not be mistaken for the text.
 */
export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (response.ok === false) {
    throw new Error(`Storage refused the download (HTTP ${response.status})`);
  }
  return response.text();
}
