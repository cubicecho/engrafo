import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DocumentStatusEnum } from '@/__generated__/graphql';
import { Sidebar } from '@/components/sidebar';
import { documentPath, ROUTES } from '@/lib/routes';
import { archiveServer, document, EMPTY_FOLDER, TAXES, YEAR } from '../../../.storybook/archive.ts';
import { ArchiveSidebarSection } from './archive-sidebar';

/**
 * The archive's tree, in the sidebar it lives in on every signed-in page. Mocked through the SDL
 * rather than canned responses: `documents(orderBy: …, limit: …)` is generated from the Drizzle
 * models, so its shape changes without anyone editing this app, and executing it against the
 * printed schema is what turns that into a failing story instead of an empty tree.
 */

const TAX_RETURN = document({ title: 'Tax return', folderId: YEAR.id });

function Framed() {
  return (
    <div className="h-screen">
      <Sidebar className="w-80" contentSlot={<ArchiveSidebarSection />} />
    </div>
  );
}

const meta = {
  title: 'Domain/ArchiveSidebarSection',
  component: ArchiveSidebarSection,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.documents] } },
} satisfies Meta<typeof ArchiveSidebarSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A filed archive: folders nested in folders, an empty one, documents in them and at the top
 * level. Only a document that is not settled wears a status; a tree of "Ready" says nothing.
 */
export const Filed: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({
        folders: [TAXES, YEAR, EMPTY_FOLDER],
        documents: [
          document({ title: 'Electricity bill — August' }),
          TAX_RETURN,
          document({ title: 'Lease agreement', status: DocumentStatusEnum.Processing }),
          document({ title: 'Warranty', status: DocumentStatusEnum.Failed }),
        ],
      }),
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: /Electricity bill — August/ })).toBeInTheDocument();
    // A folder is a button that folds what is under it; an empty one is still there to file into.
    await expect(canvas.getByRole('button', { name: /^Taxes/, expanded: true })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^Receipts/ })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /Tax return/ })).toBeInTheDocument();
    await expect(canvas.getByText('Processing')).toBeInTheDocument();
    await expect(canvas.getByText('Failed')).toBeInTheDocument();
    await expect(canvas.queryByText('Ready')).not.toBeInTheDocument();
  },
};

/** On a document's page the tree marks that document, so the sidebar says where it is filed. */
export const MarksTheOpenDocument: Story = {
  parameters: {
    router: { initialEntries: [documentPath(TAX_RETURN.id)] },
    apolloClient: { resolvers: archiveServer({ folders: [TAXES, YEAR], documents: [TAX_RETURN] }) },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: /Tax return/ })).toHaveAttribute('aria-current', 'page');
  },
};

/** Nothing filed yet is one quiet line, not a page-sized empty state in a sidebar. */
export const Empty: Story = {
  parameters: { apolloClient: { resolvers: archiveServer({ folders: [], documents: [] }) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Nothing filed yet.')).toBeInTheDocument();
  },
};

/** The section's own "New folder" makes one at the top level, and it appears in the tree. */
export const CreatesAFolder: Story = {
  parameters: { apolloClient: { resolvers: archiveServer({ folders: [TAXES], documents: [] }) } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /^Taxes/ });
    await userEvent.click(canvas.getByRole('button', { name: 'New folder' }));

    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'New folder' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Name/ }), 'Insurance');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await expect(await canvas.findByRole('button', { name: /^Insurance/ })).toBeInTheDocument();
  },
};

/** "Move to…" in a row's menu is the way to move without dragging, and files the document there. */
export const MovesADocumentWithTheMenu: Story = {
  parameters: {
    apolloClient: {
      resolvers: archiveServer({ folders: [TAXES, YEAR], documents: [document({ title: 'Tax return' })] }),
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Tax return' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Move to…' }));

    const dialog = within(await page.findByRole('dialog', { name: 'Move “Tax return”' }));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await page.findByRole('option', { name: 'Taxes/2026' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Move' }));

    // Now under 2026: inside the list that folder's row opens.
    await waitFor(() => {
      const year = canvas.getByRole('button', { name: /^2026/ }).closest('li');
      expect(year && within(year).queryByRole('link', { name: /Tax return/ })).toBeInTheDocument();
    });
  },
};

/** Deleting a folder takes what is in it, so the button stays locked until its name is typed. */
export const DeletesAFolderOnlyOnceNamed: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [TAXES, YEAR], documents: [TAX_RETURN] }) },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Taxes' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Delete' }));

    const dialog = within(await page.findByRole('alertdialog'));
    await expect(dialog.getByText(/1 document and 1 folder/)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: 'Delete folder' });
    await expect(confirm).toBeDisabled();
    await userEvent.type(dialog.getByRole('textbox'), 'Taxes');
    await expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByRole('button', { name: /^Taxes/ })).not.toBeInTheDocument());
  },
};

/**
 * Sharing a folder with MCP: its menu turns it on, it wears the badge, and a folder inside it says
 * which folder shares it instead of offering a switch of its own.
 */
export const SharesAFolderWithMcp: Story = {
  parameters: {
    apolloClient: { resolvers: archiveServer({ folders: [{ ...TAXES }, { ...YEAR }], documents: [] }) },
  },
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Taxes' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Share with MCP' }));
    await expect(await canvas.findByText('MCP')).toBeInTheDocument();

    // Found rather than got: the menu that just closed hides the rest of the page until it has.
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for 2026' }));
    await expect(await page.findByRole('menuitem', { name: 'Shared with MCP through “Taxes”' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{Escape}');

    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Taxes' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Stop sharing with MCP' }));
    await waitFor(() => expect(canvas.queryByText('MCP')).not.toBeInTheDocument());
    // The accessibility check runs after this, and a menu still closing hides the page from it.
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(canvasElement.closest('[aria-hidden="true"]')).toBeNull());
  },
};
