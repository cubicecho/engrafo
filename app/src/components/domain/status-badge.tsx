import { Badge } from '@/components/ui/badge';

type Tone = 'default' | 'secondary' | 'destructive' | 'outline';

const DOCUMENT: Record<string, { label: string; tone: Tone }> = {
  pending_upload: { label: 'Uploading', tone: 'outline' },
  uploaded: { label: 'Queued', tone: 'secondary' },
  processing: { label: 'Processing', tone: 'secondary' },
  ready: { label: 'Ready', tone: 'default' },
  failed: { label: 'Failed', tone: 'destructive' },
};

const STEP: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'outline' },
  running: { label: 'Running', tone: 'secondary' },
  succeeded: { label: 'Done', tone: 'default' },
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
