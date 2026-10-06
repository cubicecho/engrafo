import type { Meta, StoryObj } from '@storybook/react-vite';
import { Route, Routes } from 'react-router';
import { expect, userEvent, within } from 'storybook/test';
import { DocumentRoute } from './document';

/**
 * One document: what it is, how far the pipeline got with it, and what can be done to it.
 *
 * The documents here are plain text with nothing extracted, so the page asks for no presigned
 * URL — the preview and the text card are the two parts that reach past GraphQL to the bucket,
 * and a story has no bucket.
 */

const ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';

function step(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    step: 'store',
    status: 'succeeded',
    attempts: 1,
    error: null,
    startedAt: '2026-09-02T11:04:00.000Z',
    finishedAt: '2026-09-02T11:04:02.000Z',
    ...overrides,
  };
}

function document(overrides: Record<string, unknown>) {
  return {
    id: ID,
    title: 'Lease agreement',
    originalFilename: 'lease.txt',
    mimeType: 'text/plain',
    sizeBytes: 48_211,
    checksumSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    ocrRequested: false,
    status: 'ready',
    error: null,
    createdAt: '2026-09-02T11:04:00.000Z',
    processingSteps: [step({ step: 'store' }), step({ step: 'extract-text' })],
    ...overrides,
  };
}

/** A route of its own, because the page reads its id off the URL. */
function Framed() {
  return (
    <div className="h-screen">
      <Routes>
        <Route path="/documents/:id" element={<DocumentRoute />} />
      </Routes>
    </div>
  );
}

const meta = {
  title: 'Routes/Document',
  component: DocumentRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [`/documents/${ID}`] } },
} satisfies Meta<typeof DocumentRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  parameters: { apolloClient: { resolvers: { Query: { document: () => document({}) } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Lease agreement' })).toBeInTheDocument();
    await expect(canvas.getByText('extract-text')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy checksum' })).toBeInTheDocument();
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  },
};

/** The pipeline gave up: the reason is an alert, and Retry is the one thing to do about it. */
export const Failed: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () =>
            document({
              status: 'failed',
              error: 'ocrmypdf exited with code 2',
              processingSteps: [
                step({ step: 'store' }),
                step({ step: 'ocr', status: 'failed', attempts: 3, error: 'ocrmypdf exited with code 2' }),
              ],
            }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Processing failed');
    await expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await expect(canvas.getByText(/3 attempts/)).toBeInTheDocument();
  },
};

/**
 * Renaming is a dialog with a Save and a Cancel, opened on the title as it stands. The dialog is
 * portalled, so it is looked for in the document rather than in the canvas.
 */
export const Renaming: Story = {
  parameters: { apolloClient: { resolvers: { Query: { document: () => document({}) } } } },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Rename' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Rename document' });
    await expect(within(dialog).getByLabelText(/Title/)).toHaveValue('Lease agreement');
    await expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  },
};

/** A link to a document that is gone says so, rather than loading for ever. */
export const Missing: Story = {
  parameters: { apolloClient: { resolvers: { Query: { document: () => null } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No such document')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Back to documents' })).toBeInTheDocument();
  },
};
