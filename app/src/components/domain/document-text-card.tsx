import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Download } from '@/components/ui/icons';
import { formatBytes, joinStats } from '@/lib/format';
import { DocumentFileUrl } from './document-file';

// The text is an object in its own bucket, so the page fetches it rather than
// receiving it with the document. Past this much, showing it in the browser
// helps nobody — the download link stands in for it.
const TEXT_PREVIEW_BYTES = 512 * 1024;

/**
 * The body of the text card, once it has stopped loading.
 *
 * Three answers, and each has to be its own sentence: text over the preview
 * limit is never fetched, and text that came back empty is not "too large".
 */
function ExtractedText({ content, oversize }: { content: string | null; oversize: boolean }) {
  if (oversize) {
    return <p className="text-foreground/60 text-sm">Too large to show here.</p>;
  }
  if (!content) {
    return <p className="text-foreground/60 text-sm">No text was extracted from this document.</p>;
  }
  return (
    <CodeBlock content={content} wrap maxHeight="lg" actionSlot={<CopyButton value={content} label="Copy text" />} />
  );
}

interface DocumentTextCardProps {
  /** The document whose text to show. A new object is a new answer from the server, and fetches again. */
  doc: { id: string; contentKey: string | null; contentBytes: number | null };
  /** Called when the reader asks for the text as a file. */
  onDownload: () => void;
}

/**
 * What the pipeline extracted from a document, fetched from the text bucket over a presigned
 * URL. Draws nothing when no text was stored, and offers only the download past the preview
 * limit.
 */
export function DocumentTextCard({ doc, onDownload }: DocumentTextCardProps) {
  const client = useApolloClient();
  const [content, setContent] = useState<string | null>(null);

  const contentKey = doc.contentKey;
  const contentBytes = doc.contentBytes ?? 0;
  const contentOversize = contentBytes > TEXT_PREVIEW_BYTES;
  useEffect(() => {
    if (!contentKey || contentOversize) {
      setContent(null);
      return;
    }
    let current = true;
    client
      .query({
        query: DocumentFileUrl,
        variables: { id: doc.id, variant: DocumentFileVariant.Text, download: false },
        fetchPolicy: 'network-only',
      })
      .then(({ data }) => (data ? fetch(data.documentFileUrl) : null))
      .then((response) => response?.text())
      .then((text) => {
        if (current && text !== undefined) {
          setContent(text);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, doc, contentKey, contentOversize]);

  if (!contentKey) {
    return null;
  }

  return (
    <CardLayout
      level={2}
      title="Text"
      description={joinStats('What the pipeline extracted', formatBytes(contentBytes))}
      loading={!contentOversize && content === null}
      footerActionsSlot={
        <Button variant="outline" iconSlot={<Download />} content="Download text" onClick={onDownload} />
      }
      contentSlot={<ExtractedText content={content} oversize={contentOversize} />}
    />
  );
}
