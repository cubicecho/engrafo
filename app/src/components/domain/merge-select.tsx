import { useId } from 'react';
import { DocumentThumbnail } from '@/components/domain/document-thumbnail';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { isMergeable, type MergeCandidate } from '@/lib/merge';

/** The documents page's merge selection, as a list of results reads and changes it. */
export interface MergeSelection {
  selectedIds: ReadonlySet<string>;
  /** Checks or unchecks a document: checked ones are added at the end, which is the page order. */
  onToggle: (candidate: MergeCandidate) => void;
  /** Picks or unpicks several at once, in the order given: "Select all" over the rows shown. */
  onSetMany: (candidates: readonly MergeCandidate[], picked: boolean) => void;
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

interface MergeSelectAllProps {
  /** The rows the list is showing, in its order. */
  documents: readonly MergeCandidate[];
  /** Left out when this server cannot merge, and then there is nothing to draw. */
  selection?: MergeSelection | undefined;
}

/**
 * "Select all" over a list of results, lined up with the rows' own boxes. It covers the rows
 * shown — a filtered list's later pages are not loaded, so are not picked — and only the ones
 * with pages. Checked when every one is picked, mixed when some are; pressed while mixed, it picks
 * the rest, so the picks already made keep their order and the rest follow in the list's order.
 */
export function MergeSelectAll({ documents, selection }: MergeSelectAllProps) {
  const id = useId();
  const mergeable = documents.filter((doc) => isMergeable(doc.mimeType));
  if (selection === undefined || mergeable.length === 0) {
    return null;
  }
  const picked = mergeable.filter((doc) => selection.selectedIds.has(doc.id)).length;
  const all = picked === mergeable.length;
  const skipped = documents.length - mergeable.length;
  return (
    <div className="flex items-center gap-3 px-3">
      <Checkbox
        id={id}
        checked={all ? true : picked > 0 ? 'indeterminate' : false}
        onCheckedChange={() => selection.onSetMany(mergeable, all === false)}
      />
      <Label htmlFor={id}>{`Select all ${mergeable.length} shown`}</Label>
      {skipped > 0 && <span className="text-foreground/60 text-xs">{`${skipped} without pages left out`}</span>}
    </div>
  );
}
