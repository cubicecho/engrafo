import { DocumentThumbnail } from '@/components/domain/document-thumbnail';
import { Checkbox } from '@/components/ui/checkbox';
import { isMergeable, type MergeCandidate } from '@/lib/merge';

/** The documents page's merge selection, as a list of results reads and changes it. */
export interface MergeSelection {
  selectedIds: ReadonlySet<string>;
  /** Checks or unchecks a document: checked ones are added at the end, which is the page order. */
  onToggle: (candidate: MergeCandidate) => void;
}

interface MergeSelectLeadingProps {
  document: MergeCandidate;
  thumbnailUrl: string | undefined;
  /** Left out when this server cannot merge: the row is the thumbnail alone, as it was. */
  selection?: MergeSelection | undefined;
}

/**
 * A result row's start: the box that picks it to merge, then its thumbnail. In `leadingSlot`,
 * which is outside the row's pressed area, so checking the box does not open the document.
 *
 * A text, Markdown, CSV, HTML or EPUB document has no pages, so its box is drawn but disabled,
 * and says why, rather than missing from one row in a column of them.
 */
export function MergeSelectLeading({ document, thumbnailUrl, selection }: MergeSelectLeadingProps) {
  const thumbnail = <DocumentThumbnail url={thumbnailUrl} mimeType={document.mimeType} />;
  if (selection === undefined) {
    return thumbnail;
  }
  const mergeable = isMergeable(document.mimeType);
  return (
    <div className="flex items-center gap-3">
      <Checkbox
        aria-label={
          mergeable ? `Select “${document.title}” to merge` : `“${document.title}” cannot be merged: it has no pages`
        }
        checked={mergeable && selection.selectedIds.has(document.id)}
        disabled={mergeable === false}
        onCheckedChange={() => selection.onToggle(document)}
      />
      {thumbnail}
    </div>
  );
}
