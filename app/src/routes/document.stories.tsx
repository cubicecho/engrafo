import type { Meta, StoryObj } from '@storybook/react-vite';
import { Route, Routes } from 'react-router';
import { expect, userEvent, within } from 'storybook/test';
import { DocumentRoute } from './document';

/**
 * One document: what it is, how far the pipeline got with it, and what can be done to it.
 *
 * Most documents here are plain text with nothing extracted, so the page asks for no presigned
 * URL. The stories about the text card answer `documentFileUrl` with a `data:` URL instead: a
 * story has no bucket, and the page only ever fetches whatever address it is handed.
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

/** Where the text bucket would be: the page fetches whatever address `documentFileUrl` hands it. */
function textUrl(text: string): string {
  return `data:text/plain,${encodeURIComponent(text)}`;
}

/** Extracted text is fetched from its own bucket and shown beside a way to copy it. */
export const WithText: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: 26 }),
          documentFileUrl: () => textUrl('This lease is made between'),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('This lease is made between')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy text' })).toBeInTheDocument();
  },
};

/**
 * The text object exists and has nothing in it. The card used to answer every case it had no
 * text for with "Too large to show here.", which is only true of one of them.
 */
export const EmptyText: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: 0 }),
          documentFileUrl: () => textUrl(''),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No text was extracted from this document.')).toBeInTheDocument();
    await expect(canvas.queryByText('Too large to show here.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy text' })).not.toBeInTheDocument();
  },
};

/** Past the preview limit the text is never fetched: the download button stands in for it. */
export const TextTooLarge: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: 2 * 1024 * 1024 }),
          documentFileUrl: () => {
            throw new Error('The oversize text must not be requested');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Too large to show here.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Download text' })).toBeInTheDocument();
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
