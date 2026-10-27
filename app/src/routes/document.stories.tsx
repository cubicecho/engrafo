import type { Meta, StoryObj } from '@storybook/react-vite';
import { Route, Routes, useLocation } from 'react-router';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import {
  ContentFormatEnum,
  type DocumentDetailQuery,
  DocumentStatusEnum,
  FieldSourceEnum,
  StepStatusEnum,
} from '@/__generated__/graphql';
import { useArchive } from '@/lib/archive';
import { clientId } from '@/lib/id';
import { documentPath, ROUTES } from '@/lib/routes';
import { SERVER_CONFIG } from '../../.storybook/archive.ts';
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
    progressDone: null,
    progressTotal: null,
    ...overrides,
  };
}

function document(overrides: Partial<Document>): Document {
  return {
    id: ID,
    title: 'Lease agreement',
    folderId: null,
    folder: null,
    originalFilename: 'lease.txt',
    mimeType: 'text/plain',
    sizeBytes: 48_211,
    checksumSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    contentFormat: ContentFormatEnum.Plain,
    ocrRequested: false,
    visionRequested: false,
    status: DocumentStatusEnum.Ready,
    error: null,
    createdAt: '2026-09-02T11:04:00.000Z',
    documentDate: null,
    documentDateSource: null,
    vendor: null,
    total: null,
    currency: null,
    receiptSource: null,
    processingSteps: [step({ step: 'store' }), step({ step: 'extract-text' })],
    ...overrides,
  };
}

/** The query string the page is on, so a story can check that a tab is kept in the URL. */
function SearchProbe() {
  return (
    <span hidden data-testid="search">
      {useLocation().search}
    </span>
  );
}

/**
 * The archive's documents, as whatever list the reader lands on would draw them: the page a
 * delete navigates to, here, so a story can see what that page paints first.
 */
function ArchiveProbe() {
  const { result, documents } = useArchive();
  if (!result.data) {
    return <p>Loading the archive</p>;
  }
  return (
    <ul aria-label="Archive">
      {documents.map((doc) => (
        <li key={doc.id}>{doc.title}</li>
      ))}
    </ul>
  );
}

/** A route of its own, because the page reads its id off the URL. */
function Framed() {
  return (
    <div className="h-screen">
      <Routes>
        <Route path={ROUTES.document} element={<DocumentRoute />} />
        <Route path={ROUTES.documents} element={<ArchiveProbe />} />
      </Routes>
      <SearchProbe />
    </div>
  );
}

/** What the server says it can do. No vision model unless a story says there is one. */
function serverConfig(overrides: Partial<typeof SERVER_CONFIG> = {}) {
  return () => ({ ...SERVER_CONFIG, ...overrides });
}

/** Opens one of the page's tabs, found by the start of its name: a mark can follow it. */
async function openTab(canvas: ReturnType<typeof within>, name: 'Preview' | 'Text' | 'History') {
  const tab = await canvas.findByRole('tab', { name: new RegExp(`^${name}`) });
  await userEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
  return tab;
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
    // Plain text has no preview, so there is no tab for one and the page opens on its text.
    await expect(canvas.queryByRole('tab', { name: 'Preview' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'true');
    // The details are beside the tabs, whichever one is open.
    await expect(canvas.getByRole('button', { name: 'Copy checksum' })).toBeInTheDocument();
    await openTab(canvas, 'History');
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
    // The History tab is marked, since that is where the failed step is.
    const history = await openTab(canvas, 'History');
    await expect(history).toHaveAccessibleName('History Failed');
    await expect(canvas.getAllByRole('listitem')[1]).toHaveTextContent('3 attempts');
    // The alert stays above the tabs, whichever is open.
    await expect(canvas.getByRole('alert')).toHaveTextContent('Processing failed');
  },
};

const FAILED_DOCUMENT = () =>
  document({
    status: DocumentStatusEnum.Failed,
    error: 'ocrmypdf exited with code 2',
    processingSteps: [step({ step: 'ocr', status: StepStatusEnum.Failed, error: 'ocrmypdf exited with code 2' })],
  });

function refuse(): never {
  throw new Error('The server is restarting');
}

/** A retry the server refuses is said on the page, not left as a button that did nothing. */
export const RetryRefused: Story = {
  parameters: {
    apolloClient: {
      resolvers: { Query: { document: FAILED_DOCUMENT }, Mutation: { retryDocumentProcessing: refuse } },
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Retry' }));
    await expect(await canvas.findByText('Could not retry processing')).toBeInTheDocument();
    await expect(canvas.getByText('The server is restarting')).toBeInTheDocument();
  },
};

let retried = false;

/**
 * A retry puts the failed steps back in the queue, and the page shows that as one change: the
 * badge and the timeline together, not the badge first and the failed run until the next poll.
 */
export const Retried: Story = {
  beforeEach: () => {
    retried = false;
  },
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () =>
            retried
              ? document({
                  status: DocumentStatusEnum.Uploaded,
                  processingSteps: [step({ step: 'store' }), step({ step: 'ocr', status: StepStatusEnum.Queued })],
                })
              : FAILED_DOCUMENT(),
        },
        Mutation: {
          retryDocumentProcessing: () => {
            retried = true;
            return document({ status: DocumentStatusEnum.Uploaded });
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await openTab(canvas, 'History');
    const steps = () => within(canvas.getByRole('list', { name: 'Pipeline steps' })).getAllByRole('listitem');
    await waitFor(() => expect(steps().at(-1)).toHaveTextContent('Failed'));
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument());
    // Not waited for: by the time the failure is gone from the page, the steps are queued too.
    await expect(steps().at(-1)).toHaveTextContent('Queued');
    await expect(steps().at(-1)).not.toHaveTextContent('ocrmypdf exited with code 2');
  },
};

/**
 * A finished document can be run again, with OCR switched on: the page sends exactly that, and
 * the request is the subject, so it is checked through the resolver's arguments.
 */
export const Reprocessing: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: { document: () => document({}), serverConfig: serverConfig({ ocrAvailable: true }) },
        Mutation: {
          reprocessDocument: (_parent: unknown, args: { id: string; ocr: boolean }) => {
            reprocessCalls.push(args);
            return document({ status: DocumentStatusEnum.Uploaded, ocrRequested: args.ocr });
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    reprocessCalls.length = 0;
    await userEvent.click(await canvas.findByRole('button', { name: 'Re-run processing' }));
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Re-run processing' }),
    );
    const ocr = dialog.getByRole('switch', { name: /Run OCR/ });
    // Enabled once the server has said it can OCR.
    await waitFor(() => expect(ocr).toBeEnabled());
    await userEvent.click(ocr);
    await userEvent.click(dialog.getByRole('button', { name: 'Re-run' }));
    await waitFor(() => expect(reprocessCalls).toEqual([{ id: ID, ocr: true }]));
  },
};

const reprocessCalls: { id: string; ocr: boolean }[] = [];

/** A re-run the server refuses closes the dialog and says why on the page. */
export const ReprocessRefused: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: { document: () => document({}), serverConfig: serverConfig({ ocrAvailable: false }) },
        Mutation: { reprocessDocument: refuse },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Re-run processing' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Re-run processing' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Re-run' }));
    await expect(await canvas.findByText('Could not re-run processing')).toBeInTheDocument();
    await expect(canvas.getByText('The server is restarting')).toBeInTheDocument();
  },
};

/** While the pipeline is running there is nothing to re-run yet. */
export const ReprocessWhileProcessing: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ status: DocumentStatusEnum.Processing, mimeType: 'application/pdf' }),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    // The History tab says where to look while it runs.
    await expect(await canvas.findByRole('tab', { name: 'History Processing' })).toBeInTheDocument();
    // aria-disabled, not disabled: a Button with a hint keeps the tooltip that says why.
    const button = await canvas.findByRole('button', { name: 'Re-run processing' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAccessibleDescription('Already processing');
    await userEvent.click(button);
    await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).not.toBeInTheDocument();
    // Nor is there anything for the vision model to read yet.
    await expect(canvas.queryByRole('button', { name: /vision model/ })).not.toBeInTheDocument();
  },
};

/** A delete the server refuses leaves the reader on the document, told why it is still there. */
export const DeleteRefused: Story = {
  parameters: {
    apolloClient: {
      resolvers: { Query: { document: () => document({}) }, Mutation: { deleteDocument: refuse } },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog', {
      name: 'Move this document to the trash?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }));
    await expect(await canvas.findByText('Could not delete this document')).toBeInTheDocument();
    // Found, not got: the page is hidden from the tree until the dialog has finished closing.
    await expect(await canvas.findByRole('heading', { level: 1 })).toBeInTheDocument();
  },
};

let trashed = false;

/**
 * A delete lands on the list without the document. The list's refetch never answers here, so
 * the row can only be gone because the page took it out of the cache before navigating.
 */
export const DeletedFromTheList: Story = {
  beforeEach: () => {
    trashed = false;
  },
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => (trashed ? null : document({})),
          folders: () => [],
          documents: () =>
            trashed
              ? new Promise(() => undefined)
              : [
                  {
                    id: ID,
                    title: 'Lease agreement',
                    folderId: null,
                    sizeBytes: 48_211,
                    status: DocumentStatusEnum.Ready,
                  },
                  {
                    id: clientId(),
                    title: 'Utility bill',
                    folderId: null,
                    sizeBytes: 12_004,
                    status: DocumentStatusEnum.Ready,
                  },
                ],
          trash: () => ({ count: 1, retentionDays: 30, documents: [] }),
        },
        Mutation: {
          deleteDocument: () => {
            trashed = true;
            return true;
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog', {
      name: 'Move this document to the trash?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }));
    const list = await canvas.findByRole('list', { name: 'Archive' });
    await expect(within(list).getByText('Utility bill')).toBeInTheDocument();
    await expect(within(list).queryByText('Lease agreement')).not.toBeInTheDocument();
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

/**
 * The date read from the text is shown with where it came from, and clearing it in its dialog
 * makes it the user's: the card says so once the mutation answers.
 */
export const ClearingTheDate: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ documentDate: '2025-03-12', documentDateSource: FieldSourceEnum.Extracted }),
        },
        Mutation: {
          setDocumentDate: (_parent: unknown, args: { date?: string | null }) =>
            document({ documentDate: args.date ?? null, documentDateSource: FieldSourceEnum.User }),
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByText('Read from the text')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Edit the document date' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Document date' }));
    await userEvent.click(dialog.getByRole('button', { name: /Date/ }));
    await userEvent.click(await page.findByRole('button', { name: 'Clear' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(await canvas.findByText('Set by you')).toBeInTheDocument();
  },
};

/**
 * A receipt read from the text is edited in its dialog, and the card shows what the server kept,
 * now marked as the user's.
 */
export const EditingTheReceipt: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () =>
            document({
              vendor: 'REWE',
              total: '9.99',
              currency: 'EUR',
              receiptSource: FieldSourceEnum.Extracted,
            }),
        },
        Mutation: {
          setDocumentReceipt: (
            _parent: unknown,
            args: { input: { vendor?: string | null; total?: string | null; currency?: string | null } },
          ) =>
            document({
              vendor: args.input.vendor ?? null,
              total: args.input.total ?? null,
              currency: args.input.currency ?? null,
              receiptSource: FieldSourceEnum.User,
            }),
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByText(/Read from the text\. Check it/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Edit receipt details' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Receipt details' }));
    const vendor = dialog.getByRole('textbox', { name: /Vendor/ });
    await userEvent.clear(vendor);
    await userEvent.type(vendor, 'REWE Markt');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(await canvas.findByText('Set by you.')).toBeInTheDocument();
    await expect(canvas.getByText('REWE Markt')).toBeInTheDocument();
  },
};

/** Every `resetDocumentMetadata` the page sent, by its `fields`, for the stories below to read. */
function resetServer() {
  const resets: string[][] = [];
  const edited = {
    documentDate: '2020-01-01',
    documentDateSource: FieldSourceEnum.User,
    vendor: 'Mine',
    total: '1.00',
    currency: 'EUR',
    receiptSource: FieldSourceEnum.User,
  };
  const resolvers = {
    Query: { document: () => document(edited) },
    Mutation: {
      resetDocumentMetadata: (_parent: unknown, args: { fields: string[] }) => {
        resets.push(args.fields);
        return document({
          ...edited,
          ...(args.fields.includes('DATE')
            ? { documentDate: '2025-03-12', documentDateSource: FieldSourceEnum.Extracted }
            : {}),
          ...(args.fields.includes('RECEIPT')
            ? { vendor: 'REWE', total: '9.99', currency: 'EUR', receiptSource: FieldSourceEnum.Extracted }
            : {}),
        });
      },
    },
  };
  return { resets, resolvers };
}

const resettingTheDate = resetServer();

/**
 * A date the user set can be handed back: after the confirm, the page asks for the date alone
 * and the card says it was read from the text, while the receipt stays the user's.
 */
export const ResettingTheDate: Story = {
  parameters: { apolloClient: { resolvers: resettingTheDate.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset the document date to automatic' }));
    const dialog = within(await page.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Reset' }));

    await expect(await canvas.findByText('Read from the text')).toBeInTheDocument();
    await expect(resettingTheDate.resets).toEqual([['DATE']]);
    await expect(canvas.getByText('Set by you.')).toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: 'Reset the document date to automatic' }),
    ).not.toBeInTheDocument();
  },
};

const resettingTheReceipt = resetServer();

/** The receipt resets on its own, asking for the receipt alone, and the date stays the user's. */
export const ResettingTheReceipt: Story = {
  parameters: { apolloClient: { resolvers: resettingTheReceipt.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset receipt details to automatic' }));
    const dialog = within(await page.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Reset' }));

    await expect(await canvas.findByText(/Read from the text\. Check it/)).toBeInTheDocument();
    await expect(resettingTheReceipt.resets).toEqual([['RECEIPT']]);
    await expect(canvas.getByText('REWE')).toBeInTheDocument();
    await expect(canvas.getByText('Set by you')).toBeInTheDocument();
  },
};

const HOME = { id: '6b3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: 'Home', parentId: null };

/**
 * The page names the folder the document is in, and "Move" opens the same dialog the tree's menu
 * does, its picker filled only once it is open.
 */
export const MovingToAFolder: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: { document: () => document({}), folders: () => [HOME] },
        Mutation: {
          moveDocument: (_parent: unknown, args: { folderId?: string | null }) =>
            document({ folderId: args.folderId ?? null, folder: args.folderId ? HOME : null }),
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Move to a folder' }));
    const dialog = within(await page.findByRole('dialog', { name: 'Move “Lease agreement”' }));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await page.findByRole('option', { name: 'Home' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Move' }));

    await expect(await canvas.findByText(/In Home/)).toBeInTheDocument();
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

const LONG_TEXT = Array.from({ length: 200 }, (_, line) => `Clause ${line + 1}. The tenant keeps the garden.`).join(
  '\n',
);
/** How close to the window's bottom the card ends: the body's own padding under it. */
const BODY_PADDING_PX = 16;

/**
 * On a wide screen the text card runs to the bottom of the window and its text scrolls inside it,
 * rather than the card stopping at a fixed height with the page empty under it.
 */
export const TextFillsTheWindow: Story = {
  globals: { viewport: { value: 'desktop' } },
  parameters: {
    router: { initialEntries: [`${documentPath(ID)}?tab=text`] },
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ contentKey: 'text/lease.txt', contentBytes: LONG_TEXT.length }),
          documentFileUrl: () => textUrl(LONG_TEXT),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const text = await canvas.findByRole('region', { name: 'Extracted text' });
    await waitFor(() => expect(text.scrollHeight).toBeGreaterThan(text.clientHeight));
    const card = text.closest('[data-slot="card-layout"]');
    const bottom = card?.getBoundingClientRect().bottom ?? 0;
    await expect(bottom).toBeGreaterThan(window.innerHeight - BODY_PADDING_PX * 2);
    await expect(bottom).toBeLessThanOrEqual(window.innerHeight);
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

const EARLIER_ID = '5c4b3a29-1807-4f6e-8d5c-4b3a29180716';
const TAXES = { id: '7d1e0c55-8a2b-4f3c-9d4e-5f6a7b8c9d0e', name: 'Taxes', parentId: null, mcpEnabled: false };
const deleted: string[] = [];

/**
 * The reader already has this file. The page says where the other copy is, by its path in the
 * archive, and offers to delete this one through the same delete the header has.
 */
export const Duplicate: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({}),
          documentDuplicates: () => [
            {
              document: document({}),
              checked: true,
              duplicates: [{ id: EARLIER_ID, title: 'Lease agreement', folderId: TAXES.id }],
            },
          ],
          folders: () => [TAXES],
          documents: () => [],
        },
        Mutation: {
          deleteDocument: (_parent: unknown, args: { id: string }) => {
            deleted.push(args.id);
            return true;
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    deleted.length = 0;
    const title = await canvas.findByText('You already have this file');
    const alert = title.closest<HTMLElement>('[data-slot="alert"]');
    if (alert === null) {
      throw new Error('The duplicate warning is not an alert');
    }
    await expect(alert).toHaveAttribute('role', 'status');
    const other = await within(alert).findByRole('link', { name: 'Taxes/Lease agreement' });
    await expect(other).toHaveAttribute('href', documentPath(EARLIER_ID));

    await userEvent.click(within(alert).getByRole('button', { name: 'Delete this copy' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog', {
      name: 'Move this copy to the trash?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(deleted).toEqual([ID]));
  },
};

/** The only copy of a file draws no warning. */
export const NotADuplicate: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({}),
          documentDuplicates: () => [{ document: document({}), checked: true, duplicates: [] }],
          folders: () => [],
          documents: () => [],
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Lease agreement' })).toBeInTheDocument();
    await expect(canvas.queryByText('You already have this file')).not.toBeInTheDocument();
  },
};

const SCAN = () =>
  document({
    title: 'Electricity bill',
    originalFilename: 'bill.pdf',
    mimeType: 'application/pdf',
    ocrRequested: true,
    contentKey: 'text/bill.txt',
    contentBytes: TEXT.length,
    processingSteps: [
      step({ step: 'inspect' }),
      step({ step: 'ocr' }),
      step({ step: 'vision', status: StepStatusEnum.Skipped }),
      step({ step: 'index' }),
    ],
  });

/**
 * A PDF opens on its preview. Each tab is a link that keeps itself in the query string, so the
 * tab survives a reload or a shared link, and the receipt and details stay beside every one.
 */
export const SwitchingTabs: Story = {
  parameters: {
    apolloClient: {
      resolvers: { Query: { document: SCAN, documentFileUrl: () => textUrl(TEXT), serverConfig: serverConfig() } },
    },
  },
  play: async ({ canvas }) => {
    const preview = await canvas.findByRole('tab', { name: 'Preview' });
    await expect(preview).toHaveAttribute('aria-selected', 'true');
    await expect(await canvas.findByTitle('Document preview')).toBeInTheDocument();

    const text = await openTab(canvas, 'Text');
    await expect(text).toHaveAttribute('href', expect.stringContaining('?tab=text'));
    await expect(canvas.getByTestId('search')).toHaveTextContent('?tab=text');
    await expect(await canvas.findByText(TEXT)).toBeInTheDocument();
    await expect(canvas.queryByTitle('Document preview')).not.toBeInTheDocument();

    await openTab(canvas, 'History');
    await expect(canvas.getByTestId('search')).toHaveTextContent('?tab=history');
    await expect(canvas.getByRole('heading', { level: 2, name: 'Pipeline' })).toBeInTheDocument();
    await expect(canvas.queryByText(TEXT)).not.toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
  },
};

/** A link with `?tab=history` opens on the timeline: every step by name, the vision one included. */
export const OpenedOnHistory: Story = {
  parameters: {
    router: { initialEntries: [`${documentPath(ID)}?tab=history`] },
    apolloClient: {
      resolvers: { Query: { document: SCAN, documentFileUrl: () => textUrl(TEXT), serverConfig: serverConfig() } },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    const list = canvas.getByRole('list', { name: 'Pipeline steps' });
    const rows = within(list).getAllByRole('listitem');
    const labels = ['Inspect', 'OCR', 'Vision model', 'Search index'];
    await expect(rows).toHaveLength(labels.length);
    for (const [index, label] of labels.entries()) {
      await expect(rows[index]).toHaveTextContent(new RegExp(`^${label}`));
    }
    await expect(rows[2]).toHaveTextContent('No vision model is set up, or it was not asked for');
    await expect(rows[2]).toHaveTextContent('Skipped');
  },
};

/** An ebook has no preview: there is no tab for one, and a link to it lands on the text. */
export const EbookOpensOnText: Story = {
  parameters: {
    router: { initialEntries: [`${documentPath(ID)}?tab=preview`] },
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ mimeType: 'application/epub+zip', originalFilename: 'storm.epub' }),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.queryByRole('tab', { name: 'Preview' })).not.toBeInTheDocument();
    // An ebook has its text already: there are no pages for the vision model to look at.
    await expect(canvas.queryByRole('button', { name: /vision model/ })).not.toBeInTheDocument();
  },
};

const visionCalls: string[] = [];

/**
 * With a vision model set up, a PDF can be read with it. The page sends the document's id, and
 * the document, queued again, marks the History tab while it runs.
 */
export const ReadingWithVision: Story = {
  parameters: {
    apolloClient: {
      resolvers: (() => {
        let status: DocumentStatusEnum = DocumentStatusEnum.Ready;
        return {
          Query: {
            document: () => ({ ...SCAN(), status }),
            documentFileUrl: () => textUrl(TEXT),
            serverConfig: serverConfig({ visionAvailable: true }),
          },
          Mutation: {
            readDocumentWithVision: (_parent: unknown, args: { id: string }) => {
              visionCalls.push(args.id);
              status = DocumentStatusEnum.Uploaded;
              return { ...SCAN(), status, visionRequested: true };
            },
          },
        };
      })(),
    },
  },
  play: async ({ canvas }) => {
    visionCalls.length = 0;
    await userEvent.click(await canvas.findByRole('button', { name: 'Read with vision model' }));
    await waitFor(() => expect(visionCalls).toEqual([ID]));
    await expect(await canvas.findByRole('tab', { name: 'History Processing' })).toBeInTheDocument();
    // Queued again, so it is no longer something to start.
    await expect(canvas.queryByRole('button', { name: /vision model/ })).not.toBeInTheDocument();
  },
};

const PAGES = 12;
const PAGES_READ = 2;

/**
 * The vision model partway through a scan: the History tab says which page it is on, so it can be
 * followed from the preview, and the step's row says it again with a bar.
 */
export const ReadingPages: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => ({
            ...SCAN(),
            status: DocumentStatusEnum.Processing,
            processingSteps: [
              step({ step: 'inspect' }),
              step({ step: 'ocr' }),
              step({
                step: 'vision',
                status: StepStatusEnum.Running,
                finishedAt: null,
                progressDone: PAGES_READ,
                progressTotal: PAGES,
              }),
              step({ step: 'index', status: StepStatusEnum.Queued, finishedAt: null }),
            ],
          }),
          documentFileUrl: () => textUrl(TEXT),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('tab', { name: 'History Page 3/12' })).toBeInTheDocument();

    await openTab(canvas, 'History');
    const rows = within(canvas.getByRole('list', { name: 'Pipeline steps' })).getAllByRole('listitem');
    await expect(rows[2]).toHaveTextContent('Page 3 of 12');
    const bar = within(rows[2]).getByRole('progressbar', { name: 'Vision model progress' });
    await expect(bar).toHaveAttribute('aria-valuenow', String(PAGES_READ));
    await expect(bar).toHaveAttribute('aria-valuemax', String(PAGES));
    await expect(bar).toHaveAttribute('aria-valuetext', 'Page 3 of 12');
  },
};

/** A document the vision model has read before says the button would read it again. */
export const ReadAgainWithVision: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => ({ ...SCAN(), mimeType: 'image/png', visionRequested: true }),
          documentFileUrl: () => textUrl(TEXT),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Read again with vision model' })).toBeInTheDocument();
  },
};

/** A vision read the server refuses is said on the page, as a refused re-run is. */
export const VisionRefused: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: SCAN,
          documentFileUrl: () => textUrl(TEXT),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
        Mutation: { readDocumentWithVision: refuse },
      },
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Read with vision model' }));
    await expect(await canvas.findByText('Could not read this document with the vision model')).toBeInTheDocument();
    await expect(canvas.getByText('The server is restarting')).toBeInTheDocument();
  },
};

/** No vision model set up: a PDF is offered no vision read at all, not a button that fails. */
export const VisionUnavailable: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: { document: SCAN, documentFileUrl: () => textUrl(TEXT), serverConfig: serverConfig() },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Re-run processing' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /vision model/ })).not.toBeInTheDocument();
  },
};

/** Markdown is text already, so even with a vision model there is nothing for it to look at. */
export const MarkdownHasNoVision: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          document: () => document({ mimeType: 'text/markdown', originalFilename: 'notes.md' }),
          serverConfig: serverConfig({ visionAvailable: true }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Re-run processing' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /vision model/ })).not.toBeInTheDocument();
  },
};
