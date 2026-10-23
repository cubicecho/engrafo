import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Alert } from '@/components/ui/alert';
import { DocumentFileUrl } from './document-file';

// Plain text, Markdown and CSV get no frame of their own: the text card already
// shows them, and a frame pointed at a CSV only starts a download. Nor does an
// ebook, for the same reason. Its text card shows the book's text.
//
// Nor does a web page, and that one is about safety. The presigned URL is on
// the bucket's origin, not the app's, so the page's scripts could not reach the
// session token in this origin's storage — but nothing makes a self-hoster put
// the bucket on another origin, and behind one reverse proxy it is this one. A
// sandbox with neither allow-scripts nor allow-same-origin would hold either
// way, yet it still lets the page fetch its images, fonts and tracking pixels
// from wherever it names, so opening a saved receipt would tell the shop. The
// text card shows what the page said, and the download button has the file.
const NOT_PREVIEWABLE = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/epub+zip']);

/**
 * Whether a document of this type gets a preview frame at all, so a page can leave out the place
 * one would go.
 *
 * @param mimeType - The document's type.
 * @returns False for text, Markdown, CSV, a web page and an ebook.
 */
export function isPreviewable(mimeType: string): boolean {
  return NOT_PREVIEWABLE.has(mimeType) === false;
}

interface DocumentPreviewCardProps {
  /** The document to preview. A new object is a new answer from the server, and asks for a fresh URL. */
  doc: { id: string; mimeType: string; archiveKey: string | null };
}

/**
 * A document's file in a frame: the searchable PDF once OCR has produced one, the upload before.
 * Draws nothing for plain text, Markdown, CSV, a web page or an ebook, which the text card
 * already shows, and a loading card until the presigned URL has arrived — or has failed to, which it says.
 */
export function DocumentPreviewCard({ doc }: DocumentPreviewCardProps) {
  const client = useApolloClient();
  // Kept with what it is a URL *for*: when the archive replaces the original, or the route moves
  // to another document, the old frame must not stay up while the new address is fetched.
  const [preview, setPreview] = useState<{ id: string; variant: DocumentFileVariant; url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // Presigned and short-lived, so it is fetched when the page settles rather
  // than cached with the document. The archive is the searchable PDF; before
  // OCR has run there is only the original.
  const variant = doc.archiveKey ? DocumentFileVariant.Archive : DocumentFileVariant.Original;
  const previewable = isPreviewable(doc.mimeType);
  useEffect(() => {
    setFailed(false);
    if (!previewable) {
      return;
    }
    let current = true;
    client
      .query({
        query: DocumentFileUrl,
        variables: { id: doc.id, variant, download: false },
        fetchPolicy: 'network-only',
      })
      .then(({ data }) => {
        if (current && data) {
          setPreview({ id: doc.id, variant, url: data.documentFileUrl });
        }
      })
      // Said on the card: left unsaid, a failure looks like a document with no preview.
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [client, doc, previewable, variant]);

  const isCurrent = previewable && preview?.id === doc.id && preview.variant === variant;
  const previewUrl = isCurrent ? preview.url : null;

  if (previewable && failed && previewUrl === null) {
    return (
      <CardLayout
        level={2}
        title="Preview"
        contentSlot={
          <Alert
            variant="destructive"
            title="Could not load the preview"
            description="The server did not return an address for the file. Reload the page to try again."
          />
        }
      />
    );
  }

  if (!previewable) {
    return null;
  }

  // A card waiting for its address, rather than nothing: on the document page the preview is a
  // tab of its own, and an empty tab reads as a document with no preview.
  if (!previewUrl) {
    return <CardLayout level={2} title="Preview" loading />;
  }

  return (
    <CardLayout
      level={2}
      title="Preview"
      description={
        variant === DocumentFileVariant.Archive ? 'The searchable PDF produced by OCR.' : 'The uploaded file.'
      }
      contentSlot={
        <iframe
          title="Document preview"
          src={previewUrl}
          className="h-[36rem] w-full rounded-md border border-foreground/10"
        />
      }
    />
  );
}
