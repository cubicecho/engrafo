import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DocumentStatusEnum, StepStatusEnum } from '@/__generated__/graphql';
import { clientId } from '@/lib/id';
import { documentPath, ROUTES } from '@/lib/routes';
import { archiveServer, TAXES } from '../../.storybook/archive.ts';
import { ProcessingRoute } from './processing';

/**
 * The processing page against a mock server built from the real SDL. The server keeps one
 * document in each state and answers `entries` for whichever the page asks about, so a story
 * proves that a tile opens its list, that a row says where it is in the pipeline, and that a
 * failed row's Retry sends the retry and moves it to the queue.
 */

const MINUTE = 60_000;
// The fixtures' clock: how long ago each thing happened, which the rows then say.
const RUNNING_FOR_MINUTES = 3;
const FAILED_MINUTES_AGO = 10;
const FINISHED_MINUTES_AGO = 30;
const QUEUED_MINUTES_AGO = 5;
// The running read is on page 3 of 12: two done.
const PAGES_DONE = 2;
const PAGES = 12;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

interface Fixture {
  state: 'RUNNING' | 'QUEUED' | 'FAILED' | 'FINISHED';
  title: string;
  status: DocumentStatusEnum;
  error?: string | null;
  steps: {
    step: string;
    status: StepStatusEnum;
    error?: string | null;
    progressDone?: number | null;
    progressTotal?: number | null;
    startedAt?: string | null;
  }[];
  finishedAt?: string | null;
}

function fixtures(): (Fixture & { id: string })[] {
  return [
    {
      id: clientId(),
      state: 'RUNNING',
      title: 'Lease agreement',
      status: DocumentStatusEnum.Processing,
      steps: [
        { step: 'ocr', status: StepStatusEnum.Succeeded },
        {
          step: 'vision',
          status: StepStatusEnum.Running,
          progressDone: PAGES_DONE,
          progressTotal: PAGES,
          startedAt: ago(RUNNING_FOR_MINUTES),
        },
      ],
    },
    {
      id: clientId(),
      state: 'QUEUED',
      title: 'Electricity bill',
      status: DocumentStatusEnum.Uploaded,
      steps: [{ step: 'vision', status: StepStatusEnum.Queued }],
    },
    {
      id: clientId(),
      state: 'FAILED',
      title: 'Blurry receipt',
      status: DocumentStatusEnum.Failed,
      error: 'vision: the endpoint is down',
      steps: [{ step: 'vision', status: StepStatusEnum.Failed, error: 'the endpoint is down' }],
      finishedAt: ago(FAILED_MINUTES_AGO),
    },
    {
      id: clientId(),
      state: 'FINISHED',
      title: 'Tax return',
      status: DocumentStatusEnum.Ready,
      steps: [{ step: 'vision', status: StepStatusEnum.Succeeded }],
      finishedAt: ago(FINISHED_MINUTES_AGO),
    },
  ];
}

/** What a story's server was asked to do, in order. */
let calls: string[] = [];

function processingServer(rows = fixtures()) {
  const archive = archiveServer({ folders: [TAXES], documents: [] });
  const count = (state: Fixture['state']) => rows.filter((row) => row.state === state).length;
  return {
    Query: {
      ...archive.Query,
      processing: () => ({
        concurrency: 1,
        finishedWithinHours: 24,
        listLimit: 200,
        counts: {
          running: count('RUNNING'),
          queued: count('QUEUED'),
          failed: count('FAILED'),
          finished: count('FINISHED'),
        },
        entries: ({ state }: { state: Fixture['state'] }) =>
          rows
            .filter((row) => row.state === state)
            .map((row) => ({
              finishedAt: row.finishedAt ?? null,
              document: {
                id: row.id,
                title: row.title,
                folderId: row.state === 'FINISHED' ? TAXES.id : null,
                status: row.status,
                error: row.error ?? null,
                updatedAt: ago(QUEUED_MINUTES_AGO),
              },
              steps: row.steps.map((step) => ({
                error: null,
                progressDone: null,
                progressTotal: null,
                startedAt: null,
                ...step,
              })),
            })),
      }),
    },
    Mutation: {
      retryDocumentProcessing: (_parent: unknown, args: { id: string }) => {
        calls.push(`retry ${args.id}`);
        const row = rows.find((candidate) => candidate.id === args.id);
        if (!row) {
          throw new Error('Document not found');
        }
        Object.assign(row, {
          state: 'QUEUED',
          status: DocumentStatusEnum.Uploaded,
          error: null,
          steps: [{ step: 'vision', status: StepStatusEnum.Queued }],
        });
        return { id: row.id, status: row.status, error: null };
      },
    },
  };
}

/** Bounded height, because `PageLayout` is a sticky chassis that scrolls its own body. */
function Framed() {
  return (
    <div className="h-screen">
      <ProcessingRoute />
    </div>
  );
}

const meta = {
  title: 'Routes/Processing',
  component: ProcessingRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.processing] } },
  beforeEach: () => {
    calls = [];
  },
} satisfies Meta<typeof ProcessingRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Opens on what is running: the step, the page it is on with a bar, and how long it has run.
 * Every tile carries its count, and Running is the one pressed.
 */
export const ShowsWhatIsRunning: Story = {
  parameters: { apolloClient: { resolvers: processingServer() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const running = await canvas.findByRole('link', { name: /Lease agreement/ });
    await expect(running).toHaveAttribute('href', expect.stringContaining('/documents/'));
    await expect(canvas.getByText('Vision model · Page 3 of 12')).toBeInTheDocument();
    await expect(canvas.getByText('For 3m')).toBeInTheDocument();
    await expect(canvas.getByRole('progressbar', { name: 'Lease agreement progress' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Running\s*1/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: /Failed\s*1/ })).toHaveAttribute('aria-pressed', 'false');
  },
};

/** A tile opens its list: the queue says what runs next, the finished list where each is filed. */
export const SwitchesBetweenStates: Story = {
  parameters: { apolloClient: { resolvers: processingServer() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Queued\s*1/ }));
    await expect(await canvas.findByText('Next: Vision model')).toBeInTheDocument();
    await expect(canvas.getByText('Queued 5 minutes ago')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: /Finished\s*1/ }));
    await expect(await canvas.findByRole('link', { name: /Tax return/ })).toBeInTheDocument();
    await expect(canvas.getByText('Taxes')).toBeInTheDocument();
    await expect(canvas.getByText('Finished 30 minutes ago')).toBeInTheDocument();
  },
};

/** A failed row says which step failed and why, and Retry sends it back to the queue. */
export const RetriesAFailedDocument: Story = {
  parameters: {
    apolloClient: { resolvers: processingServer() },
    router: { initialEntries: [`${ROUTES.processing}?view=failed`] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Vision model: the endpoint is down')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Retry “Blurry receipt”' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    await expect(calls[0]).toMatch(/^retry /);
    await waitFor(() => expect(canvas.getByRole('button', { name: /Queued\s*2/ })).toBeInTheDocument());
    await expect(await canvas.findByText('Nothing has failed.')).toBeInTheDocument();
  },
};

/** An empty state says so in words, not with a blank list. */
export const NothingRunning: Story = {
  parameters: { apolloClient: { resolvers: processingServer([]) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Nothing is being processed.')).toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: documentPath('x') })).not.toBeInTheDocument();
  },
};
