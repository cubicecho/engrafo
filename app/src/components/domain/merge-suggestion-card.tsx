import { Link } from 'react-router';
import { graphql } from '@/__generated__';
import { MergeSuggestionBand, type MergeSuggestionCardFragment } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { DocumentThumbnail } from '@/components/domain/document-thumbnail';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { SectionHeading } from '@/components/section-heading';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/components/ui/badge-base';
import { Button } from '@/components/ui/button';
import { Check, Layers, Sparkles, X } from '@/components/ui/icons';
import { TOP_LEVEL_LABEL } from '@/lib/folder-tree';
import { formatBytes, joinStats } from '@/lib/format';
import { mergeTypeLabel } from '@/lib/merge';
import { bandLabel, modelSummary, type Reason, ruleReasons } from '@/lib/merge-suggestions';
import { documentPath } from '@/lib/routes';

// What a card draws, and what the merge dialog it opens is filled from.
export const MergeSuggestionCardFields = graphql(`
  fragment MergeSuggestionCard on MergeSuggestion {
    id
    confidence
    heuristicConfidence
    band
    reasons {
      signal
      text
      points
    }
    verdicts {
      fromId
      toId
      continues
      reason
    }
    documents {
      id
      title
      folderId
      mimeType
      sizeBytes
      archiveKey
    }
  }
`);

/** A soft badge per band: the words say which, the hue only repeats it. */
const BAND_VARIANTS: Record<MergeSuggestionBand, BadgeVariant> = {
  [MergeSuggestionBand.High]: 'positive-soft',
  [MergeSuggestionBand.Medium]: 'info-soft',
  [MergeSuggestionBand.Low]: 'warning-soft',
};

interface ReasonListProps {
  title: string;
  reasons: readonly Reason[];
  /** Says the side as a mark as well as a word: a tick for, a cross against. */
  side: 'for' | 'against';
}

/**
 * One side of the case, under a heading that names it, so neither depends on colour. A heading
 * and a list rather than a `Section`: a section is a landmark, and every card on the page has a
 * "For", so they would be landmarks of one name.
 */
function ReasonList({ title, reasons, side }: ReasonListProps) {
  if (reasons.length === 0) {
    return null;
  }
  const Mark = side === 'for' ? Check : X;
  return (
    <div className="grid content-start gap-1">
      <SectionHeading title={title} level={3} variant="overline" />
      <List
        label={title}
        divided={false}
        contentSlot={reasons.map((reason) => (
          <ListItem
            key={`${reason.signal}:${reason.text}`}
            leadingSlot={
              <Mark aria-hidden className={side === 'for' ? 'size-4 text-positive' : 'size-4 text-negative'} />
            }
            title={reason.text}
          />
        ))}
      />
    </div>
  );
}

interface MergeSuggestionCardProps {
  suggestion: MergeSuggestionCardFragment;
  /** Every folder's path by id, for where each document is filed. */
  folderPaths: ReadonlyMap<string, string>;
  /** First-page pictures by document id, asked for once for every card on the page. */
  thumbnails: ReadonlyMap<string, string>;
  /** `serverConfig.mergeAvailable`: without it there is nothing to review into. */
  mergeAvailable: boolean;
  dismissing?: boolean | undefined;
  onReview: () => void;
  onDismiss: () => void;
}

/**
 * One suggested merge: its documents in the order their pages would go, each a link to its page;
 * how sure, as a band and a percentage; the rules' reasons for and against, the strongest first;
 * and the model's part, when it checked. Review merge opens the merge dialog filled in; Dismiss
 * says not to suggest this set again.
 */
export function MergeSuggestionCard({
  suggestion,
  folderPaths,
  thumbnails,
  mergeAvailable,
  dismissing = false,
  onReview,
  onDismiss,
}: MergeSuggestionCardProps) {
  const [first, ...rest] = suggestion.documents;
  const { supporting, opposing } = ruleReasons(suggestion.reasons);
  const model = modelSummary(suggestion.heuristicConfidence, suggestion.verdicts);
  const title =
    first === undefined
      ? 'Suggested merge'
      : rest.length === 0
        ? first.title
        : `${first.title} and ${rest.length} more`;

  return (
    <CardLayout
      iconSlot={<Layers />}
      title={title}
      level={2}
      actionSlot={
        <Badge variant={BAND_VARIANTS[suggestion.band]}>{bandLabel(suggestion.band, suggestion.confidence)}</Badge>
      }
      contentSlot={
        <div className="grid gap-4">
          <List
            label={`Documents of “${title}”, in page order`}
            contentSlot={suggestion.documents.map((doc, index) => (
              <ListItem
                key={doc.id}
                leadingSlot={
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-right text-foreground/60 text-sm tabular-nums">{index + 1}</span>
                    <DocumentThumbnail url={thumbnails.get(doc.id)} mimeType={doc.mimeType} />
                  </div>
                }
                title={doc.title}
                description={joinStats(
                  doc.folderId === null ? TOP_LEVEL_LABEL : (folderPaths.get(doc.folderId) ?? TOP_LEVEL_LABEL),
                  mergeTypeLabel(doc.mimeType),
                  formatBytes(doc.sizeBytes),
                )}
                linkSlot={<Link to={documentPath(doc.id)} />}
              />
            ))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ReasonList title="For" reasons={supporting} side="for" />
            <ReasonList title="Against" reasons={opposing} side="against" />
          </div>
          {model && (
            <p className="flex items-center gap-2 text-foreground/60 text-sm">
              <Sparkles aria-hidden className="size-4 shrink-0" />
              <span>{model}</span>
            </p>
          )}
        </div>
      }
      footerActionsSlot={
        <>
          <Button
            variant="outline"
            iconSlot={<X />}
            content="Dismiss"
            loading={dismissing}
            loadingLabel="Dismissing…"
            hint="Do not suggest these documents together again"
            onClick={onDismiss}
          />
          <Button
            iconSlot={<Layers />}
            content="Review merge"
            disabled={mergeAvailable === false}
            hint={mergeAvailable ? undefined : 'Merging is not available on this server'}
            onClick={onReview}
          />
        </>
      }
    />
  );
}
