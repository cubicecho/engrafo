import { Badge, type BadgeVariant } from '@/components/ui/badge';

type Status = { label: string; tone: BadgeVariant };

const DOCUMENT: Record<string, Status> = {
  pending_upload: { label: 'Uploading', tone: 'outline' },
  uploaded: { label: 'Queued', tone: 'secondary' },
  processing: { label: 'Processing', tone: 'info' },
  ready: { label: 'Ready', tone: 'positive' },
  failed: { label: 'Failed', tone: 'destructive' },
};

const STEP: Record<string, Status> = {
  queued: { label: 'Queued', tone: 'outline' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Done', tone: 'positive' },
  skipped: { label: 'Skipped', tone: 'outline' },
  failed: { label: 'Failed', tone: 'destructive' },
};

export function DocumentStatusBadge({ status }: { status: string }) {
  const { label, tone } = DOCUMENT[status] ?? { label: status, tone: 'outline' };
  return <Badge variant={tone}>{label}</Badge>;
}

export function StepStatusBadge({ status }: { status: string }) {
  const { label, tone } = STEP[status] ?? { label: status, tone: 'outline' };
  return <Badge variant={tone}>{label}</Badge>;
}

/** Statuses the server is still working through, which a page should poll while it shows. */
export function isInProgress(status: string): boolean {
  return status === 'uploaded' || status === 'processing';
}
