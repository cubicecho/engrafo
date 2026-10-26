import { useApolloClient } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import type { Components } from 'react-markdown';
import { ContentFormatEnum, DocumentFileVariant } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Markdown } from '@/components/markdown';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Download } from '@/components/ui/icons';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { TEXT_PREVIEW_DEFAULTS } from '@/defaults';
import { fetchText } from '@/lib/fetch-text';
import { formatBytes, joinStats } from '@/lib/format';
import { DocumentFileUrl } from './document-file';

/** How the card draws the text: rendered as Markdown, or as the characters stored. */
export const TextView = { Formatted: 'formatted', Plain: 'plain' } as const;
/** One of `TextView`'s values. */
export type TextView = (typeof TextView)[keyof typeof TextView];

/**
 * An image in the text is said, never fetched. The text is the document's, and a Markdown upload
 * or a web page's text can point at any server: loading it would tell that server the document was
 * opened, which is why an HTML upload is never framed either.
 */
function ImageAlt({ alt }: { alt?: string | undefined }) {
  return <span className="text-foreground/60">[{alt || 'Image'}]</span>;
}

// Outside the render: a new map each time remounts the document.
const MARKDOWN_COMPONENTS: Components = { img: ({ alt }) => <ImageAlt alt={alt} /> };

/**
 * The body of the text card, once it has stopped loading.
 *
 * Four answers, and each has to be its own sentence: text over the preview
 * limit is never fetched, text that came back empty is not "too large", and
 * text that could not be fetched is neither.
 */
function ExtractedText({
  content,
  oversize,
  failed,
  view,
}: {
  content: string | null;
  oversize: boolean;
  failed: boolean;
  view: TextView;
}) {
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
  if (view === TextView.Formatted) {
    return (
      <div className="max-h-96 overflow-y-auto rounded-md border p-4">
        <Markdown content={content} components={MARKDOWN_COMPONENTS} />
      </div>
    );
  }
  return (
    <CodeBlock content={content} wrap maxHeight="lg" actionSlot={<CopyButton value={content} label="Copy text" />} />
  );
}

/** Where the card opens: formatted for text stored as Markdown, the characters for the rest. */
function defaultView(format: ContentFormatEnum | undefined): TextView {
  return format === ContentFormatEnum.Markdown ? TextView.Formatted : TextView.Plain;
}

interface DocumentTextCardProps {
  /** The document whose text to show. A new object is a new answer from the server, and fetches again. */
  doc: { id: string; contentKey: string | null; contentBytes: number | null; contentFormat?: ContentFormatEnum };
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
  const [view, setView] = useState<TextView>(defaultView(doc.contentFormat));

  // A poll hands a new object every time; only a different document, or text that is now written
  // another way (a read with the vision model), puts the view back to where that text opens. Reset
  // while rendering, as React suggests, rather than drawing the old view for a frame first.
  const viewFor = `${doc.id}:${doc.contentFormat ?? ''}`;
  const [shownFor, setShownFor] = useState(viewFor);
  if (shownFor !== viewFor) {
    setShownFor(viewFor);
    setView(defaultView(doc.contentFormat));
  }

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
      actionSlot={
        content ? (
          <>
            {view === TextView.Formatted ? <CopyButton value={content} label="Copy text" /> : null}
            <SegmentedGroup aria-label="Show the text" value={view} onValueChange={setView}>
              <SegmentedButton value={TextView.Formatted}>Formatted</SegmentedButton>
              <SegmentedButton value={TextView.Plain}>Plain</SegmentedButton>
            </SegmentedGroup>
          </>
        ) : null
      }
      footerActionsSlot={
        <Button variant="outline" iconSlot={<Download />} content="Download text" onClick={onDownload} />
      }
      contentSlot={<ExtractedText content={content} oversize={contentOversize} failed={failed} view={view} />}
    />
  );
}
