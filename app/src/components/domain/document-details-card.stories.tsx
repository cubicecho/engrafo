import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { FieldSourceEnum as FieldSource } from '@/__generated__/graphql';
import { DocumentDetailsCard } from './document-details-card';

/** The details card with and without the facts the server learns late. */
const meta = {
  title: 'Domain/DocumentDetailsCard',
  component: DocumentDetailsCard,
  parameters: { layout: 'padded' },
  args: {
    createdAt: '2026-09-02T11:04:00.000Z',
    checksumSha256: null,
    documentDate: null,
    documentDateSource: null,
    onEditDate: fn(),
  },
} satisfies Meta<typeof DocumentDetailsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

/** A checksum is a value someone pastes elsewhere, so it comes with a copy button. */
export const WithChecksum: Story = {
  args: { checksumSha256: CHECKSUM },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    const [, added, checksum] = canvas.getAllByRole('definition');
    await expect(added).toHaveTextContent('2026');
    await expect(checksum).toHaveTextContent(CHECKSUM);
    await expect(canvas.getByRole('button', { name: 'Copy checksum' })).toBeInTheDocument();
  },
};

/** Before the pipeline has inspected the file there is nothing to copy, and no button offering to. */
export const WithoutChecksum: Story = {
  play: async ({ canvas }) => {
    const [, , checksum] = canvas.getAllByRole('definition');
    await expect(checksum).toHaveTextContent('—');
    await expect(canvas.queryByRole('button', { name: 'Copy checksum' })).not.toBeInTheDocument();
  },
};

/**
 * A date read from the text says so, so a wrong one reads as a guess to correct. It is drawn as
 * the day it names, not shifted a day by the reader's time zone.
 */
export const ExtractedDate: Story = {
  args: { documentDate: '2025-03-12', documentDateSource: FieldSource.Extracted },
  play: async ({ args, canvas }) => {
    const [date] = canvas.getAllByRole('definition');
    await expect(date).toHaveTextContent(/12/);
    await expect(date).toHaveTextContent('2025');
    await expect(canvas.getByText('Read from the text')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Edit the document date' }));
    await expect(args.onEditDate).toHaveBeenCalledOnce();
  },
};

/** A date the user set says that instead. */
export const DateSetByTheUser: Story = {
  args: { documentDate: '2025-03-12', documentDateSource: FieldSource.User },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Set by you')).toBeInTheDocument();
  },
};

/** No date is a dash, and the button to set one is still there. */
export const NoDate: Story = {
  play: async ({ canvas }) => {
    const [date] = canvas.getAllByRole('definition');
    await expect(date).toHaveTextContent('—');
    await expect(canvas.getByRole('button', { name: 'Edit the document date' })).toBeInTheDocument();
  },
};
