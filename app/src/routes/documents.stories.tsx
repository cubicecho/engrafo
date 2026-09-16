import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
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

const SERVER_CONFIG = {
  version: '1.4.2',
  maxUploadBytes: 100 * 1024 * 1024,
  acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'],
  ocrAvailable: true,
  ocrDefault: true,
};

function document(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    originalFilename: 'untitled.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 482_113,
    status: 'ready',
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
  parameters: { layout: 'fullscreen', router: { initialEntries: ['/'] } },
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
            document({ title: 'Lease agreement', originalFilename: 'lease.pdf', status: 'processing' }),
            document({ title: 'Warranty', originalFilename: 'warranty.pdf', status: 'failed' }),
          ],
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: 'Electricity bill — August' })).toBeInTheDocument();
    await expect(canvas.getByText('Processing')).toBeInTheDocument();
    await expect(canvas.getByText('Failed')).toBeInTheDocument();
    // The upload panel is part of this page, not a separate screen: there is nowhere else to
    // add a document from.
    await expect(canvas.getByLabelText('Run OCR on new uploads')).toBeInTheDocument();
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
    await expect(await canvas.findByText('Could not load your documents')).toBeInTheDocument();
    await expect(canvas.getByText('Connection terminated unexpectedly')).toBeInTheDocument();
  },
};
