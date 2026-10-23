import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FieldSourceEnum as FieldSource } from '@/__generated__/graphql';
import { DocumentReceiptCard } from './document-receipt-card';

/** The receipt card: filled in by the pipeline, by the user, or not a receipt at all. */
const meta = {
  title: 'Domain/DocumentReceiptCard',
  component: DocumentReceiptCard,
  parameters: { layout: 'padded' },
  args: {
    vendor: 'REWE Markt GmbH',
    total: '12.67',
    currency: 'EUR',
    source: FieldSource.Extracted,
    onEdit: fn(),
    onReset: fn(),
  },
} satisfies Meta<typeof DocumentReceiptCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What the pipeline read, said as a guess to check, with the total as money. */
export const Extracted: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Receipt' })).toBeInTheDocument();
    await expect(canvas.getByText(/Read from the text/)).toBeInTheDocument();
    const [vendor, total] = canvas.getAllByRole('definition');
    await expect(vendor).toHaveTextContent('REWE Markt GmbH');
    await expect(total).toHaveTextContent('12.67');
    await expect(total).toHaveTextContent('€');

    await userEvent.click(canvas.getByRole('button', { name: 'Edit receipt details' }));
    await expect(args.onEdit).toHaveBeenCalledOnce();
    // Already automatic: there is nothing to hand back.
    await expect(canvas.queryByRole('button', { name: /Reset receipt/ })).not.toBeInTheDocument();
  },
};

/** One the user filled in can be handed back to be read from the text again, once confirmed. */
export const SetByTheUser: Story = {
  args: { source: FieldSource.User },
  play: async ({ args, canvas, canvasElement }) => {
    await expect(canvas.getByText('Set by you.')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Reset receipt details to automatic' }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('alertdialog'));
    await expect(args.onReset).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Reset' }));
    await expect(args.onReset).toHaveBeenCalledOnce();
  },
};

/** An amount with no currency is drawn as it was written, not guessed into one. */
export const NoCurrency: Story = {
  args: { vendor: "Joe's Diner", total: '20.86', currency: null, source: FieldSource.User },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Set by you.')).toBeInTheDocument();
    const [, total] = canvas.getAllByRole('definition');
    await expect(total).toHaveTextContent(/^20\.86$/);
  },
};

/** Most documents are not receipts: one line and an Add, not a card of dashes. */
export const NotAReceipt: Story = {
  args: { vendor: null, total: null, currency: null, source: null },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText(/Not a receipt/)).toBeInTheDocument();
    await expect(canvas.queryByRole('definition')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Add receipt details' }));
    await expect(args.onEdit).toHaveBeenCalledOnce();
  },
};
