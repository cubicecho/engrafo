import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { isAcceptedMimeType } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

// file-type needs at most this many leading bytes to recognise any format it knows.
const SNIFF_BYTES = 4100;

/**
 * Reads the stored object once: its sha256, and its real type from magic bytes.
 *
 * The browser's type is a guess from the file extension, and the next step
 * decides whether to hand the file to ocrmypdf based on it — so the bytes win
 * when they disagree. Plain text has no magic bytes, which is why "no match" is
 * only accepted when the upload also said text/plain.
 */
export const inspectStep: PipelineStep = {
  name: 'inspect',
  enabled: () => true,
  async run({ doc, storage }) {
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let headLength = 0;

    for await (const chunk of await storage.files.getStream(doc.originalKey)) {
      const buffer = chunk as Buffer;
      hash.update(buffer);
      if (headLength < SNIFF_BYTES) {
        head.push(buffer);
        headLength += buffer.length;
      }
    }

    const sniffed = await fileTypeFromBuffer(Buffer.concat(head).subarray(0, SNIFF_BYTES));
    const mimeType = sniffed?.mime ?? (doc.mimeType === 'text/plain' ? 'text/plain' : null);
    if (!mimeType || !isAcceptedMimeType(mimeType)) {
      throw new Error(`Unsupported file type${sniffed ? ` (${sniffed.mime})` : ''}.`);
    }

    return { checksumSha256: hash.digest('hex'), mimeType };
  },
};
