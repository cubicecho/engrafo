import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { ContentFormatEnum } from '@/__generated__/graphql';
import { MOCK_BUCKET_DENIED } from '../../../.storybook/mock-bucket.ts';
import { DocumentTextCard } from './document-text-card';

/**
 * The text card, with the text bucket stood in for by a `data:` URL.
 *
 * The card fetches whatever address `documentFileUrl` hands it, so a story decides what the
 * bucket holds by what that resolver returns — and proves the card did not ask at all by making
 * the resolver throw.
 */

const ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';
const TEXT = 'This lease is made between';
const OVER_THE_PREVIEW_LIMIT_BYTES = 2_097_152;

function textUrl(text: string): string {
  return `data:text/plain,${encodeURIComponent(text)}`;
}

const meta = {
  title: 'Domain/DocumentTextCard',
  component: DocumentTextCard,
  parameters: { layout: 'padded' },
  args: { onDownload: fn() },
} satisfies Meta<typeof DocumentTextCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The usual case: the text, a way to copy it, and a way to take it away as a file. */
export const WithText: Story = {
  args: { doc: { id: ID, contentKey: 'text/lease.txt', contentBytes: TEXT.length } },
  parameters: { apolloClient: { resolvers: { Query: { documentFileUrl: () => textUrl(TEXT) } } } },
  play: async ({ args, canvas }) => {
    await expect(await canvas.findByText(TEXT)).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Text' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy text' })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Download text' }));
    await expect(args.onDownload).toHaveBeenCalledOnce();
  },
};

/** An object with nothing in it is not "too large", and an empty box with a copy button is not an answer. */
export const Empty: Story = {
  args: { doc: { id: ID, contentKey: 'text/lease.txt', contentBytes: 0 } },
  parameters: { apolloClient: { resolvers: { Query: { documentFileUrl: () => textUrl('') } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No text was extracted from this document.')).toBeInTheDocument();
    await expect(canvas.queryByText('Too large to show here.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy text' })).not.toBeInTheDocument();
  },
};

/** Past the preview limit the text is never fetched: the download button stands in for it. */
export const TooLarge: Story = {
  args: { doc: { id: ID, contentKey: 'text/lease.txt', contentBytes: OVER_THE_PREVIEW_LIMIT_BYTES } },
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          documentFileUrl: () => {
            throw new Error('The oversize text must not be requested');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Too large to show here.')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Download text' })).toBeInTheDocument();
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
  },
};

/**
 * An expired signature. The bucket answers 403 with a body, and that body is not the document's
 * text: the card says it failed and leaves the download, which asks for a fresh address.
 */
export const StorageRefused: Story = {
  args: { doc: { id: ID, contentKey: 'text/lease.txt', contentBytes: TEXT.length } },
  parameters: { apolloClient: { resolvers: { Query: { documentFileUrl: () => MOCK_BUCKET_DENIED } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load the text');
    await expect(canvas.queryByRole('button', { name: 'Copy text' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Download text' })).toBeInTheDocument();
  },
};

/** The server would not sign an address at all. Same answer: say so, rather than load for ever. */
export const AddressRefused: Story = {
  args: { doc: { id: ID, contentKey: 'text/lease.txt', contentBytes: TEXT.length } },
  parameters: {
    apolloClient: {
      resolvers: {
        Query: {
          documentFileUrl: () => {
            throw new Error('Storage is unreachable');
          },
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load the text');
  },
};

/** The pipeline stored no text at all, so there is no card: nothing to show and nothing to download. */
export const NothingStored: Story = {
  args: { doc: { id: ID, contentKey: null, contentBytes: null } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('heading', { name: 'Text' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Download text' })).not.toBeInTheDocument();
  },
};

const NOTES =
  '# Kettle manual\n\nFill to the line.\nThen boil.\n\n- Descale monthly\n\n![Diagram](https://tracker.example/pixel.png)';

/**
 * Text stored as Markdown opens formatted: its heading is a heading and its list a list. An image
 * is said by its alt text and never fetched, so the page tells no server the document was opened.
 * Plain shows the characters stored.
 */
export const MarkdownFormatted: Story = {
  args: {
    doc: {
      id: ID,
      contentKey: 'text/notes.txt',
      contentBytes: NOTES.length,
      contentFormat: ContentFormatEnum.Markdown,
    },
  },
  parameters: { apolloClient: { resolvers: { Query: { documentFileUrl: () => textUrl(NOTES) } } } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('heading', { name: 'Kettle manual' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Formatted' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('listitem')).toHaveTextContent('Descale monthly');
    await expect(canvas.getByText('[Diagram]')).toBeInTheDocument();
    await expect(canvasElement.querySelector('img')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Copy text' })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Plain' }));
    await expect(canvas.queryByRole('heading', { name: 'Kettle manual' })).not.toBeInTheDocument();
    await expect(canvas.getByText(/# Kettle manual/)).toBeInTheDocument();
  },
};

const SCAN = 'INVOICE 4821\nDue on receipt';

/**
 * Plain text opens as it is stored, line breaks and all, which Markdown would join into one
 * paragraph. Formatted is still there to ask for.
 */
export const PlainOpensPlain: Story = {
  args: {
    doc: { id: ID, contentKey: 'text/scan.txt', contentBytes: SCAN.length, contentFormat: ContentFormatEnum.Plain },
  },
  parameters: { apolloClient: { resolvers: { Query: { documentFileUrl: () => textUrl(SCAN) } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/INVOICE 4821/)).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Plain' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(canvas.getByRole('button', { name: 'Formatted' }));
    await expect(canvas.getByRole('button', { name: 'Formatted' })).toHaveAttribute('aria-pressed', 'true');
    await expect(
      canvas.getByText('INVOICE 4821 Due on receipt', { normalizer: (text) => text.replace(/\s+/g, ' ').trim() }),
    ).toBeInTheDocument();
  },
};
