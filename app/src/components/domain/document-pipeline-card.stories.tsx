import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StepStatusEnum } from '@/__generated__/graphql';
import { DocumentPipelineCard, type PipelineStep } from './document-pipeline-card';

/**
 * The pipeline as a list of steps.
 *
 * Each row is three facts that only sometimes exist — an error, a retry count, a finish time —
 * so the stories are about which of them a row carries, not about the list having rows.
 */

function step(overrides: Partial<PipelineStep>): PipelineStep {
  return {
    id: '5b0e4d0a-6a55-4a43-9b0a-2f2a3b4c5d01',
    step: 'inspect',
    status: StepStatusEnum.Succeeded,
    attempts: 1,
    error: null,
    finishedAt: '2026-09-02T11:04:02.000Z',
    ...overrides,
  };
}

const meta = {
  title: 'Domain/DocumentPipelineCard',
  component: DocumentPipelineCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DocumentPipelineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every step ran once and finished: a name and a status per row, and no retry count. */
export const Succeeded: Story = {
  args: {
    ocrRequested: false,
    steps: [step({}), step({ id: '5b0e4d0a-6a55-4a43-9b0a-2f2a3b4c5d02', step: 'text' })],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Pipeline' })).toBeInTheDocument();
    await expect(canvas.getByText('OCR not requested')).toBeInTheDocument();
    const [inspect, text] = canvas.getAllByRole('listitem');
    // Named in the reader's words, with a line on what each step does.
    await expect(inspect).toHaveTextContent('Inspect');
    await expect(inspect).toHaveTextContent('Checks the file type and its checksum');
    await expect(text).toHaveTextContent('Text');
    await expect(text).toHaveTextContent('Done');
    await expect(text).not.toHaveTextContent('attempts');
  },
};

/** A step that gave up: its row says why, how many times it tried, and that it failed. */
export const FailedStep: Story = {
  args: {
    ocrRequested: true,
    steps: [
      step({}),
      step({
        id: '5b0e4d0a-6a55-4a43-9b0a-2f2a3b4c5d03',
        step: 'ocr',
        status: StepStatusEnum.Failed,
        attempts: 3,
        error: 'ocrmypdf exited with code 2',
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('OCR requested')).toBeInTheDocument();
    const [, ocr] = canvas.getAllByRole('listitem');
    await expect(ocr).toHaveTextContent('ocrmypdf exited with code 2');
    await expect(ocr).toHaveTextContent('3 attempts');
    await expect(ocr).toHaveTextContent('Failed');
  },
};

/** Still queued: nothing has finished, so the row has a status and no time under its name. */
export const Queued: Story = {
  args: {
    ocrRequested: true,
    steps: [step({ step: 'ocr', status: StepStatusEnum.Queued, finishedAt: null })],
  },
  play: async ({ canvas }) => {
    const [ocr] = canvas.getAllByRole('listitem');
    await expect(within(ocr).getByText('OCR')).toBeInTheDocument();
    await expect(ocr).toHaveTextContent('Queued');
    await expect(ocr).not.toHaveTextContent('ago');
  },
};

/**
 * The vision step, skipped: the row says why in words, since "Skipped" alone reads as something
 * that went wrong. The card's line says when the history starts and what was asked for.
 */
export const VisionSkipped: Story = {
  args: {
    ocrRequested: true,
    uploadedAt: '2026-09-02T11:04:00.000Z',
    steps: [
      step({ step: 'ocr' }),
      step({ id: '5b0e4d0a-6a55-4a43-9b0a-2f2a3b4c5d04', step: 'vision', status: StepStatusEnum.Skipped }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Uploaded .+ · OCR requested$/)).toBeInTheDocument();
    const [, vision] = canvas.getAllByRole('listitem');
    await expect(within(vision).getByText('Vision model')).toBeInTheDocument();
    await expect(vision).toHaveTextContent('No vision model is set up, or it was not asked for');
    await expect(vision).toHaveTextContent('Skipped');
  },
};

/** Read with the vision model: the card says it was asked for, and the step says what it did. */
export const VisionRead: Story = {
  args: {
    ocrRequested: false,
    visionRequested: true,
    steps: [step({ step: 'vision' })],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Vision model requested/)).toBeInTheDocument();
    const [vision] = canvas.getAllByRole('listitem');
    await expect(vision).toHaveTextContent('Reads the pages with a vision model');
    await expect(vision).toHaveTextContent('Done');
  },
};

/** A step this bundle has never heard of, from a newer server, is shown by its stored name. */
export const UnknownStep: Story = {
  args: { ocrRequested: false, steps: [step({ step: 'translate' })] },
  play: async ({ canvas }) => {
    const [row] = canvas.getAllByRole('listitem');
    await expect(within(row).getByText('translate')).toBeInTheDocument();
  },
};

/** The vision step running before it has rendered the pages: what it does, and no bar yet. */
export const RunningBeforeACount: Story = {
  args: { ocrRequested: true, steps: [step({ step: 'vision', status: StepStatusEnum.Running, finishedAt: null })] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Reads the pages with a vision model')).toBeInTheDocument();
    await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
  },
};

const DONE = 3;
const TOTAL = 10;

/** A step that counts but names no unit says only how many are done. */
export const CountingWithoutAUnit: Story = {
  args: {
    ocrRequested: false,
    steps: [
      step({
        step: 'translate',
        status: StepStatusEnum.Running,
        finishedAt: null,
        progressDone: DONE,
        progressTotal: TOTAL,
      }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('3 of 10')).toBeInTheDocument();
    const bar = canvas.getByRole('progressbar', { name: 'translate progress' });
    await expect(bar).toHaveAttribute('aria-valuenow', String(DONE));
    await expect(within(bar.parentElement ?? bar).queryByText(/Page/)).not.toBeInTheDocument();
  },
};
