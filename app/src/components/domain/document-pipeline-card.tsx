import { StepStatusEnum } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { StepStatusBadge } from '@/components/domain/status-badge';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Progress } from '@/components/ui/progress';
import { formatAgo, formatDateTime, joinStats } from '@/lib/format';
import { stepInfo, stepProgress } from '@/lib/pipeline-steps';

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
  /** How many of `progressTotal` a step that counts has finished. Null until it says. */
  progressDone?: number | null | undefined;
  progressTotal?: number | null | undefined;
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

/** The count and bar under a running step that has said how far it has got, else nothing. */
function runningProgress(step: PipelineStep) {
  const { progressDone, progressTotal } = step;
  if (step.status !== StepStatusEnum.Running || progressDone == null || progressTotal == null || progressTotal <= 0) {
    return null;
  }
  const { line } = stepProgress(step.step, progressDone, progressTotal);
  const label = stepInfo(step.step).label;
  return (
    <span className="flex flex-col gap-1.5">
      <span>{line}</span>
      <Progress value={progressDone} max={progressTotal} label={`${label} progress`} valueLabel={line} />
    </span>
  );
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
              description={
                runningProgress(step) ??
                joinStats(
                  stepLine(step),
                  step.attempts > 1 && `${step.attempts} attempts`,
                  step.finishedAt && formatAgo(step.finishedAt),
                )
              }
              meta={<StepStatusBadge status={step.status} />}
            />
          ))}
        />
      }
    />
  );
}
