import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DocumentStatusEnum, type DocumentsPageQuery } from '@/__generated__/graphql';
import { clientId } from '@/lib/id';
import { ROUTES } from '@/lib/routes';
import { DocumentsRoute } from './documents';

/**
 * The archive, which is the screen this app mostly is.
 *
 * Mocked through the SDL rather than through canned responses, because the query it makes is
 * the one most exposed to the database: `documents(orderBy: …, limit: 200)` and its filter
 * arguments are generated from the Drizzle models by `drizzle-graphql`, so the shape of that
 * call changes without anyone editing this app. Executing it against the printed schema is what
 * turns that into a failing story instead of a blank tree.
 */

const MAX_UPLOAD_BYTES = 104_857_600;

const SERVER_CONFIG = {
  version: '1.4.2',
  maxUploadBytes: MAX_UPLOAD_BYTES,
  acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'],
  ocrAvailable: true,
  ocrDefault: true,
};

type Document = DocumentsPageQuery['documents'][number];
type Folder = DocumentsPageQuery['folders'][number];

function document(overrides: Partial<Document>): Document {
  return {
    id: clientId(),
    title: 'Untitled',
    folderId: null,
    sizeBytes: 482_113,
    status: DocumentStatusEnum.Ready,
    ...overrides,
  };
}

const TAXES: Folder = { id: clientId(), name: 'Taxes', parentId: null };
const YEAR: Folder = { id: clientId(), name: '2026', parentId: TAXES.id };
const EMPTY_FOLDER: Folder = { id: clientId(), name: 'Receipts', parentId: null };

/**
 * A server that remembers: the folder and document writes change what the next read returns,
 * as the real one does, so a story can make a change and then see it in the tree.
 */
function archiveServer(start: { folders: Folder[]; documents: Document[] }) {
  const folders = [...start.folders];
  const documents = [...start.documents];
  const taken = (parentId: string | null, name: string) =>
    [
      ...folders.filter((f) => (f.parentId ?? null) === parentId).map((f) => f.name),
      ...documents.filter((d) => (d.folderId ?? null) === parentId).map((d) => d.title),
    ].some((n) => n.toLowerCase() === name.toLowerCase());
  return {
    Query: {
      serverConfig: () => SERVER_CONFIG,
      folders: () => folders,
      documents: () => documents,
    },
    Mutation: {
      createFolder: (_parent: unknown, args: { name: string; parentId?: string | null }) => {
        if (taken(args.parentId ?? null, args.name)) {
          throw new Error(`Something called "${args.name}" is already there.`);
        }
        const folder = { id: clientId(), name: args.name, parentId: args.parentId ?? null };
        folders.push(folder);
        return folder;
      },
      moveDocument: (_parent: unknown, args: { id: string; folderId?: string | null }) => {
        const doc = documents.find((d) => d.id === args.id);
        if (!doc) {
          throw new Error('Document not found');
        }
        doc.folderId = args.folderId ?? null;
        return doc;
      },
      deleteFolder: (_parent: unknown, args: { id: string }) => {
        folders.splice(
          folders.findIndex((f) => f.id === args.id),
          1,
        );
        return true;
      },
    },
  };
}

/** Bounded height, because `PageLayout` is a sticky chassis that scrolls its own body. */
function Framed() {
  return (
    <div className="h-screen">
      <DocumentsRoute />
    </div>
  );
}

const meta = {
  title: 'Routes/Documents',
  component: DocumentsRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.documents] } },
} satisfies Meta<typeof DocumentsRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A filed archive: folders nested in folders, an empty one, documents in them and at the top
 * level. Only a document that is not settled wears a status; a tree of "Ready" says nothing.
 */
export const WithDocuments: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({
        folders: [TAXES, YEAR, EMPTY_FOLDER],
        documents: [
          document({ title: 'Electricity bill — August' }),
          document({ title: 'Passport scan' }),
          document({ title: 'Tax return', folderId: YEAR.id }),
          document({ title: 'Lease agreement', status: DocumentStatusEnum.Processing }),
          document({ title: 'Warranty', status: DocumentStatusEnum.Failed }),
        ],
      }),
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: /Electricity bill — August/ })).toBeInTheDocument();
    // A folder is a button that folds what is under it; an empty one is still there to file into.
    await expect(canvas.getByRole('button', { name: /^Taxes/, expanded: true })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^Receipts/ })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /Tax return/ })).toBeInTheDocument();
    await expect(canvas.getByText('Processing')).toBeInTheDocument();
    await expect(canvas.getByText('Failed')).toBeInTheDocument();
    await expect(canvas.queryByText('Ready')).not.toBeInTheDocument();
    // The upload panel is part of this page, not a separate screen: there is nowhere else to
    // add a document from.
    await expect(canvas.getByRole('switch', { name: 'Run OCR on new uploads' })).toBeInTheDocument();
  },
};

/**
 * A new instance. The empty state has to be distinguishable from a failed query at a glance —
 * one of them means "upload something", the other means "your server is down".
 */
export const Empty: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({ folders: [], documents: [] }),
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No documents yet')).toBeInTheDocument();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
  },
};

/** "New folder" in the header asks for a name and the folder appears in the tree. */
export const CreatesAFolder: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [TAXES], documents: [] }) },
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /^Taxes/ });
    await userEvent.click(canvas.getByRole('button', { name: 'New folder' }));

    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New folder' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'Insurance');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await expect(await canvas.findByRole('button', { name: /^Insurance/ })).toBeInTheDocument();
  },
};

/** A name already beside it is refused by the server, and the dialog stays open saying so. */
export const RefusesATakenFolderName: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [TAXES], documents: [] }) },
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /^Taxes/ });
    await userEvent.click(canvas.getByRole('button', { name: 'New folder' }));

    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New folder' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'taxes');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await expect(await dialog.findByRole('alert')).toHaveTextContent('Something called "taxes" is already there.');
  },
};

/** "Move to…" in a row's menu is the way to move without dragging, and files the document there. */
export const MovesADocumentWithTheMenu: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({ folders: [TAXES, YEAR], documents: [document({ title: 'Tax return' })] }),
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Tax return' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Move to…' }));

    const dialog = within(await page.findByRole('dialog', { name: 'Move “Tax return”' }));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await page.findByRole('option', { name: 'Taxes/2026' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Move' }));

    // Now under 2026: inside the list that folder's row opens.
    await waitFor(() => {
      const year = canvas.getByRole('button', { name: /^2026/ }).closest('li');
      expect(year && within(year).queryByRole('link', { name: /Tax return/ })).toBeInTheDocument();
    });
  },
};

/** Deleting a folder takes what is in it, so the button stays locked until its name is typed. */
export const DeletesAFolderOnlyOnceNamed: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({
        folders: [TAXES, YEAR],
        documents: [document({ title: 'Tax return', folderId: YEAR.id })],
      }),
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Taxes' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Delete' }));

    const dialog = within(await page.findByRole('alertdialog'));
    await expect(dialog.getByText(/1 document and 1 folder/)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: 'Delete folder' });
    await expect(confirm).toBeDisabled();
    await userEvent.type(dialog.getByRole('textbox'), 'Taxes');
    await expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByRole('button', { name: /^Taxes/ })).not.toBeInTheDocument());
  },
};

/** The other empty-looking state, so the two can be compared side by side in the sidebar. */
export const Unreachable: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => {
            throw new Error('Connection terminated unexpectedly');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Could not load your documents');
    await expect(alert).toHaveTextContent('Connection terminated unexpectedly');
  },
};

const SEARCH_HITS = [
  {
    score: 0.03,
    snippet: '…the tenant shall pay the landlord 950 EUR on the first day of each month…',
    document: {
      ...document({ title: 'Lease agreement' }),
      originalFilename: 'lease.pdf',
      createdAt: '2026-09-02T11:04:00.000Z',
    },
  },
  {
    score: 0.01,
    snippet: '',
    document: {
      ...document({ title: 'Rent receipts 2026' }),
      originalFilename: 'receipts.pdf',
      createdAt: '2026-09-02T11:04:00.000Z',
    },
  },
];

/**
 * Typing searches: after a pause the box's text goes to `searchDocuments`, and the results take
 * the place of the upload panel and the table, each with the passage that matched.
 */
export const Searching: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => [document({ title: 'Electricity bill — August' })],
          searchDocuments: (_parent: unknown, args: { query: string }) => (args.query === 'rent' ? SEARCH_HITS : []),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: /Electricity bill — August/ })).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search documents' }), 'rent');

    const results = await canvas.findByRole('list', { name: 'Documents matching “rent”' });
    const rows = within(results).getAllByRole('listitem');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('Lease agreement');
    await expect(rows[0]).toHaveTextContent('950 EUR on the first day');
    // A hit on the title alone shows which file it is instead of an empty line.
    await expect(rows[1]).toHaveTextContent('receipts.pdf');
    await expect(canvas.queryByRole('list', { name: 'Documents and folders' })).not.toBeInTheDocument();
  },
};

/** A search that finds nothing says so, rather than showing an empty list. */
export const SearchFindsNothing: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=zebra`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => [],
          searchDocuments: () => [],
        },
      },
    },
  },
  play: async ({ canvas }) => {
    // Read from the URL, so a reload or Back lands on the same search.
    await expect(canvas.getByRole('searchbox', { name: 'Search documents' })).toHaveValue('zebra');
    await expect(await canvas.findByText('Nothing matches')).toBeInTheDocument();
  },
};

/** A search the server cannot answer is an error, never "nothing matches". */
export const SearchFails: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=lease`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => [],
          searchDocuments: () => {
            throw new Error('The search model could not be loaded');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('The search model could not be loaded');
    await expect(canvas.queryByText('Nothing matches')).not.toBeInTheDocument();
  },
};
