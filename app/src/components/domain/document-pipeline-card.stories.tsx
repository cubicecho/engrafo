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
    await expect(canvas.getByText('Uploaded without OCR.')).toBeInTheDocument();
    const [inspect, text] = canvas.getAllByRole('listitem');
    await expect(inspect).toHaveTextContent('inspect');
    await expect(text).toHaveTextContent('text');
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
    await expect(canvas.getByText('OCR was requested for this document.')).toBeInTheDocument();
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
    await expect(within(ocr).getByText('ocr')).toBeInTheDocument();
    await expect(ocr).toHaveTextContent('Queued');
    await expect(ocr).not.toHaveTextContent('ago');
  },
};
