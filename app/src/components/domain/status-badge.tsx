import { DocumentStatusEnum, StepStatusEnum } from '@/__generated__/graphql';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

type Status = { label: string; tone: BadgeVariant };

// Keyed by the generated enums, so a status added to the schema is a type error
// here until it has a label.
const DOCUMENT: Readonly<Record<DocumentStatusEnum, Status>> = {
  [DocumentStatusEnum.PendingUpload]: { label: 'Uploading', tone: 'outline' },
  [DocumentStatusEnum.Uploaded]: { label: 'Queued', tone: 'secondary' },
  [DocumentStatusEnum.Processing]: { label: 'Processing', tone: 'info' },
  [DocumentStatusEnum.Ready]: { label: 'Ready', tone: 'positive' },
  [DocumentStatusEnum.Failed]: { label: 'Failed', tone: 'destructive' },
};

const STEP: Readonly<Record<StepStatusEnum, Status>> = {
  [StepStatusEnum.Queued]: { label: 'Queued', tone: 'outline' },
  [StepStatusEnum.Running]: { label: 'Running', tone: 'info' },
  [StepStatusEnum.Succeeded]: { label: 'Done', tone: 'positive' },
  [StepStatusEnum.Skipped]: { label: 'Skipped', tone: 'outline' },
  [StepStatusEnum.Failed]: { label: 'Failed', tone: 'destructive' },
};

// The types say every status is in its map. The server can be newer than this
// bundle, though, so the lookup still allows for a word it has never heard of
// and shows it as it came rather than crashing or drawing nothing.
function statusIn(known: Readonly<Record<string, Status | undefined>>, status: string): Status {
  return known[status] ?? { label: status, tone: 'outline' };
}

interface StatusBadgeProps {
  /** The status as the server sent it. A word neither map knows is shown as it came. */
  status: string;
}

/** A document's status as a word and a colour: "Queued" rather than `uploaded`. */
export function DocumentStatusBadge({ status }: StatusBadgeProps) {
  const { label, tone } = statusIn(DOCUMENT, status);
  return <Badge variant={tone}>{label}</Badge>;
}

/** A pipeline step's status as a word and a colour. */
export function StepStatusBadge({ status }: StatusBadgeProps) {
  const { label, tone } = statusIn(STEP, status);
  return <Badge variant={tone}>{label}</Badge>;
}

/**
 * Whether the server is still working through a document, which is when a page
 * showing it should poll.
 *
 * @param status - The document's status.
 * @returns True while the document is queued or being processed.
 */
export function isInProgress(status: string): boolean {
  return status === DocumentStatusEnum.Uploaded || status === DocumentStatusEnum.Processing;
}
