import { FieldSourceEnum as FieldSource } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Pencil, Undo2 } from '@/components/ui/icons';
import { formatCalendarDay } from '@/lib/calendar-day';
import { formatAgo, formatDate } from '@/lib/format';

interface DocumentDetailsCardProps {
  /** When the document was uploaded, as an ISO timestamp. */
  createdAt: string;
  /** The upload's SHA-256, which the server only knows once the pipeline has inspected the file. */
  checksumSha256: string | null;
  /** The date on the document, `YYYY-MM-DD`, when there is one. */
  documentDate: string | null;
  /** Who gave it that date: read from its text, or set by the user. Null while neither has. */
  documentDateSource: FieldSource | null;
  /** Opens the date's edit dialog. */
  onEditDate: () => void;
  /** Hands the date back to be read from the text again. Offered only while the date is the user's. */
  onResetDate: () => void;
}

/** Where a document's date came from, said under it, so a wrong one reads as a guess to correct. */
function dateHint(source: FieldSource | null): string | undefined {
  if (source === FieldSource.Extracted) {
    return 'Read from the text';
  }
  if (source === FieldSource.User) {
    return 'Set by you';
  }
  return undefined;
}

/**
 * The facts about a document that are not its content: the date on it, when it arrived and what
 * it hashes to.
 */
export function DocumentDetailsCard({
  createdAt,
  checksumSha256,
  documentDate,
  documentDateSource,
  onEditDate,
  onResetDate,
}: DocumentDetailsCardProps) {
  return (
    <CardLayout
      level={2}
      title="Details"
      contentSlot={
        <DescriptionList
          contentSlot={
            <>
              <PropertyRow
                label="Date"
                value={formatCalendarDay(documentDate) || '—'}
                hint={dateHint(documentDateSource)}
                actionSlot={
                  <>
                    {documentDateSource === FieldSource.User && (
                      <ConfirmButton
                        size="icon-sm"
                        variant="ghost"
                        iconSlot={<Undo2 />}
                        aria-label="Reset the document date to automatic"
                        hint="Reset to automatic"
                        title="Read the date from the text again?"
                        description="The date you set is replaced by the one read from the document's text, or none if it has none, and processing again reads it afresh."
                        confirmLabel="Reset"
                        onConfirm={onResetDate}
                      />
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      iconSlot={<Pencil />}
                      aria-label="Edit the document date"
                      hint="Edit the date"
                      onClick={onEditDate}
                    />
                  </>
                }
              />
              <PropertyRow label="Added" value={formatDate(createdAt)} hint={formatAgo(createdAt)} />
              <PropertyRow
                label="Checksum"
                value={checksumSha256 ?? '—'}
                valueClassName="font-mono text-xs break-all"
                actionSlot={checksumSha256 ? <CopyButton value={checksumSha256} label="Copy checksum" /> : null}
              />
            </>
          }
        />
      }
    />
  );
}
