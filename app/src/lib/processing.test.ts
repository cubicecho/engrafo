import { describe, expect, it } from 'vitest';
import { ProcessingState, StepStatusEnum } from '@/__generated__/graphql';
import { POLLING_DEFAULTS, PROCESSING_PAGE_DEFAULTS } from '@/defaults';
import { type Entry, entryLine, entryTime, pollInterval, stateFromView } from './processing';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const MINUTE = 60_000;

function entry(steps: Entry['steps'], extra: Partial<Entry> = {}): Entry {
  return { document: { updatedAt: new Date(NOW - 5 * MINUTE).toISOString(), error: null }, steps, ...extra };
}

describe('stateFromView', () => {
  it('opens the state named, and the first for anything else', () => {
    expect(stateFromView('failed').state).toBe(ProcessingState.Failed);
    expect(stateFromView(null).state).toBe(ProcessingState.Running);
    expect(stateFromView('nonsense').state).toBe(ProcessingState.Running);
  });
});

describe('entryLine', () => {
  it('names the running step and the page it is on', () => {
    const running = entry([
      { step: 'ocr', status: StepStatusEnum.Succeeded },
      { step: 'vision', status: StepStatusEnum.Running, progressDone: 2, progressTotal: 12 },
    ]);
    expect(entryLine(ProcessingState.Running, running)).toBe('Vision model · Page 3 of 12');
    const noProgress = entry([{ step: 'ocr', status: StepStatusEnum.Running }]);
    expect(entryLine(ProcessingState.Running, noProgress)).toBe('OCR');
    expect(entryLine(ProcessingState.Running, entry([]))).toBe('Between steps');
  });

  it('says what a queued document will run next', () => {
    const queued = entry([
      { step: 'ocr', status: StepStatusEnum.Succeeded },
      { step: 'vision', status: StepStatusEnum.Queued },
    ]);
    expect(entryLine(ProcessingState.Queued, queued)).toBe('Next: Vision model');
  });

  it("says which step failed and why, else the document's own error", () => {
    const failed = entry([{ step: 'vision', status: StepStatusEnum.Failed, error: 'the endpoint is down' }]);
    expect(entryLine(ProcessingState.Failed, failed)).toBe('Vision model: the endpoint is down');
    const bare = entry([], { document: { updatedAt: '', error: 'ocr: boom' } });
    expect(entryLine(ProcessingState.Failed, bare)).toBe('ocr: boom');
  });

  it('leaves a finished row to the page', () => {
    expect(entryLine(ProcessingState.Finished, entry([]))).toBeUndefined();
  });
});

describe('entryTime', () => {
  it('counts how long the running step has run', () => {
    const running = entry([
      { step: 'vision', status: StepStatusEnum.Running, startedAt: new Date(NOW - 3 * MINUTE).toISOString() },
    ]);
    expect(entryTime(ProcessingState.Running, running, NOW)).toBe('For 3m');
  });

  it('says how long a queued one has waited, and when a done one ended', () => {
    expect(entryTime(ProcessingState.Queued, entry([]), NOW)).toBe('Queued 5 minutes ago');
    const ended = entry([], { finishedAt: new Date(NOW - 2 * MINUTE).toISOString() });
    expect(entryTime(ProcessingState.Failed, ended, NOW)).toBe('Failed 2 minutes ago');
    expect(entryTime(ProcessingState.Finished, ended, NOW)).toBe('Finished 2 minutes ago');
  });
});

describe('pollInterval', () => {
  it('polls quickly while something moves, slowly otherwise, and never stops', () => {
    expect(pollInterval(3)).toBe(POLLING_DEFAULTS.intervalMs);
    expect(pollInterval(0)).toBe(PROCESSING_PAGE_DEFAULTS.idleIntervalMs);
  });
});
