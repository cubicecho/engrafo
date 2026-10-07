import type { StepStatusEnum } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { StepStatusBadge } from '@/components/domain/status-badge';
import { ListItem } from '@/components/list-item';
import { formatAgo, joinStats } from '@/lib/format';

/** One row of `processing_steps`, as the detail query selects it. */
export interface PipelineStep {
  id: string;
  /** The step's name in the pipeline: `inspect`, `text`, `ocr`. */
  step: string;
  status: StepStatusEnum;
  /** How many times the step has run. Shown only once it is more than one. */
  attempts: number;
  /** Why the step failed, when it did. */
  error: string | null;
  finishedAt: string | null;
}

interface DocumentPipelineCardProps {
  /** Whether the upload asked for OCR, which is the card's one line of description. */
  ocrRequested: boolean;
  /** The steps in the order the pipeline runs them. */
  steps: readonly PipelineStep[];
}

/** How far the pipeline got with a document: one row per step, with its status and what went wrong. */
export function DocumentPipelineCard({ ocrRequested, steps }: DocumentPipelineCardProps) {
  return (
    <CardLayout
      level={2}
      title="Pipeline"
      description={ocrRequested ? 'OCR was requested for this document.' : 'Uploaded without OCR.'}
      contentSlot={
        <ul className="flex flex-col">
          {steps.map((step) => (
            <li key={step.id}>
              <ListItem
                className="px-0"
                title={step.step}
                description={joinStats(
                  step.error,
                  step.attempts > 1 && `${step.attempts} attempts`,
                  step.finishedAt && formatAgo(step.finishedAt),
                )}
                meta={<StepStatusBadge status={step.status} />}
              />
            </li>
          ))}
        </ul>
      }
    />
  );
}
