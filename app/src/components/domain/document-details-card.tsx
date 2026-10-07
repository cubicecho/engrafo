import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { CopyButton } from '@/components/ui/copy-button';
import { formatAgo, formatDate } from '@/lib/format';

interface DocumentDetailsCardProps {
  /** When the document was uploaded, as an ISO timestamp. */
  createdAt: string;
  /** The upload's SHA-256, which the server only knows once the pipeline has inspected the file. */
  checksumSha256: string | null;
}

/** The facts about a document that are not its content: when it arrived and what it hashes to. */
export function DocumentDetailsCard({ createdAt, checksumSha256 }: DocumentDetailsCardProps) {
  return (
    <CardLayout
      level={2}
      title="Details"
      contentSlot={
        <DescriptionList
          contentSlot={
            <>
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
