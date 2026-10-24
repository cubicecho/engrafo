import { FieldSourceEnum as FieldSource } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Pencil, Plus, Undo2 } from '@/components/ui/icons';
import { formatMoney } from '@/lib/money';

/** A document's receipt fields, as the server holds them. */
export interface ReceiptValues {
  vendor: string | null;
  /** An exact decimal string, `12.50`. */
  total: string | null;
  /** ISO 4217. */
  currency: string | null;
}

interface DocumentReceiptCardProps extends ReceiptValues {
  /** Who filled them in: read from the text, or the user. Null while neither has. */
  source: FieldSource | null;
  /** Opens the receipt's edit dialog. */
  onEdit: () => void;
  /** Hands the receipt back to be read from the text again. Offered only while it is the user's. */
  onReset: () => void;
}

/**
 * A receipt's vendor and total, with where they came from. Most documents are not receipts, so
 * one with nothing filled in is a single line and a button to add them, not a card of dashes.
 * The date is the document's, in the details card, rather than a second copy here.
 */
export function DocumentReceiptCard({ vendor, total, currency, source, onEdit, onReset }: DocumentReceiptCardProps) {
  const isEmpty = vendor === null && total === null && currency === null;
  const edit = (
    <Button
      size="sm"
      variant="outline"
      iconSlot={isEmpty ? <Plus /> : <Pencil />}
      content={isEmpty ? 'Add' : 'Edit'}
      aria-label={isEmpty ? 'Add receipt details' : 'Edit receipt details'}
      onClick={onEdit}
    />
  );

  return (
    <CardLayout
      level={2}
      title="Receipt"
      description={
        source === FieldSource.Extracted
          ? 'Read from the text. Check it before you rely on it.'
          : source === FieldSource.User
            ? 'Set by you.'
            : undefined
      }
      actionSlot={
        <>
          {source === FieldSource.User && (
            <ConfirmButton
              size="sm"
              variant="ghost"
              iconSlot={<Undo2 />}
              content="Reset"
              aria-label="Reset receipt details to automatic"
              hint="Reset to automatic"
              title="Read the receipt from the text again?"
              description="The vendor, total and currency you set are replaced by what is read from the document's text, which may be nothing, and processing again reads them afresh."
              confirmLabel="Reset"
              onConfirm={onReset}
            />
          )}
          {edit}
        </>
      }
      contentSlot={
        isEmpty ? (
          <EmptyState compact title="Not a receipt, or nothing was read from it." />
        ) : (
          <DescriptionList
            contentSlot={
              <>
                <PropertyRow label="Vendor" value={vendor ?? '—'} />
                <PropertyRow label="Total" value={total === null ? '—' : formatMoney(total, currency)} />
                {total === null && <PropertyRow label="Currency" value={currency ?? '—'} />}
              </>
            }
          />
        )
      }
    />
  );
}
