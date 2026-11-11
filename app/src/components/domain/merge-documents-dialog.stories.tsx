import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { MergeCandidate } from '@/lib/merge';
import { MergeDocumentsDialog, type MergeRequest } from './merge-documents-dialog';

/**
 * The merge dialog on its own, with the selection held by a wrapper as the documents page holds
 * it, and the mutation stood in for by a spy.
 *
 * The dialog is portalled out of the canvas, so every story looks for it in the document.
 */

const TAXES = { id: '00000000-0000-4000-8000-0000000000f1', name: 'Taxes', parentId: null };
const LEASE: MergeCandidate = {
  id: '00000000-0000-4000-8000-0000000000d1',
  title: 'Lease page 1',
  mimeType: 'application/pdf',
  folderId: TAXES.id,
  sizeBytes: 2_411_724,
  // OCR made a searchable PDF of this one, so that is what is merged and previewed.
  archiveKey: 'archive/lease.pdf',
};
const SCAN: MergeCandidate = {
  id: '00000000-0000-4000-8000-0000000000d2',
  title: 'Lease page 2',
  mimeType: 'image/jpeg',
  folderId: null,
  sizeBytes: 840_000,
  archiveKey: null,
};
const SIGNED: MergeCandidate = {
  id: '00000000-0000-4000-8000-0000000000d3',
  title: 'Signature page',
  mimeType: 'application/pdf',
  folderId: null,
  sizeBytes: 120_000,
  archiveKey: null,
};

/**
 * A server answering the dialog's two reads: each row's first page, and the previewed file's
 * address, which names the document and the file so a story can tell which one is framed. It is
 * `about:blank`, so the frame loads nothing.
 */
const PREVIEW_SERVER = {
  Query: {
    documentThumbnailUrls: () => [],
    documentFileUrl: (_parent: unknown, args: { id: string; variant: string }) =>
      `about:blank#${args.id}/${args.variant}`,
  },
};

interface HarnessProps {
  start: MergeCandidate[];
  onMerge: (request: MergeRequest) => Promise<unknown>;
  onClose: () => void;
}

/** Holds the selection, as the page does, so moving and leaving out redraw the list. */
function Harness({ start, onMerge, onClose }: HarnessProps) {
  const [documents, setDocuments] = useState(start);
  return (
    <MergeDocumentsDialog
      documents={documents}
      folders={[TAXES]}
      onDocumentsChange={setDocuments}
      onMerge={onMerge}
      onClose={onClose}
    />
  );
}

const meta = {
  title: 'Domain/MergeDocumentsDialog',
  component: Harness,
  parameters: { layout: 'centered', apolloClient: { resolvers: PREVIEW_SERVER } },
  args: { start: [LEASE, SCAN, SIGNED], onMerge: fn(async () => undefined), onClose: fn() },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function findDialog(canvasElement: HTMLElement) {
  return within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Merge documents' }));
}

function rowTitles(dialog: ReturnType<typeof within>) {
  const list = dialog.getByRole('list', { name: 'Documents to merge, in page order' });
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '');
}

/**
 * Opens on the first document's title and folder; the order can be changed and a document left
 * out, and what is sent is the order as it stands.
 */
export const ReordersAndMerges: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    await expect(dialog.getByRole('textbox', { name: /Title/ })).toHaveValue('Lease page 1');
    await expect(dialog.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('Taxes');

    // The first cannot go up, the last cannot go down. A button with a hint is disabled through
    // `aria-disabled`, so its tooltip still opens.
    await expect(dialog.getByRole('button', { name: 'Move “Lease page 1” up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(dialog.getByRole('button', { name: 'Move “Signature page” down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await userEvent.click(dialog.getByRole('button', { name: 'Move “Signature page” up' }));
    await waitFor(() =>
      expect(rowTitles(dialog)).toEqual([
        expect.stringContaining('Lease page 1'),
        expect.stringContaining('Signature page'),
        expect.stringContaining('Lease page 2'),
      ]),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Leave out “Lease page 2”' }));
    await waitFor(() => expect(rowTitles(dialog)).toHaveLength(2));

    const title = dialog.getByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Lease, signed');
    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));

    await waitFor(() =>
      expect(args.onMerge).toHaveBeenCalledWith({
        ids: [LEASE.id, SIGNED.id],
        title: 'Lease, signed',
        folderId: TAXES.id,
        trashOriginals: false,
      }),
    );
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
  },
};

/** The originals go to the trash only when asked. */
export const TrashesTheOriginals: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    const trash = dialog.getByRole('switch', { name: /Move the originals to the trash/ });
    await expect(trash).not.toBeChecked();
    await userEvent.click(trash);
    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(args.onMerge).toHaveBeenCalledWith(expect.objectContaining({ trashOriginals: true })));
  },
};

/** One document is nothing to merge: the dialog says so and Merge waits for another. */
export const NeedsTwo: Story = {
  args: { start: [LEASE] },
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    await expect(dialog.getByText('Pick at least two documents')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Merge' })).toBeDisabled();
    await expect(args.onMerge).not.toHaveBeenCalled();
  },
};

/** A title with a slash is refused before anything is sent, as a rename's is. */
export const RefusesASlash: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    const title = dialog.getByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Lease/2026');
    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));
    await expect(await dialog.findByText('A title cannot contain "/"')).toBeInTheDocument();
    await expect(args.onMerge).not.toHaveBeenCalled();
  },
};

/** What the server refuses is said in the dialog, which stays open to try again. */
export const SaysWhyTheServerRefused: Story = {
  args: {
    onMerge: fn(async () => {
      throw new Error('Could not merge “Lease page 2”: the PDF is password-protected');
    }),
  },
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent('password-protected');
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

/**
 * Each row says where the document is filed, what it is and how big, since two can share a
 * title. The first is previewed until another is pressed; one with a searchable PDF is previewed
 * as that, since that is what the merge takes, and one left out hands the preview back to the first.
 */
export const PreviewsWhatIsPressed: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    const rows = rowTitles(dialog);
    await expect(rows[0]).toContain('Taxes · PDF · 2.3 MB');
    await expect(rows[1]).toContain('Top level · JPEG image · 820.3 KB');

    const lease = await dialog.findByTitle('Preview of “Lease page 1”');
    await waitFor(() => expect(lease).toHaveAttribute('src', `about:blank#${LEASE.id}/ARCHIVE`));
    await expect(dialog.getByText('“Lease page 1”, the searchable PDF')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: /^Lease page 1/ })).toHaveAttribute('aria-current', 'true');

    await userEvent.click(dialog.getByRole('button', { name: /^Lease page 2/ }));
    const scan = await dialog.findByTitle('Preview of “Lease page 2”');
    await waitFor(() => expect(scan).toHaveAttribute('src', `about:blank#${SCAN.id}/ORIGINAL`));
    await expect(dialog.getByText('“Lease page 2”, as uploaded')).toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: 'Leave out “Lease page 2”' }));
    await expect(await dialog.findByTitle('Preview of “Lease page 1”')).toBeInTheDocument();
  },
};

/** A preview the server cannot sign says so where the frame would be, and the merge can still go ahead. */
export const PreviewFails: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          documentThumbnailUrls: () => [],
          documentFileUrl: () => {
            throw new Error('The bucket did not answer');
          },
        },
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const dialog = await findDialog(canvasElement);
    await expect(await dialog.findByText('Could not load the preview')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(args.onMerge).toHaveBeenCalled());
  },
};
