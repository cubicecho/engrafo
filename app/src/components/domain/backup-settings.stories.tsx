import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphQLError } from 'graphql';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { MOCK_BUCKET_DENIED, MOCK_BUCKET_OK } from '../../../.storybook/mock-bucket.ts';
import { BackupSettings } from './backup-settings';

/**
 * Settings' Backup tab against a mock server built from the real SDL, and the harness's mock
 * bucket for the import's PUT: the branches worth watching are between the calls — a link
 * refused, an archive too large to ask about, a bucket that says no, and what a finished or
 * running import reports.
 */

const MAX_IMPORT_BYTES = 5_242_880;
const ARCHIVE_BYTES = 2048;
const OVER_THE_LIMIT_BYTES = 6_291_456;
const JOB_ID = '5b0c7a1e-2d3f-4e5a-8b6c-7d8e9f0a1b2c';

/** An import run as `latestImport` answers it. */
function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    state: 'DONE',
    total: 4,
    imported: 2,
    skipped: [{ title: 'Hardware store', reason: 'Already in the archive as "Hardware store".' }],
    failed: [{ title: 'Old scan', reason: 'Its original is missing from the archive.' }],
    error: null,
    startedAt: '2026-10-23T09:00:00.000Z',
    finishedAt: '2026-10-23T09:01:00.000Z',
    ...overrides,
  };
}

/** What the stories saw the server asked. */
interface Calls {
  exportLinks: number;
  uploads: number[];
  imports: string[];
}

/** A server whose import lands in `bucket`, and whose export link is `exportPath` or refused. */
function server({
  bucket = MOCK_BUCKET_OK,
  latest = null as ReturnType<typeof job> | null,
  exportRefused = false,
} = {}) {
  const calls: Calls = { exportLinks: 0, uploads: [], imports: [] };
  let current = latest;
  const resolvers = {
    Query: { latestImport: () => current },
    Mutation: {
      createExportLink: () => {
        calls.exportLinks += 1;
        if (exportRefused) {
          // Not UNAUTHENTICATED: that one signs the client out and sends the page to /login.
          throw new GraphQLError('The export could not be prepared.', { extensions: { code: 'BAD_USER_INPUT' } });
        }
        return { path: '/export/a-single-use-token', expiresAt: '2026-10-23T09:05:00.000Z' };
      },
      createImportUpload: (_parent: unknown, args: { sizeBytes: number }) => {
        calls.uploads.push(args.sizeBytes);
        return {
          key: 'imports/u/archive.tar',
          uploadUrl: bucket,
          uploadHeaders: [{ name: 'Content-Type', value: 'application/x-tar' }],
        };
      },
      importArchive: (_parent: unknown, args: { key: string }) => {
        calls.imports.push(args.key);
        current = job();
        return current;
      },
    },
  };
  return { calls, resolvers };
}

function archive(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'engrafo-export-2026-10-23.tar', { type: 'application/x-tar' });
}

/** The picker's file input, which is hidden behind its drop zone and has no role. */
function fileInput(canvasElement: HTMLElement): HTMLInputElement {
  const input = canvasElement.querySelector('input[type="file"]');
  if (input instanceof HTMLInputElement) {
    return input;
  }
  throw new Error('The import card rendered no file input');
}

const meta = {
  title: 'Domain/BackupSettings',
  component: BackupSettings,
  args: { maxImportBytes: MAX_IMPORT_BYTES, saveExport: fn(async () => {}) },
  render: (args) => (
    <div className="flex max-w-3xl flex-col gap-6 p-4">
      <BackupSettings {...args} />
    </div>
  ),
} satisfies Meta<typeof BackupSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

const exporting = server();

/** "Download export" mints a single-use link and hands it to the browser to save. */
export const Exports: Story = {
  parameters: { apolloClient: { resolvers: exporting.resolvers } },
  play: async ({ args, canvas }) => {
    await expect(await canvas.findByRole('button', { name: /Drop an export here/ })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Download export' }));
    await waitFor(() =>
      expect(args.saveExport).toHaveBeenCalledWith(
        '/export/a-single-use-token',
        expect.stringMatching(/^engrafo-export-.*\.tar$/),
      ),
    );
    await expect(exporting.calls.exportLinks).toBe(1);
    await expect(canvas.queryByText('Could not start the export')).not.toBeInTheDocument();
  },
};

const refusingExport = server({ exportRefused: true });

/** A link the server will not mint is said, not swallowed. */
export const ExportRefused: Story = {
  parameters: { apolloClient: { resolvers: refusingExport.resolvers } },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Download export' }));
    await expect(await canvas.findByText('Could not start the export')).toBeInTheDocument();
  },
};

const importing = server();

/** The import end to end: sign, PUT to the bucket, start, and the summary it reports. */
export const Imports: Story = {
  parameters: { apolloClient: { resolvers: importing.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /Drop an export here/ });
    await userEvent.upload(fileInput(canvasElement), archive(ARCHIVE_BYTES));

    await expect(await canvas.findByText('Finished')).toBeInTheDocument();
    await expect(importing.calls.uploads).toEqual([ARCHIVE_BYTES]);
    await expect(importing.calls.imports).toEqual(['imports/u/archive.tar']);
    await expect(canvas.getByText('2 documents')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Failed (1)' }));
    const failed = within(await canvas.findByRole('list', { name: 'Failed (1)' }));
    await expect(failed.getByText('Old scan')).toBeInTheDocument();
    await expect(failed.getByText('Its original is missing from the archive.')).toBeInTheDocument();
  },
};

const tooLarge = server();

/** An archive over the limit is refused before anything is asked of the server. */
export const ImportTooLarge: Story = {
  parameters: { apolloClient: { resolvers: tooLarge.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /Drop an export here/ });
    await userEvent.upload(fileInput(canvasElement), archive(OVER_THE_LIMIT_BYTES));
    await expect(await canvas.findByText('Could not import')).toBeInTheDocument();
    await expect(canvas.getByText(/an import takes up to 5\.0 MB/)).toBeInTheDocument();
    await expect(tooLarge.calls.uploads).toEqual([]);
  },
};

const denied = server({ bucket: MOCK_BUCKET_DENIED });

/** The bucket refuses the PUT — an expired signature, or CORS — and no import is started. */
export const BucketRefuses: Story = {
  parameters: { apolloClient: { resolvers: denied.resolvers } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /Drop an export here/ });
    await userEvent.upload(fileInput(canvasElement), archive(ARCHIVE_BYTES));
    await expect(await canvas.findByText(/Storage rejected the upload \(HTTP 403\)/)).toBeInTheDocument();
    await expect(denied.calls.imports).toEqual([]);
  },
};

const running = server({
  latest: job({ state: 'RUNNING', total: 10, imported: 3, skipped: [], failed: [], finishedAt: null }),
});

/**
 * An import still running when the tab is opened: its progress, and no second picker, since the
 * server would refuse a second run while this one goes.
 */
export const ImportRunning: Story = {
  parameters: { apolloClient: { resolvers: running.resolvers } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Importing…')).toBeInTheDocument();
    await expect(canvas.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute(
      'aria-valuetext',
      '3 of 10 documents',
    );
    await expect(canvas.queryByRole('button', { name: /Drop an export here/ })).not.toBeInTheDocument();
  },
};
