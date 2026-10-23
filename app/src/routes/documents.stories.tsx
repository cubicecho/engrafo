import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
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
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search documents' }), 'rent');

    const results = await canvas.findByRole('list', { name: 'Documents matching “rent”' });
    const rows = within(results).getAllByRole('listitem');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('Lease agreement');
    await expect(rows[0]).toHaveTextContent('950 EUR on the first day');
    // A hit on the title alone shows which file it is instead of an empty line.
    await expect(rows[1]).toHaveTextContent('receipts.pdf');
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
