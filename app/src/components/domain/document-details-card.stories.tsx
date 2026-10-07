import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { DocumentDetailsCard } from './document-details-card';

/** The details card with and without the one fact the server learns late. */
const meta = {
  title: 'Domain/DocumentDetailsCard',
  component: DocumentDetailsCard,
  parameters: { layout: 'padded' },
  args: { createdAt: '2026-09-02T11:04:00.000Z' },
} satisfies Meta<typeof DocumentDetailsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

/** A checksum is a value someone pastes elsewhere, so it comes with a copy button. */
export const WithChecksum: Story = {
  args: { checksumSha256: CHECKSUM },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    const [added, checksum] = canvas.getAllByRole('definition');
    await expect(added).toHaveTextContent('2026');
    await expect(checksum).toHaveTextContent(CHECKSUM);
    await expect(canvas.getByRole('button', { name: 'Copy checksum' })).toBeInTheDocument();
  },
};

/** Before the pipeline has inspected the file there is nothing to copy, and no button offering to. */
export const WithoutChecksum: Story = {
  args: { checksumSha256: null },
  play: async ({ canvas }) => {
    const [, checksum] = canvas.getAllByRole('definition');
    await expect(checksum).toHaveTextContent('—');
    await expect(canvas.queryByRole('button', { name: 'Copy checksum' })).not.toBeInTheDocument();
  },
};
