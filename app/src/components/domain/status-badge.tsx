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

export function DocumentStatusBadge({ status }: { status: string }) {
  const { label, tone } = statusIn(DOCUMENT, status);
  return <Badge variant={tone}>{label}</Badge>;
}

export function StepStatusBadge({ status }: { status: string }) {
  const { label, tone } = statusIn(STEP, status);
  return <Badge variant={tone}>{label}</Badge>;
}

/** Statuses the server is still working through, which a page should poll while it shows. */
export function isInProgress(status: string): boolean {
  return status === DocumentStatusEnum.Uploaded || status === DocumentStatusEnum.Processing;
}
