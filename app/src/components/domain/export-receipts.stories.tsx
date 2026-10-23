import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { clientId } from '@/lib/id';
import { ExportReceiptsDialog } from './export-receipts';

const TAXES = { id: clientId(), name: 'Taxes', parentId: null, mcpEnabled: false };
const YEAR = { id: clientId(), name: '2026', parentId: TAXES.id, mcpEnabled: false };

/**
 * The receipts export, with the query and the download stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */
const meta = {
  title: 'Domain/ExportReceiptsDialog',
  component: ExportReceiptsDialog,
  parameters: { layout: 'centered' },
  args: { folders: [TAXES, YEAR], onExport: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof ExportReceiptsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function findDialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Export receipts' });
}

/** Left as it opens, the export is every receipt there is. */
export const Everything: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: 'Download CSV' }));

    await expect(args.onExport).toHaveBeenCalledWith({ from: null, to: null, folderId: null });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** A folder is picked by its path, and the top level is not one of the choices. */
export const OneFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Folder' }));
    await expect(page.queryByRole('option', { name: /Top level/i })).not.toBeInTheDocument();
    await userEvent.click(await page.findByRole('option', { name: 'Taxes/2026' }));
    // The select's popover hides the rest of the page until it has closed.
    await userEvent.click(await dialog.findByRole('button', { name: 'Download CSV' }));

    await expect(args.onExport).toHaveBeenCalledWith({ from: null, to: null, folderId: YEAR.id });
  },
};

/** A failed export says why, and the dialog stays open to try again. */
export const Refused: Story = {
  args: {
    onExport: fn(async () => {
      throw new Error('The range ends before it starts.');
    }),
  },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: 'Download CSV' }));

    await expect(await dialog.findByText('The range ends before it starts.')).toBeInTheDocument();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};
