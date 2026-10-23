import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DocumentDateDialog } from './document-date-dialog';

/**
 * The document-date dialog on its own, with the mutation stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */
const meta = {
  title: 'Domain/DocumentDateDialog',
  component: DocumentDateDialog,
  parameters: { layout: 'centered' },
  args: { date: '2025-03-12', onSave: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof DocumentDateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function findDialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Document date' });
}

/** Opens on the date as it stands, and Save waits for a change. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('button', { name: /Date/ })).toHaveTextContent('2025');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/** Clearing the date saves null, which the server keeps as the user's choice, and closes. */
export const ClearsTheDate: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: /Date/ }));
    await userEvent.click(await body.findByRole('button', { name: 'Clear' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(args.onSave).toHaveBeenCalledWith(null);
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** Picking a day saves it as that calendar day, whatever the reader's time zone. */
export const PicksADay: Story = {
  args: { date: null },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: /Date/ }));
    const grid = within(await body.findByRole('grid'));
    await userEvent.click(grid.getAllByRole('button', { name: /15/ })[0] as HTMLElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(args.onSave).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-15$/));
  },
};

/** A refusal is said in the dialog, which stays open. */
export const SaysWhyTheServerRefused: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error('Document not found');
    }),
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: /Date/ }));
    await userEvent.click(await body.findByRole('button', { name: 'Clear' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(await dialog.findByText('Document not found')).toBeInTheDocument();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};
