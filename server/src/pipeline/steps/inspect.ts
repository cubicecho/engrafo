import { createHash } from 'node:crypto';
import { isAcceptedMimeType, SNIFF_BYTES, sniffMimeType } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

/**
 * Reads the stored object once: its sha256, and its real type from magic bytes.
 *
 * The browser's type is a guess from the file extension, and the next step
 * decides whether to hand the file to ocrmypdf based on it — so the bytes win
 * when they disagree. Plain text and Markdown have no magic bytes, which is why
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

    const mimeType = await sniffMimeType(Buffer.concat(head), doc.mimeType);
    if (mimeType === null || isAcceptedMimeType(mimeType) === false) {
      throw new Error(`Unsupported file type${mimeType ? ` (${mimeType})` : ''}.`);
    }

    return { checksumSha256: hash.digest('hex'), mimeType };
  },
};
