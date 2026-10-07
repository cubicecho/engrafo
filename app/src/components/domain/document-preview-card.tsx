import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Alert } from '@/components/ui/alert';
import { DocumentFileUrl } from './document-file';

// Plain text gets no frame of its own: the text card already shows it.
const PLAIN_TEXT_MIME_TYPE = 'text/plain';

interface DocumentPreviewCardProps {
  /** The document to preview. A new object is a new answer from the server, and asks for a fresh URL. */
  doc: { id: string; mimeType: string; archiveKey: string | null };
}

/**
 * A document's file in a frame: the searchable PDF once OCR has produced one, the upload before.
 * Draws nothing for plain text, which the text card already shows, and nothing until the
 * presigned URL has arrived — or has failed to, which it says.
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
  const previewable = doc.mimeType !== PLAIN_TEXT_MIME_TYPE;
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

  if (!previewUrl) {
    return null;
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
