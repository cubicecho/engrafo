import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { DocumentStatusBadge, StepStatusBadge } from './status-badge';

/**
 * The one place a status becomes words.
 *
 * Both badges map a server enum to a label and a tone, and both fall through to the raw value
 * for anything they do not know. That fallback is the reason these stories draw the whole set
 * rather than one example: the enums live in Drizzle, and a new status added there arrives here
 * as a lowercase snake_case word in a grey pill — visible in the matrix, invisible in a story
 * that only ever renders `ready`.
 */
const meta = {
  title: 'Domain/StatusBadge',
  component: DocumentStatusBadge,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof DocumentStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const DOCUMENT_STATUSES = ['pending_upload', 'uploaded', 'processing', 'ready', 'failed'] as const;
const STEP_STATUSES = ['queued', 'running', 'succeeded', 'skipped', 'failed'] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Every state a document can be in, in the order it passes through them. */
export const DocumentStatuses: Story = {
  args: { status: 'ready' },
  render: () => (
    <Row label="Document">
      {DOCUMENT_STATUSES.map((status) => (
        <DocumentStatusBadge key={status} status={status} />
      ))}
    </Row>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The labels, not the enum values: "Queued" rather than "uploaded" is the entire job of
    // this component, and a mapping that silently fell through would still render five pills.
    for (const label of ['Uploading', 'Queued', 'Processing', 'Ready', 'Failed']) {
      await expect(canvas.getByText(label)).toBeInTheDocument();
    }
  },
};

/** The same for a pipeline step, which has its own set — `skipped` has no document equivalent. */
export const StepStatuses: Story = {
  args: { status: 'ready' },
  render: () => (
    <Row label="Pipeline step">
      {STEP_STATUSES.map((status) => (
        <StepStatusBadge key={status} status={status} />
      ))}
    </Row>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Done')).toBeInTheDocument();
    await expect(canvas.getByText('Skipped')).toBeInTheDocument();
  },
};

/**
 * A status neither map knows — what a reader sees the day someone adds one to the schema and
 * not to this file. It is deliberately not a crash and deliberately not blank.
 */
export const UnknownStatus: Story = {
  args: { status: 'quarantined' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('quarantined')).toBeInTheDocument();
  },
};
