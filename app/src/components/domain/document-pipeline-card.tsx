import { StepStatusEnum } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { StepStatusBadge } from '@/components/domain/status-badge';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { formatAgo, formatDateTime, joinStats } from '@/lib/format';
import { stepInfo } from '@/lib/pipeline-steps';

/** One row of `processing_steps`, as the detail query selects it. */
export interface PipelineStep {
  id: string;
  /** The step's name in the pipeline: `inspect`, `text`, `ocr`, `vision`. */
  step: string;
  status: StepStatusEnum;
  /** How many times the step has run. Shown only once it is more than one. */
  attempts: number;
  /** Why the step failed, when it did. */
  error: string | null;
  finishedAt: string | null;
}

interface DocumentPipelineCardProps {
  /** Whether the upload asked for OCR. */
  ocrRequested: boolean;
  /** Whether the document was asked to be read with the vision model. */
  visionRequested?: boolean | undefined;
  /** When the document was uploaded, as an ISO timestamp: where its history starts. */
  uploadedAt?: string | undefined;
  /** The steps in the order the pipeline runs them. */
  steps: readonly PipelineStep[];
}

/** What a row says under its name: why it failed or was skipped, else what the step does. */
function stepLine(step: PipelineStep): string | null {
  const info = stepInfo(step.step);
  if (step.error) {
    return step.error;
  }
  if (step.status === StepStatusEnum.Skipped) {
    return info.skipped || null;
  }
  return info.description || null;
}

/** How far the pipeline got with a document: one row per step, with its status and what went wrong. */
export function DocumentPipelineCard({ ocrRequested, visionRequested, uploadedAt, steps }: DocumentPipelineCardProps) {
  return (
    <CardLayout
      level={2}
      title="Pipeline"
      description={joinStats(
        uploadedAt && `Uploaded ${formatDateTime(uploadedAt)}`,
        ocrRequested ? 'OCR requested' : 'OCR not requested',
        visionRequested && 'Vision model requested',
      )}
      contentSlot={
        <List
          label="Pipeline steps"
          contentSlot={steps.map((step) => (
            <ListItem
              key={step.id}
              className="px-0"
              title={stepInfo(step.step).label}
              description={joinStats(
                stepLine(step),
                step.attempts > 1 && `${step.attempts} attempts`,
                step.finishedAt && formatAgo(step.finishedAt),
              )}
              meta={<StepStatusBadge status={step.status} />}
            />
          ))}
        />
      }
    />
  );
}
