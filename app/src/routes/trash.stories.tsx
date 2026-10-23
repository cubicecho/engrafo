import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { clientId } from '@/lib/id';
import { ROUTES } from '@/lib/routes';
import { archiveServer, TAXES } from '../../.storybook/archive.ts';
import { TrashRoute } from './trash';

/**
 * The trash against a mock server built from the real SDL, one that remembers: a restore or a
 * delete changes what the next read of `trash` returns, as the real one does, so a story sees the
 * row go. The claims are that each row says where it will be restored to, that a restore and a
 * "Delete forever" each send their mutation for that row, and that "Empty trash" asks first.
 */

interface TrashedFixture {
  id: string;
  title: string;
  folderId: string | null;
  sizeBytes: number;
  deletedAt: string;
}

const INVOICE: TrashedFixture = {
  id: clientId(),
  title: 'Invoice 2026-03',
  folderId: TAXES.id,
  sizeBytes: 182_113,
  deletedAt: '2026-10-20T08:00:00.000Z',
};
const SCAN: TrashedFixture = {
  id: clientId(),
  title: 'scan',
  folderId: null,
  sizeBytes: 2_482_113,
  deletedAt: '2026-10-18T08:00:00.000Z',
};

/** What a story's server was asked to do, in order. */
let calls: string[] = [];

function trashServer(start: TrashedFixture[]) {
  const trashed = start.map((doc) => ({ ...doc }));
  const archive = archiveServer({ folders: [TAXES], documents: [] });
  const take = (id: string) => {
    const index = trashed.findIndex((doc) => doc.id === id);
    if (index < 0) {
      throw new Error('Document not found in the trash');
    }
    return trashed.splice(index, 1)[0];
  };
  return {
    Query: {
      ...archive.Query,
      trash: () => ({ count: trashed.length, retentionDays: 30, documents: trashed }),
    },
    Mutation: {
      restoreDocument: (_parent: unknown, args: { id: string }) => {
        calls.push(`restore ${args.id}`);
        const doc = take(args.id);
        return { id: doc.id, title: doc.title, folderId: doc.folderId };
      },
      purgeDocument: (_parent: unknown, args: { id: string }) => {
        calls.push(`purge ${args.id}`);
        take(args.id);
        return true;
      },
      emptyTrash: () => {
        calls.push('empty');
        return trashed.splice(0).length;
      },
    },
  };
}

/** Bounded height, because `PageLayout` is a sticky chassis that scrolls its own body. */
function Framed() {
  return (
    <div className="h-screen">
      <TrashRoute />
    </div>
  );
}

const meta = {
  title: 'Routes/Trash',
  component: TrashRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.trash] } },
  beforeEach: () => {
    calls = [];
  },
} satisfies Meta<typeof TrashRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each row says where a restore puts it: its folder while that is there, else the top level. */
export const WithDocuments: Story = {
  parameters: { apolloClient: { resolvers: trashServer([INVOICE, SCAN]) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Invoice 2026-03')).toBeVisible();
    await expect(canvas.getByText(/30 days/)).toBeVisible();
    await expect(await canvas.findByText('Restores to Taxes')).toBeVisible();
    await expect(canvas.getByText('Restores to top level')).toBeVisible();
  },
};

/** Restore sends the row's id, and the row leaves the list. */
export const Restores: Story = {
  parameters: { apolloClient: { resolvers: trashServer([INVOICE, SCAN]) } },
  play: async ({ canvas }) => {
    const list = within(await canvas.findByRole('list', { name: 'Deleted documents' }));
    const row = (await list.findByText('Invoice 2026-03')).closest('li');
    await expect(row).not.toBeNull();
    await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(canvas.queryByText('Invoice 2026-03')).not.toBeInTheDocument());
    await expect(calls).toEqual([`restore ${INVOICE.id}`]);
    await expect(canvas.getByText('scan')).toBeVisible();
  },
};

/** "Delete forever" asks first, then purges only that row. */
export const DeletesForever: Story = {
  parameters: { apolloClient: { resolvers: trashServer([INVOICE, SCAN]) } },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete “scan” forever' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog', {
      name: 'Delete “scan” forever?',
    });
    await expect(calls).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(canvas.queryByText('scan')).not.toBeInTheDocument());
    await expect(calls).toEqual([`purge ${SCAN.id}`]);
  },
};

/** "Empty trash" asks first, and leaves the empty state behind. */
export const Empties: Story = {
  parameters: { apolloClient: { resolvers: trashServer([INVOICE, SCAN]) } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByText('scan');
    await userEvent.click(canvas.getByRole('button', { name: 'Empty trash' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog', {
      name: 'Empty the trash?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await expect(await canvas.findByText('The trash is empty')).toBeVisible();
    await expect(calls).toEqual(['empty']);
  },
};

/** Nothing deleted: the empty state, and nothing to empty. */
export const Empty: Story = {
  parameters: { apolloClient: { resolvers: trashServer([]) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('The trash is empty')).toBeVisible();
    // With a hint, cubeui keeps the button focusable so its tooltip can say why, and refuses the press.
    const button = canvas.getByRole('button', { name: 'Empty trash' }) as HTMLButtonElement;
    await expect(button.disabled || button.getAttribute('aria-disabled') === 'true').toBe(true);
  },
};
