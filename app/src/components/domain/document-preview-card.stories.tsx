import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { DocumentFileVariant } from '@/__generated__/graphql';
import { DocumentPreviewCard } from './document-preview-card';

/**
 * The preview, with the bucket stood in for by a `data:` URL.
 *
 * The card's one decision is which object to ask for, so the mock server answers only for the
 * variant the story expects: a card that asked for the wrong one gets an error, never draws its
 * frame, and the story fails on the frame it was waiting for.
 */

const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html lang="en"><title>Lease</title><p>Lease agreement</p>')}`;

function fileUrlFor(expected: DocumentFileVariant) {
  return (_parent: unknown, { variant }: { variant: DocumentFileVariant }) => {
    if (variant !== expected) {
      throw new Error(`Asked for ${variant}, expected ${expected}`);
    }
    return PAGE;
  };
}

const ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';

const meta = {
  title: 'Domain/DocumentPreviewCard',
  component: DocumentPreviewCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DocumentPreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before OCR has run, or when it never will, the only file there is to show is the upload. */
export const Original: Story = {
  args: { doc: { id: ID, mimeType: 'application/pdf', archiveKey: null } },
  parameters: {
    apolloClient: { resolvers: { Query: { documentFileUrl: fileUrlFor(DocumentFileVariant.Original) } } },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTitle('Document preview')).toHaveAttribute('src', PAGE);
    await expect(canvas.getByRole('heading', { level: 2, name: 'Preview' })).toBeInTheDocument();
    await expect(canvas.getByText('The uploaded file.')).toBeInTheDocument();
  },
};

/** Once there is an archive it is what the frame shows, and the card says which file that is. */
export const Archive: Story = {
  args: { doc: { id: ID, mimeType: 'application/pdf', archiveKey: 'archive/lease.pdf' } },
  parameters: {
    apolloClient: { resolvers: { Query: { documentFileUrl: fileUrlFor(DocumentFileVariant.Archive) } } },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTitle('Document preview')).toBeInTheDocument();
    await expect(canvas.getByText('The searchable PDF produced by OCR.')).toBeInTheDocument();
  },
};

/** Plain text has a card of its own, so this one asks the server for nothing and draws nothing. */
export const PlainText: Story = {
  args: { doc: { id: ID, mimeType: 'text/plain', archiveKey: null } },
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          documentFileUrl: () => {
            throw new Error('A plain-text document must not ask for a preview');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('heading', { name: 'Preview' })).not.toBeInTheDocument();
    await expect(canvas.queryByTitle('Document preview')).not.toBeInTheDocument();
  },
};
