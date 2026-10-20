import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ReprocessDocumentDialog } from './reprocess-document-dialog';

/**
 * The re-run dialog on its own, with the mutation stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */
const meta = {
  title: 'Domain/ReprocessDocumentDialog',
  component: ReprocessDocumentDialog,
  parameters: { layout: 'centered' },
  args: { ocrRequested: false, ocrAvailable: true, onReprocess: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof ReprocessDocumentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function findDialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Re-run processing' });
}

/** Opens on the document's own setting; switching OCR on is what is sent, and starting closes it. */
export const TurnsOcrOn: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    const ocr = dialog.getByRole('switch', { name: /Run OCR/ });
    await expect(ocr).not.toBeChecked();
    await userEvent.click(ocr);
    await userEvent.click(dialog.getByRole('button', { name: 'Re-run' }));

    await expect(args.onReprocess).toHaveBeenCalledWith(true);
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** Left alone, it re-runs with the setting the document already had. */
export const KeepsTheSetting: Story = {
  args: { ocrRequested: true },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('switch', { name: /Run OCR/ })).toBeChecked();
    await userEvent.click(dialog.getByRole('button', { name: 'Re-run' }));
    await expect(args.onReprocess).toHaveBeenCalledWith(true);
  },
};

/** Without ocrmypdf the switch is off and says why, and the re-run goes ahead without OCR. */
export const OcrUnavailable: Story = {
  args: { ocrRequested: true, ocrAvailable: false },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('switch', { name: /Run OCR/ })).toBeDisabled();
    await expect(dialog.getByText('ocrmypdf is not installed on the server.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Re-run' }));
    await expect(args.onReprocess).toHaveBeenCalledWith(false);
  },
};

/** While the server has not said whether it can OCR, nothing can be started. */
export const CheckingOcr: Story = {
  args: { ocrAvailable: undefined },
  play: async ({ canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await expect(dialog.getByRole('button', { name: 'Re-run' })).toBeDisabled();
  },
};

/** Cancel starts nothing. */
export const Cancels: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await findDialog(canvasElement));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(args.onClose).toHaveBeenCalled();
    await expect(args.onReprocess).not.toHaveBeenCalled();
  },
};
