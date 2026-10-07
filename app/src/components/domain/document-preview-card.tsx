import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { DocumentFileUrl } from './document-file';

interface DocumentPreviewCardProps {
  /** The document to preview. A new object is a new answer from the server, and asks for a fresh URL. */
  doc: { id: string; mimeType: string; archiveKey: string | null };
}

/**
 * A document's file in a frame: the searchable PDF once OCR has produced one, the upload before.
 * Draws nothing for plain text, which the text card already shows, and nothing until the
 * presigned URL has arrived.
 */
export function DocumentPreviewCard({ doc }: DocumentPreviewCardProps) {
  const client = useApolloClient();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Presigned and short-lived, so it is fetched when the page settles rather
  // than cached with the document. The archive is the searchable PDF; before
  // OCR has run there is only the original.
  const variant = doc.archiveKey ? DocumentFileVariant.Archive : DocumentFileVariant.Original;
  const previewable = doc.mimeType !== 'text/plain';
  useEffect(() => {
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
          setPreviewUrl(data.documentFileUrl);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, doc, previewable, variant]);

  if (!previewUrl) {
    return null;
  }

  return (
    <CardLayout
      level={2}
      title="Preview"
      description={variant === 'ARCHIVE' ? 'The searchable PDF produced by OCR.' : 'The uploaded file.'}
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
