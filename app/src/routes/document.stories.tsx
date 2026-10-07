import type { Meta, StoryObj } from '@storybook/react-vite';
import { Route, Routes } from 'react-router';
import { expect, userEvent, within } from 'storybook/test';
import { type DocumentDetailQuery, DocumentStatusEnum, StepStatusEnum } from '@/__generated__/graphql';
import { clientId } from '@/lib/id';
import { documentPath, ROUTES } from '@/lib/routes';
import { DocumentRoute } from './document';

/**
 * One document: what it is, how far the pipeline got with it, and what can be done to it.
 *
 * Most documents here are plain text with nothing extracted, so the page asks for no presigned
 * URL. The stories about the text card answer `documentFileUrl` with a `data:` URL instead: a
 * story has no bucket, and the page only ever fetches whatever address it is handed.
 */

const ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';
const TEXT = 'This lease is made between';
const OVER_THE_PREVIEW_LIMIT_BYTES = 2_097_152;

// The builders are typed by the page's own query, so a field the page stops selecting, or a
// status the schema drops, is a type error here rather than a story quietly out of date.
type Document = NonNullable<DocumentDetailQuery['document']>;
type Step = Document['processingSteps'][number];

function step(overrides: Partial<Step>): Step {
  return {
    id: clientId(),
    step: 'store',
    status: StepStatusEnum.Succeeded,
    attempts: 1,
    error: null,
    startedAt: '2026-09-02T11:04:00.000Z',
    finishedAt: '2026-09-02T11:04:02.000Z',
    ...overrides,
  };
}

function document(overrides: Partial<Document>): Document {
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
    status: DocumentStatusEnum.Ready,
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
        <Route path={ROUTES.document} element={<DocumentRoute />} />
      </Routes>
    </div>
  );
}

const meta = {
  title: 'Routes/Document',
  component: DocumentRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [documentPath(ID)] } },
} satisfies Meta<typeof DocumentRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  parameters: { apolloClient: { resolvers: { Query: { document: () => document({}) } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Lease agreement' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('listitem')[1]).toHaveTextContent('extract-text');
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
              status: DocumentStatusEnum.Failed,
              error: 'ocrmypdf exited with code 2',
              processingSteps: [
                step({ step: 'store' }),
                step({ step: 'ocr', status: StepStatusEnum.Failed, attempts: 3, error: 'ocrmypdf exited with code 2' }),
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
    await expect(canvas.getAllByRole('listitem')[1]).toHaveTextContent('3 attempts');
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
    await expect(within(dialog).getByRole('textbox', { name: /Title/ })).toHaveValue('Lease agreement');
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
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: TEXT.length }),
          documentFileUrl: () => textUrl(TEXT),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(TEXT)).toBeInTheDocument();
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
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: OVER_THE_PREVIEW_LIMIT_BYTES }),
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

/** Before the answer lands: a skeleton under a header that is already the right height. */
export const Loading: Story = {
  parameters: { apolloClient: { resolvers: { Query: { document: () => document({}) } }, delay: 100_000 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await expect(canvas.queryByRole('heading', { name: 'Lease agreement' })).not.toBeInTheDocument();
  },
};

/**
 * The server answered with an error. That is not the same as the document being gone, and the
 * page must not say "No such document" to someone whose server is down.
 */
export const Unreachable: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => {
            throw new Error('Connection terminated unexpectedly');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Could not load this document');
    await expect(alert).toHaveTextContent('Connection terminated unexpectedly');
    await expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
    await expect(canvas.queryByText('No such document')).not.toBeInTheDocument();
  },
};
