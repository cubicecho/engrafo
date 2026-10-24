import { useState } from 'react';
import { BookOpen, FileCode, FileImage, FileSpreadsheet } from '@/components/domain/app-icons';
import { File, FileText } from '@/components/ui/icons';
import { type DocumentIconKind, documentIconKind } from '@/lib/thumbnails';
import { cn } from '@/lib/utils';

const ICONS: Record<DocumentIconKind, typeof File> = {
  pdf: File,
  image: FileImage,
  text: FileText,
  markup: FileCode,
  table: FileSpreadsheet,
  ebook: BookOpen,
};

interface DocumentThumbnailProps {
  /** The presigned thumbnail URL, or undefined for a document with none (or none yet). */
  url?: string | undefined;
  /** The document's type, which picks the icon drawn without a thumbnail. */
  mimeType: string;
  className?: string | undefined;
}

/**
 * A list row's picture of its document: the first page, the image or the book's cover, else an
 * icon for its type. Decorative — the row's title says what it is — so it has no alt text.
 *
 * Loaded lazily, so a long list fetches only what is scrolled to. An image that fails, such as
 * one whose URL expired while the list sat open, falls back to the icon rather than a broken one.
 */
export function DocumentThumbnail({ url, mimeType, className }: DocumentThumbnailProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const Icon = ICONS[documentIconKind(mimeType)];
  const showImage = url !== undefined && url !== failedUrl;

  return (
    <span
      className={cn(
        'flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-foreground/10 bg-secondary',
        className,
      )}
      data-testid="document-thumbnail"
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Icon className="size-4 text-foreground/60" aria-hidden />
      )}
    </span>
  );
}
