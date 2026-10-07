import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { DocumentStatusEnum } from '@/__generated__/graphql';
import { type DocumentRow, DocumentsTable } from './documents-table';

/**
 * The archive's table, handed its rows.
 *
 * What the table decides is small and all of it is here: the title is the row's header and a
 * link to the document, the filename sits under it, and the status arrives as words.
 */

function row(overrides: Partial<DocumentRow>): DocumentRow {
  return {
    id: '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e',
    title: 'Untitled',
    originalFilename: 'untitled.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 482_113,
    status: DocumentStatusEnum.Ready,
    createdAt: '2026-09-02T11:04:00.000Z',
    ...overrides,
  };
}

const BILL_ID = '0a1b2c3d-0b41-4c8a-9e5b-1d2a3b4c5d01';

const meta = {
  title: 'Domain/DocumentsTable',
  component: DocumentsTable,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DocumentsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One row per document, in the order given, under the five columns. */
export const Mixed: Story = {
  args: {
    documents: [
      row({ id: BILL_ID, title: 'Electricity bill — August', originalFilename: 'bill-aug.pdf' }),
      row({
        id: '0a1b2c3d-0b41-4c8a-9e5b-1d2a3b4c5d02',
        title: 'Lease agreement',
        originalFilename: 'lease.pdf',
        status: DocumentStatusEnum.Processing,
      }),
    ],
  },
  play: async ({ canvas }) => {
    const table = within(canvas.getByRole('table', { name: 'Your documents, newest first' }));
    for (const name of ['Title', 'Type', 'Size', 'Status', 'Added']) {
      await expect(table.getByRole('columnheader', { name })).toBeInTheDocument();
    }

    const bill = table.getByRole('row', { name: /Electricity bill — August/ });
    await expect(within(bill).getByRole('link', { name: 'Electricity bill — August' })).toHaveAttribute(
      'href',
      `/documents/${BILL_ID}`,
    );
    await expect(bill).toHaveTextContent('bill-aug.pdf');
    await expect(within(bill).getByRole('cell', { name: 'application/pdf' })).toBeInTheDocument();
    await expect(within(bill).getByRole('cell', { name: 'Ready' })).toBeInTheDocument();

    const lease = table.getByRole('row', { name: /Lease agreement/ });
    await expect(within(lease).getByRole('cell', { name: 'Processing' })).toBeInTheDocument();
  },
};
