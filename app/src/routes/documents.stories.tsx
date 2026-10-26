import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ROUTES } from '@/lib/routes';
import { archiveServer, document, EMPTY_FOLDER, SERVER_CONFIG, TAXES, YEAR } from '../../.storybook/archive.ts';
import { DocumentsRoute } from './documents';

/**
 * The archive's front page: the upload panel and search. The tree is in the sidebar
 * (`ArchiveSidebarSection`, whose stories drive it); here it is drawn only on a phone.
 *
 * Mocked through the SDL rather than through canned responses, because the query it makes is
 * the one most exposed to the database: `documents(orderBy: …, limit: 200)` and its filter
 * arguments are generated from the Drizzle models by `drizzle-graphql`, so the shape of that
 * call changes without anyone editing this app. Executing it against the printed schema is what
 * turns that into a failing story instead of a blank tree.
 */

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

/** The page itself: the upload panel. The tree beside it is the sidebar's, not this page's. */
export const WithDocuments: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({
        folders: [TAXES, YEAR, EMPTY_FOLDER],
        documents: [
          document({ title: 'Electricity bill — August' }),
          document({ title: 'Tax return', folderId: YEAR.id }),
        ],
      }),
    },
  },
  play: async ({ canvas }) => {
    // The upload panel is part of this page, not a separate screen: there is nowhere else to
    // add a document from.
    await expect(await canvas.findByRole('switch', { name: 'Run OCR on new uploads' })).toBeInTheDocument();
    // From `md` up the tree is the sidebar's, so this page draws none of its own.
    await expect(canvas.queryByRole('link', { name: /Electricity bill/ })).not.toBeInTheDocument();
  },
};

/** On a phone the sidebar is a bar, so the tree comes back onto this page, under the upload panel. */
export const WithDocumentsOnAPhone: Story = {
  ...WithDocuments,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: /Electricity bill — August/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /^Taxes/ })).toBeVisible();
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

/** "New folder" in the header makes a folder at the top level, and a taken name is refused there. */
export const RefusesATakenFolderName: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [TAXES], documents: [] }) },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'New folder' }));

    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New folder' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'taxes');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await expect(await dialog.findByRole('alert')).toHaveTextContent('Something called "taxes" is already there.');
  },
};

const exported: Array<Record<string, unknown>> = [];

/**
 * "Export receipts" in the header asks the server for the CSV with what the dialog was given,
 * and closes once the file is saved.
 */
export const ExportingReceipts: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        ...archiveServer({ folders: [TAXES, YEAR], documents: [] }),
        Query: {
          ...archiveServer({ folders: [TAXES, YEAR], documents: [] }).Query,
          receiptsCsv: (_parent: unknown, args: Record<string, unknown>) => {
            exported.push(args);
            return 'date,vendor,total,currency,title,folder\r\n';
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    exported.length = 0;
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Export receipts' }));
    const dialog = await page.findByRole('dialog', { name: 'Export receipts' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await page.findByRole('option', { name: 'Taxes' }));
    // The select's popover hides the rest of the page until it has closed.
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(exported).toEqual([expect.objectContaining({ folderId: TAXES.id })]);
  },
};

/** Before the archive is in: a loading state, not "No documents yet" for an archive that has some. */
export const Loading: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({ folders: [], documents: [document({ title: 'Tax return' })] }),
      delay: 100_000,
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await expect(canvas.queryByText('No documents yet')).not.toBeInTheDocument();
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
      mimeType: 'application/pdf',
      createdAt: '2026-09-02T11:04:00.000Z',
      documentDate: '2024-05-01',
    },
  },
  {
    score: 0.01,
    snippet: '',
    document: {
      ...document({ title: 'Rent receipts 2026' }),
      originalFilename: 'receipts.pdf',
      mimeType: 'text/csv',
      createdAt: '2026-09-02T11:04:00.000Z',
    },
  },
];

/** A one-pixel grey PNG, standing in for a presigned thumbnail URL. */
const THUMBNAIL_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==';

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
          documentThumbnailUrls: (_parent: unknown, args: { ids: string[] }) =>
            args.ids
              .filter((id) => id === SEARCH_HITS[0]?.document.id)
              .map((documentId) => ({ documentId, url: THUMBNAIL_URL })),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search documents' }), 'rent');

    const results = await canvas.findByRole('list', { name: 'Documents matching “rent”' });
    const rows = within(results).getAllByRole('listitem');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('Lease agreement');
    await expect(rows[0]).toHaveTextContent('950 EUR on the first day');
    // The date on the document is the one shown, when it has one, rather than the upload's.
    await expect(rows[0]).toHaveTextContent('2024');
    await expect(rows[1]).toHaveTextContent('2026');
    // A hit on the title alone shows which file it is instead of an empty line.
    await expect(rows[1]).toHaveTextContent('receipts.pdf');
    // The first page's picture where there is one, asked for once for the whole list; a type icon
    // where there is none.
    await waitFor(() => expect(rows[0]?.querySelector('img')).toHaveAttribute('src', THUMBNAIL_URL));
    await expect(rows[0]?.querySelector('img')).toHaveAttribute('loading', 'lazy');
    await expect(rows[1]?.querySelector('img')).toBeNull();
  },
};

const searchedWith: Array<Record<string, unknown> | null> = [];

/**
 * Read from the URL, the filters go to the server with the query; changing one asks again with it.
 */
export const SearchingWithFilters: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=rent&receipts=1`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [TAXES],
          documents: () => [],
          searchDocuments: (_parent: unknown, args: { filter?: Record<string, unknown> | null }) => {
            searchedWith.push(args.filter ?? null);
            return SEARCH_HITS;
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('switch', { name: 'Receipts only' })).toBeChecked();
    await canvas.findByRole('list', { name: 'Documents matching “rent”' });
    // The first search may have gone out before this ran, so it is looked for rather than reset.
    await waitFor(() => expect(searchedWith.at(-1)).toMatchObject({ hasReceipt: true }));

    await userEvent.click(canvas.getByRole('combobox', { name: 'Kind' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'PDF' }));
    await waitFor(() => expect(searchedWith.at(-1)).toMatchObject({ hasReceipt: true, kinds: ['PDF'] }));
    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Folder' })).not.toHaveAttribute('aria-hidden'));
  },
};

/** With nothing typed and nothing narrowed, the filters are there and the page is the upload panel. */
export const FiltersWithoutASearch: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [], documents: [] }) },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('searchbox', { name: 'Search documents' })).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Receipts only' })).not.toBeChecked();
    await expect(await canvas.findByRole('switch', { name: 'Run OCR on new uploads' })).toBeInTheDocument();
  },
};

const browsedWith: Array<Record<string, unknown>> = [];
/** Two pages of receipts, the second shorter than the first, newest first as the server sends them. */
const RECEIPTS = ['2026-03-03', '2026-03-02', '2026-03-01'].map((documentDate, i) => ({
  ...document({ title: `Receipt ${i + 1}` }),
  originalFilename: `receipt-${i + 1}.pdf`,
  mimeType: 'application/pdf',
  createdAt: '2026-09-02T11:04:00.000Z',
  documentDate,
}));

/**
 * Filters with no search list every document that matches them, in place of the upload panel,
 * a page at a time: "Show more" asks for the next page and adds it under the first.
 */
export const BrowsingByFilter: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?receipts=1`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [TAXES],
          documents: () => [],
          browseDocuments: (_parent: unknown, args: { filter: Record<string, unknown>; offset: number }) => {
            browsedWith.push(args);
            // The page asks for 50; two rows stand in for a full page, so a second one follows.
            return args.offset === 0
              ? { hasMore: true, documents: RECEIPTS.slice(0, 2) }
              : { hasMore: false, documents: RECEIPTS.slice(2) };
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    const list = await canvas.findByRole('list', { name: 'Documents that match the filters' });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // The first page may have been asked for before this ran, so it is looked for rather than reset.
    await expect(browsedWith.at(-1)).toMatchObject({ filter: { hasReceipt: true }, offset: 0 });
    // Browsing replaces the upload panel, as a search does.
    await expect(canvas.queryByRole('switch', { name: 'Run OCR on new uploads' })).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(RECEIPTS.length));
    await expect(browsedWith.at(-1)).toMatchObject({ offset: 2 });
    await expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('Receipt 3');
    await expect(canvas.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  },
};

/** Filters that match nothing say so, and "Clear filters" goes back to the upload panel. */
export const BrowsingFindsNothing: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?kind=EBOOK`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => [],
          browseDocuments: () => ({ hasMore: false, documents: [] }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No document matches these filters.')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }));
    await expect(await canvas.findByRole('switch', { name: 'Run OCR on new uploads' })).toBeInTheDocument();
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

const savedWith: Array<Record<string, unknown>> = [];

/**
 * A search with filters can be saved under a name, which starts as the search text. What is saved
 * is what the page is showing: the text and the filters as they go to the server.
 */
export const SavingASearch: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=rent&receipts=1`] },
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          folders: () => [],
          documents: () => [],
          searchDocuments: () => SEARCH_HITS,
          documentThumbnailUrls: () => [],
          savedSearches: () => [],
        },
        Mutation: {
          saveSearch: (_parent: unknown, args: Record<string, unknown>) => {
            savedWith.push(args);
            return { id: '00000000-0000-4000-8000-00000000005a' };
          },
        },
      },
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save search' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Save search' });
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    await expect(name).toHaveValue('rent');
    await userEvent.clear(name);
    await userEvent.type(name, 'Rent receipts');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(savedWith.at(-1)).toMatchObject({ name: 'Rent receipts', query: 'rent', filter: { hasReceipt: true } }),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

/** With nothing typed and nothing narrowed there is nothing to save, so there is no button. */
export const NothingToSave: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [], documents: [] }) },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('searchbox', { name: 'Search documents' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Save search' })).not.toBeInTheDocument();
  },
};
