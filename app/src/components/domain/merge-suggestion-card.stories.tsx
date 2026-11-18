import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MergeSuggestionBand, type MergeSuggestionCardFragment } from '@/__generated__/graphql';
import { MergeSuggestionCard } from './merge-suggestion-card';

/**
 * One suggested merge on its own, with the page's two callbacks as spies. The page's stories
 * cover the bands and the model's confirmation; these cover a model that doubted a break, and a
 * server that cannot merge, where Review merge says why it is off.
 */

const FRONT = '00000000-0000-4000-8000-0000000000b1';
const BACK = '00000000-0000-4000-8000-0000000000b2';
const LAST = '00000000-0000-4000-8000-0000000000b3';

const DOUBTED: MergeSuggestionCardFragment = {
  id: '00000000-0000-4000-8000-0000000000c1',
  confidence: 0.68,
  heuristicConfidence: 0.8,
  band: MergeSuggestionBand.Medium,
  reasons: [
    { signal: 'time', text: 'scanned 12 s apart', points: 1.8 },
    { signal: 'ai', text: 'AI: page 3 does not continue page 2 (a new letter starts)', points: -1.5 },
  ],
  verdicts: [
    { fromId: FRONT, toId: BACK, continues: true, reason: 'the address block runs on' },
    { fromId: BACK, toId: LAST, continues: false, reason: 'a new letter starts' },
  ],
  documents: [
    { id: FRONT, title: 'Letter', folderId: null, mimeType: 'image/jpeg', sizeBytes: 400_000, archiveKey: null },
    { id: BACK, title: 'Letter (2)', folderId: null, mimeType: 'image/jpeg', sizeBytes: 410_000, archiveKey: null },
    { id: LAST, title: 'Letter (3)', folderId: null, mimeType: 'image/jpeg', sizeBytes: 390_000, archiveKey: null },
  ],
};

const meta = {
  title: 'Domain/MergeSuggestionCard',
  component: MergeSuggestionCard,
  args: {
    suggestion: DOUBTED,
    folderPaths: new Map(),
    thumbnails: new Map(),
    mergeAvailable: true,
    onReview: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof MergeSuggestionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The model doubted one of two breaks: the line says so and counts them. */
export const ModelDoubtedABreak: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('Medium · 68%')).toBeVisible();
    await expect(canvas.getByText('rules 80% · AI doubted 1 of 2 page breaks')).toBeVisible();
    // The model's own reasons are in that line, not among the rules'.
    await expect(canvas.queryByRole('list', { name: 'Against' })).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: /^Dismiss/ }));
    await expect(args.onDismiss).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: /^Review merge/ }));
    await expect(args.onReview).toHaveBeenCalledOnce();
  },
};

/** No pikepdf on the server: Review merge stays reachable to say why, and does nothing. */
export const MergeUnavailable: Story = {
  args: { mergeAvailable: false },
  play: async ({ canvasElement, args }) => {
    const review = within(canvasElement).getByRole('button', { name: /^Review merge/ });
    await expect(review).toHaveAttribute('aria-disabled', 'true');
    await expect(review).toHaveAccessibleDescription('Merging is not available on this server');
    await userEvent.click(review);
    await expect(args.onReview).not.toHaveBeenCalled();
  },
};
