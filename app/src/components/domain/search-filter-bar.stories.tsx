import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { clientId } from '@/lib/id';
import { NO_FILTERS } from '@/lib/search-filters';
import { SearchFilterBar } from './search-filter-bar';

const TAXES = { id: clientId(), name: 'Taxes', parentId: null, mcpEnabled: false };
const YEAR = { id: clientId(), name: '2026', parentId: TAXES.id, mcpEnabled: false };

/** The search's filter bar, with the page's state stood in for by a spy. */
const meta = {
  title: 'Domain/SearchFilterBar',
  component: SearchFilterBar,
  parameters: { layout: 'padded' },
  args: { folders: [TAXES, YEAR], value: { ...NO_FILTERS }, onValueChange: fn() },
} satisfies Meta<typeof SearchFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing narrowed: every control says "any", and there is nothing to clear. */
export const Unfiltered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('Any folder');
    await expect(canvas.getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Any kind');
    await expect(canvas.getByRole('switch', { name: 'Receipts only' })).not.toBeChecked();
    await expect(canvas.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  },
};

/** Choosing a kind narrows to it, and the other filters are kept as they were. */
export const PicksAKind: Story = {
  args: { value: { ...NO_FILTERS, receiptsOnly: true } },
  play: async ({ args, canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: 'Kind' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'Image' }));
    await expect(args.onValueChange).toHaveBeenCalledWith({ ...NO_FILTERS, receiptsOnly: true, kind: 'IMAGE' });
    // The select hides the rest of the page while it is open; wait for it to give it back.
    await waitFor(() => expect(canvas.getByRole('combobox', { name: 'Folder' })).not.toHaveAttribute('aria-hidden'));
  },
};

/** A folder is chosen by its path; "Any folder" puts it back. */
export const PicksAFolder: Story = {
  play: async ({ args, canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'Taxes/2026' }));
    await expect(args.onValueChange).toHaveBeenCalledWith({ ...NO_FILTERS, folderId: YEAR.id });
  },
};

/** Receipts only is a switch, and Clear filters takes every filter off at once. */
export const ClearsEverything: Story = {
  args: { value: { ...NO_FILTERS, kind: 'PDF', from: '2026-01-01', to: '2026-03-31' } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('switch', { name: 'Receipts only' }));
    await expect(args.onValueChange).toHaveBeenLastCalledWith({
      ...NO_FILTERS,
      kind: 'PDF',
      from: '2026-01-01',
      to: '2026-03-31',
      receiptsOnly: true,
    });
    await expect(canvas.getByRole('button', { name: /Dated/ })).toHaveTextContent('2026');

    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }));
    await expect(args.onValueChange).toHaveBeenLastCalledWith(NO_FILTERS);
  },
};
