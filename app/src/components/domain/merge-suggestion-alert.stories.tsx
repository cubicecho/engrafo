import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { documentPath, mergeSuggestionPath } from '@/lib/routes';
import { MergeSuggestionAlert } from './merge-suggestion-alert';

/**
 * The document page's word that a document may be one page of a scan filed as several. The claims
 * are that it names the other pages as links to theirs, says how sure, and that Review merge is a
 * link to that suggestion's review on the suggested merges page.
 */

const THIS = '00000000-0000-4000-8000-0000000000a3';
const BEFORE = '00000000-0000-4000-8000-0000000000a4';
const AFTER = '00000000-0000-4000-8000-0000000000a5';
const SUGGESTION = '00000000-0000-4000-8000-0000000000e1';

const meta = {
  title: 'Domain/MergeSuggestionAlert',
  component: MergeSuggestionAlert,
} satisfies Meta<typeof MergeSuggestionAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePages: Story = {
  args: {
    documentId: THIS,
    suggestions: [
      {
        id: SUGGESTION,
        confidence: 0.874,
        documents: [
          { id: BEFORE, title: 'scan_0003' },
          { id: THIS, title: 'scan_0004' },
          { id: AFTER, title: 'scan_0005' },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('status');
    await expect(alert).toHaveTextContent('It may be part of a 3-page scan with scan_0003 and scan_0005 (87% sure).');
    const scope = within(alert);
    await expect(scope.getByRole('link', { name: 'scan_0003' })).toHaveAttribute('href', documentPath(BEFORE));
    await expect(scope.getByRole('link', { name: 'scan_0005' })).toHaveAttribute('href', documentPath(AFTER));
    // This document is the page the reader is on, so it is not named.
    await expect(scope.queryByRole('link', { name: 'scan_0004' })).not.toBeInTheDocument();
    await expect(scope.getByRole('link', { name: 'Review merge' })).toHaveAttribute(
      'href',
      mergeSuggestionPath(SUGGESTION),
    );
  },
};

/** No suggestion, no alert. */
export const NoSuggestion: Story = {
  args: { documentId: THIS, suggestions: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('status')).not.toBeInTheDocument();
  },
};
