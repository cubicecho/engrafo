import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { HTML_MIME_TYPE, hasNoMagicBytes, isAcceptedMimeType, XML_MIME_TYPE } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

// file-type needs at most this many leading bytes to recognise any format it knows.
const SNIFF_BYTES = 4100;

/**
 * Reads the stored object once: its sha256, and its real type from magic bytes.
 *
 * The browser's type is a guess from the file extension, and the next step
 * decides whether to hand the file to ocrmypdf based on it — so the bytes win
 * when they disagree. Text, Markdown, CSV and HTML have no magic bytes, which is why
 * "no match" is only accepted when the upload also said one of them.
 */
export const inspectStep: PipelineStep = {
  name: 'inspect',
  enabled: () => true,
  async run({ doc, storage }) {
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let headLength = 0;

    for await (const chunk of await storage.files.getStream(doc.originalKey)) {
      const buffer: Buffer = chunk;
      hash.update(buffer);
      if (headLength < SNIFF_BYTES) {
        head.push(buffer);
        headLength += buffer.length;
      }
    }

    const sniffed = await fileTypeFromBuffer(Buffer.concat(head).subarray(0, SNIFF_BYTES));
    // XHTML may open with an XML declaration, which is all file-type sees of it. Any XML that
    // claims to be a web page is read as one: the walker is lenient, and markup is markup.
    const isXhtml = sniffed?.mime === XML_MIME_TYPE && doc.mimeType === HTML_MIME_TYPE;
    const mimeType = sniffed && isXhtml === false ? sniffed.mime : hasNoMagicBytes(doc.mimeType) ? doc.mimeType : null;
    const isUnsupported = !mimeType || isAcceptedMimeType(mimeType) === false;
    if (isUnsupported) {
      throw new Error(`Unsupported file type${sniffed ? ` (${sniffed.mime})` : ''}.`);
    }

    return { checksumSha256: hash.digest('hex'), mimeType };
  },
};
