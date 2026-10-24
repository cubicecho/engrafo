import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from '../../core/errors.ts';
import { thumbnailKey } from '../../storage/s3.ts';
import { readEpubCover } from '../epub.ts';
import {
  renderPdfThumbnail,
  resizeImageThumbnail,
  THUMBNAIL_MIME_TYPE,
  type ThumbnailSource,
  thumbnailSource,
} from '../thumbnail.ts';
import type { PipelineStep, StepContext } from '../types.ts';

/**
 * Draws the thumbnail into the run's tmpDir.
 *
 * @returns The JPEG's path, or null when there is nothing to draw (a book with no cover).
 */
async function draw({ storage, tmpDir }: StepContext, source: ThumbnailSource): Promise<string | null> {
  const input = join(tmpDir, 'thumbnail-source');
  const output = join(tmpDir, 'thumbnail.jpg');
  await storage.files.download(source.key, input);
  switch (source.render) {
    case 'pdf':
      return renderPdfThumbnail(input, join(tmpDir, 'thumbnail-page'));
    case 'image':
      await resizeImageThumbnail(input, output);
      return output;
    case 'epub': {
      const cover = await readEpubCover(input);
      if (cover === null) {
        return null;
      }
      const coverFile = join(tmpDir, 'thumbnail-cover');
      await writeFile(coverFile, cover);
      await resizeImageThumbnail(coverFile, output);
      return output;
    }
  }
}

/**
 * A small JPEG of the first page, an image or an ebook's cover, beside the archive in the files
 * bucket, for the rows of a list.
 *
 * Last in `STEPS`: it produces no text, so no step after it reads anything it writes, and a
 * finished document reaches it through `catchUp()`. It never fails a document: a picture in a
 * list is not worth a document marked failed and waiting on a person, so a render that goes wrong
 * is a `[thumbnail]` line and no key. A host without pdftoppm or Pillow skips it instead.
 */
export const thumbnailStep: PipelineStep = {
  name: 'thumbnail',
  enabled: (doc, config) => thumbnailSource(doc, config.thumbnailTools) !== null,
  async run(context) {
    const { doc, storage, config } = context;
    const source = thumbnailSource(doc, config.thumbnailTools);
    if (source === null) {
      return { thumbnailKey: null };
    }
    try {
      const drawn = await draw(context, source);
      if (drawn === null) {
        return { thumbnailKey: null };
      }
      const key = thumbnailKey(doc.userId, doc.id);
      await storage.files.putFile(key, drawn, THUMBNAIL_MIME_TYPE);
      return { thumbnailKey: key };
    } catch (error) {
      console.warn(`[thumbnail] ${doc.id}: ${errorMessage(error)}`);
      return { thumbnailKey: null };
    }
  },
};
