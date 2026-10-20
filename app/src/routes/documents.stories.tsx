import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
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
 * turns that into a failing story instead of a blank table.
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

function document(overrides: Partial<Document>): Document {
  return {
    id: clientId(),
    title: 'Untitled',
    originalFilename: 'untitled.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 482_113,
    status: DocumentStatusEnum.Ready,
    ocrRequested: true,
    createdAt: '2026-09-02T11:04:00.000Z',
    ...overrides,
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

/** A mixed archive — one of each status, which is how the badge column earns its width. */
export const WithDocuments: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
          documents: () => [
            document({ title: 'Electricity bill — August', originalFilename: 'bill-aug.pdf' }),
            document({ title: 'Passport scan', originalFilename: 'passport.png', mimeType: 'image/png' }),
            document({
              title: 'Lease agreement',
              originalFilename: 'lease.pdf',
              status: DocumentStatusEnum.Processing,
            }),
            document({ title: 'Warranty', originalFilename: 'warranty.pdf', status: DocumentStatusEnum.Failed }),
          ],
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: 'Electricity bill — August' })).toBeInTheDocument();
    await expect(canvas.getByRole('cell', { name: 'Processing' })).toBeInTheDocument();
    await expect(canvas.getByRole('cell', { name: 'Failed' })).toBeInTheDocument();
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
      resolvers: { Query: { serverConfig: () => SERVER_CONFIG, documents: () => [] } },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No documents yet')).toBeInTheDocument();
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
  },
};

/** The other empty-looking state, so the two can be compared side by side in the sidebar. */
export const Unreachable: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          serverConfig: () => SERVER_CONFIG,
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
    document: { ...document({ title: 'Lease agreement', originalFilename: 'lease.pdf' }), id: clientId() },
  },
  {
    score: 0.01,
    snippet: '',
    document: { ...document({ title: 'Rent receipts 2026', originalFilename: 'receipts.pdf' }), id: clientId() },
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
          documents: () => [document({ title: 'Electricity bill — August' })],
          searchDocuments: (_parent: unknown, args: { query: string }) => (args.query === 'rent' ? SEARCH_HITS : []),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: 'Electricity bill — August' })).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search documents' }), 'rent');

    const results = await canvas.findByRole('list', { name: 'Documents matching “rent”' });
    const rows = within(results).getAllByRole('listitem');
    await expect(rows).toHaveLength(2);
    await expect(rows[0]).toHaveTextContent('Lease agreement');
    await expect(rows[0]).toHaveTextContent('950 EUR on the first day');
    // A hit on the title alone shows which file it is instead of an empty line.
    await expect(rows[1]).toHaveTextContent('receipts.pdf');
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
  },
};

/** A search that finds nothing says so, rather than showing an empty list. */
export const SearchFindsNothing: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=zebra`] },
    apolloClient: {
      resolvers: {
        Query: { serverConfig: () => SERVER_CONFIG, documents: () => [], searchDocuments: () => [] },
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
