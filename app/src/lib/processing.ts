import { ProcessingState, StepStatusEnum } from '@/__generated__/graphql';
import type { BadgeVariant } from '@/components/ui/badge';
import { POLLING_DEFAULTS, PROCESSING_PAGE_DEFAULTS } from '@/defaults';
import { formatAgo, formatDuration } from '@/lib/format';
import { stepInfo, stepProgress } from '@/lib/pipeline-steps';

/** Milliseconds in a second, for a duration counted from two clocks. */
const MS_PER_SECOND = 1000;

// What the processing page says about each state and each row. Kept apart from the page so the
// wording and the polling rule are tested without a browser.

/** The key `processing.counts` holds each state's count under. */
export type CountKey = 'running' | 'queued' | 'failed' | 'finished';

/** One state as the page draws it: a tile, and the heading over its list. */
export interface StateInfo {
  state: ProcessingState;
  /** The value of `?view=`, and the count's key. */
  key: CountKey;
  label: string;
  /** One line under the list's heading on what is in it. */
  blurb: string;
  /** What the list says when there is nothing in it. */
  empty: string;
  /** The badge colour a row in this state wears. */
  tone: BadgeVariant;
}

/** The states, in the order the tiles are drawn. */
export const PROCESSING_STATES: readonly StateInfo[] = Object.freeze([
  {
    state: ProcessingState.Running,
    key: 'running',
    label: 'Running',
    blurb: 'A step is working on these now.',
    empty: 'Nothing is being processed.',
    tone: 'info',
  },
  {
    state: ProcessingState.Queued,
    key: 'queued',
    label: 'Queued',
    blurb: 'Waiting for a free slot, in the order they will run.',
    empty: 'Nothing is waiting.',
    tone: 'secondary',
  },
  {
    state: ProcessingState.Failed,
    key: 'failed',
    label: 'Failed',
    blurb: 'A step failed. Retry runs the failed step again, and the ones after it.',
    empty: 'Nothing has failed.',
    tone: 'destructive',
  },
  {
    state: ProcessingState.Finished,
    key: 'finished',
    label: 'Finished',
    blurb: 'Done lately, the most recent first.',
    empty: 'Nothing has finished lately.',
    tone: 'positive',
  },
]);

/** The query-string key that says which state's list is open. */
export const VIEW_PARAM = 'view';

/**
 * The state `?view=` names.
 *
 * @param view - The parameter as it came, or null.
 * @returns Its state, or the first one for a missing or unknown value, as an unknown tab opens the first.
 */
export function stateFromView(view: string | null): StateInfo {
  return PROCESSING_STATES.find((info) => info.key === view) ?? PROCESSING_STATES[0];
}

/** A step row as the page reads it. */
export interface EntryStep {
  step: string;
  status: StepStatusEnum;
  error?: string | null | undefined;
  progressDone?: number | null | undefined;
  progressTotal?: number | null | undefined;
  startedAt?: string | null | undefined;
}

/** A document's row as the page reads it. */
export interface Entry {
  document: { updatedAt: string; error?: string | null | undefined };
  steps: readonly EntryStep[];
  finishedAt?: string | null | undefined;
}

/** The step a running document is on, if it is on one: between two steps it is on none. */
export function runningStep(entry: Entry): EntryStep | undefined {
  return entry.steps.find((step) => step.status === StepStatusEnum.Running);
}

/**
 * The line under a row's title: where it is in the pipeline, or what went wrong.
 *
 * @param state - The list the row is in.
 * @param entry - The row.
 * @returns The line, or undefined where the page says something else (a finished row's folder).
 */
export function entryLine(state: ProcessingState, entry: Entry): string | undefined {
  switch (state) {
    case ProcessingState.Running: {
      const step = runningStep(entry);
      if (step === undefined) {
        return 'Between steps';
      }
      const { label } = stepInfo(step.step);
      const progress =
        step.progressDone != null && step.progressTotal != null && step.progressTotal > 0
          ? stepProgress(step.step, step.progressDone, step.progressTotal).line
          : null;
      return progress ? `${label} · ${progress}` : label;
    }
    case ProcessingState.Queued: {
      const next = entry.steps.find((step) => step.status === StepStatusEnum.Queued);
      return next ? `Next: ${stepInfo(next.step).label}` : 'Waiting for a free slot';
    }
    case ProcessingState.Failed: {
      const failed = entry.steps.find((step) => step.status === StepStatusEnum.Failed);
      if (failed?.error) {
        return `${stepInfo(failed.step).label}: ${failed.error}`;
      }
      return entry.document.error ?? 'A step failed';
    }
    default:
      return undefined;
  }
}

/**
 * The time on a row's far end: how long it has run, how long it has waited, or when it ended.
 *
 * @param state - The list the row is in.
 * @param entry - The row.
 * @param now - The clock, in epoch milliseconds.
 */
export function entryTime(state: ProcessingState, entry: Entry, now: number): string {
  switch (state) {
    case ProcessingState.Running: {
      const started = runningStep(entry)?.startedAt;
      return started ? `For ${formatDuration(Math.max(0, (now - new Date(started).getTime()) / MS_PER_SECOND))}` : '';
    }
    case ProcessingState.Queued:
      return `Queued ${formatAgo(entry.document.updatedAt, now)}`;
    case ProcessingState.Failed:
      return entry.finishedAt ? `Failed ${formatAgo(entry.finishedAt, now)}` : '';
    default:
      return entry.finishedAt ? `Finished ${formatAgo(entry.finishedAt, now)}` : '';
  }
}

/**
 * How often the page asks again.
 *
 * @param busy - How many documents are running or queued.
 * @returns The quick interval while something is moving, the idle one otherwise: never off,
 *   because work starts elsewhere (an upload, a retry, the watched folder) and this page should
 *   see it without a reload.
 */
export function pollInterval(busy: number): number {
  return busy > 0 ? POLLING_DEFAULTS.intervalMs : PROCESSING_PAGE_DEFAULTS.idleIntervalMs;
}
