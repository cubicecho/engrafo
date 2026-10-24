import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Sidebar } from '@/components/sidebar';
import { ROUTES } from '@/lib/routes';
import { SavedSearchesSidebarSection } from './saved-searches';

/**
 * The saved searches, in the sidebar they live in under the archive's tree. Mocked through the SDL
 * with a server that remembers, so a rename or a delete shows in the list the way it would.
 */

interface Row {
  id: string;
  name: string;
  query: string | null;
  filters: Record<string, unknown>;
}

const RECEIPTS: Row = {
  id: '00000000-0000-4000-8000-000000000501',
  name: 'Receipts 2026',
  query: null,
  filters: { hasReceipt: true, dateFrom: '2026-01-01' },
};
const WARRANTIES: Row = {
  id: '00000000-0000-4000-8000-000000000502',
  name: 'Warranties',
  query: 'warranty',
  filters: {},
};

function savedSearchServer(start: Row[]) {
  const rows = start.map((row) => ({ ...row }));
  return {
    Query: { savedSearches: () => [...rows].sort((a, b) => a.name.localeCompare(b.name)) },
    Mutation: {
      renameSavedSearch: (_parent: unknown, args: { id: string; name: string }) => {
        if (rows.some((row) => row.id !== args.id && row.name.toLowerCase() === args.name.toLowerCase())) {
          throw new Error(`You already have a saved search called “${args.name}”.`);
        }
        const row = rows.find((candidate) => candidate.id === args.id);
        if (!row) {
          throw new Error('Saved search not found');
        }
        row.name = args.name;
        return row;
      },
      deleteSavedSearch: (_parent: unknown, args: { id: string }) => {
        rows.splice(
          rows.findIndex((row) => row.id === args.id),
          1,
        );
        return true;
      },
    },
  };
}

function Framed() {
  return (
    <div className="h-screen">
      <Sidebar className="w-80" contentSlot={<SavedSearchesSidebarSection />} />
    </div>
  );
}

const meta = {
  title: 'Domain/SavedSearchesSidebarSection',
  component: SavedSearchesSidebarSection,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.documents] } },
} satisfies Meta<typeof SavedSearchesSidebarSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Each saved search is a link to the documents page with its text and filters in the query string,
 * and the one the page is showing now is marked.
 */
export const Listed: Story = {
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=warranty`] },
    apolloClient: { resolvers: savedSearchServer([WARRANTIES, RECEIPTS]) },
  },
  play: async ({ canvas }) => {
    const receipts = await canvas.findByRole('link', { name: 'Receipts 2026' });
    await expect(receipts).toHaveAttribute('href', '/?from=2026-01-01&receipts=1');
    const warranties = canvas.getByRole('link', { name: 'Warranties' });
    await expect(warranties).toHaveAttribute('href', '/?q=warranty');
    await expect(warranties).toHaveAttribute('aria-current', 'page');
    await expect(receipts).not.toHaveAttribute('aria-current');
  },
};

/** None yet: one line on how to make one, rather than an empty heading. */
export const NoneSaved: Story = {
  parameters: { apolloClient: { resolvers: savedSearchServer([]) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Save a search to find it here.')).toBeInTheDocument();
  },
};

/** Renaming is a dialog; a name another saved search has is refused there, and the dialog stays. */
export const Renaming: Story = {
  parameters: { apolloClient: { resolvers: savedSearchServer([WARRANTIES, RECEIPTS]) } },
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Warranties' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await body.findByRole('dialog', { name: 'Rename saved search' });
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    // The menu hands focus back to its button as it finishes closing, and the dialog pulls it back
    // inside: keys typed while that settles are lost. So the name is typed until it is all there.
    const typeName = (text: string) =>
      waitFor(async () => {
        await userEvent.clear(name);
        await userEvent.type(name, text);
        await expect(name).toHaveValue(text);
      });

    await typeName('receipts 2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await expect(await within(dialog).findByText(/already have a saved search/)).toBeInTheDocument();

    await typeName('Guarantees');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(await canvas.findByRole('link', { name: 'Guarantees' })).toBeInTheDocument();
  },
};

/** Deleting asks first, and says the documents stay. */
export const Deleting: Story = {
  parameters: { apolloClient: { resolvers: savedSearchServer([WARRANTIES, RECEIPTS]) } },
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Receipts 2026' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await body.findByRole('alertdialog', { name: 'Delete “Receipts 2026”?' });
    await expect(dialog).toHaveTextContent('documents it finds are not touched');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(canvas.queryByRole('link', { name: 'Receipts 2026' })).not.toBeInTheDocument());
    await expect(canvas.getByRole('link', { name: 'Warranties' })).toBeInTheDocument();
  },
};
