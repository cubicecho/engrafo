import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RenameDocumentDialog } from './rename-document-dialog';

/**
 * The rename dialog on its own, with the mutation stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */
const meta = {
  title: 'Domain/RenameDocumentDialog',
  component: RenameDocumentDialog,
  parameters: { layout: 'centered' },
  args: { title: 'Lease agreement', onRename: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof RenameDocumentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function findDialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Rename document' });
}

/** Opens on the title as it stands, with a Save and a Cancel. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('textbox', { name: /Title/ })).toHaveValue('Lease agreement');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  },
};

/** What is saved is what was typed without the spaces around it, and saving closes the dialog. */
export const SavesTheTrimmedTitle: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    const title = dialog.getByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, '  Lease 2026  ');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(args.onRename).toHaveBeenCalledWith('Lease 2026');
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** A title of nothing but spaces is refused in the dialog, before anything is sent. */
export const RejectsABlankTitle: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    const title = dialog.getByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, '   ');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await expect(await dialog.findByText('Give the document a title')).toBeInTheDocument();
    await expect(args.onRename).not.toHaveBeenCalled();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

/** Cancel with nothing typed leaves at once, and saves nothing. */
export const Cancels: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onRename).not.toHaveBeenCalled();
  },
};
