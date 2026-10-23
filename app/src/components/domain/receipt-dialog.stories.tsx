import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ReceiptDialog } from './receipt-dialog';

/**
 * The receipt dialog on its own, with the mutation stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */
const meta = {
  title: 'Domain/ReceiptDialog',
  component: ReceiptDialog,
  parameters: { layout: 'centered' },
  args: {
    receipt: { vendor: 'REWE', total: '9.99', currency: 'EUR' },
    onSave: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<typeof ReceiptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function findDialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Receipt details' });
}

/** Opens on the fields as they stand, and Save waits for a change. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('textbox', { name: /Vendor/ })).toHaveValue('REWE');
    await expect(dialog.getByRole('textbox', { name: /Total/ })).toHaveValue('9.99');
    await expect(dialog.getByRole('textbox', { name: /Currency/ })).toHaveValue('EUR');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/**
 * A European decimal comma is sent as a point, a code in lower case as upper, and a field emptied
 * as null: the server gets exactly what it stores.
 */
export const SavesWhatWasTyped: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await userEvent.clear(dialog.getByRole('textbox', { name: /Vendor/ }));
    const total = dialog.getByRole('textbox', { name: /Total/ });
    await userEvent.clear(total);
    await userEvent.type(total, '12,50');
    const currency = dialog.getByRole('textbox', { name: /Currency/ });
    await userEvent.clear(currency);
    await userEvent.type(currency, 'chf');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(args.onSave).toHaveBeenCalledWith({ vendor: null, total: '12.50', currency: 'CHF' });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** A total that is not an amount is refused in the dialog, before anything is sent. */
export const RejectsATotalThatIsNotAnAmount: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    const total = dialog.getByRole('textbox', { name: /Total/ });
    await userEvent.clear(total);
    await userEvent.type(total, 'twelve');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(await dialog.findByText('An amount such as 12.50')).toBeInTheDocument();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};
