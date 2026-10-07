import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Download } from '@/components/ui/icons';
import { TEXT_PREVIEW_DEFAULTS } from '@/defaults';
import { fetchText } from '@/lib/fetch-text';
import { formatBytes, joinStats } from '@/lib/format';
import { DocumentFileUrl } from './document-file';

/**
 * The body of the text card, once it has stopped loading.
 *
 * Four answers, and each has to be its own sentence: text over the preview
 * limit is never fetched, text that came back empty is not "too large", and
 * text that could not be fetched is neither.
 */
function ExtractedText({ content, oversize, failed }: { content: string | null; oversize: boolean; failed: boolean }) {
  if (failed) {
    return (
      <Alert
        variant="destructive"
        title="Could not load the text"
        description="Storage did not return it. Reload the page to try again, or download it instead."
      />
    );
  }
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
  const [failed, setFailed] = useState(false);

  const contentKey = doc.contentKey;
  const contentBytes = doc.contentBytes ?? 0;
  // The text is an object in its own bucket, so the page fetches it rather than
  // receiving it with the document. Past the limit, showing it in the browser
  // helps nobody — the download link stands in for it.
  const contentOversize = contentBytes > TEXT_PREVIEW_DEFAULTS.maxBytes;
  useEffect(() => {
    setFailed(false);
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
      .then(({ data }) => {
        if (!data) {
          throw new Error('The server returned no address for the text');
        }
        return fetchText(data.documentFileUrl);
      })
      .then((text) => {
        if (current) {
          setContent(text);
        }
      })
      // Said on the card: left unsaid, the card sits on its skeleton for good.
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });
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
      loading={!contentOversize && content === null && !failed}
      footerActionsSlot={
        <Button variant="outline" iconSlot={<Download />} content="Download text" onClick={onDownload} />
      }
      contentSlot={<ExtractedText content={content} oversize={contentOversize} failed={failed} />}
    />
  );
}
