import type { MockLink } from '@apollo/client/testing';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphQLError } from 'graphql';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import {
  CompleteDocumentUploadDocument,
  CreateDocumentUploadDocument,
  DocumentStatusEnum,
  UploadDuplicatesDocument,
} from '@/__generated__/graphql';
import { documentPath } from '@/lib/routes';
import { MOCK_BUCKET_DENIED, MOCK_BUCKET_OK } from '../../../.storybook/mock-bucket.ts';
import { UploadPanel } from './upload-panel';

/**
 * The upload panel, with a server and a bucket that both answer.
 *
 * Three things happen per file and only the middle one is not GraphQL: `createDocumentUpload`
 * hands back a presigned URL, the browser PUTs the bytes straight to it, then
 * `completeDocumentUpload` tells the server they landed. The stories here drive that whole
 * sequence — Apollo mocks for the two mutations, the harness's mock bucket for the PUT — because
 * the branches worth watching are the ones between those calls: a file too large to bother
 * asking about, and a bucket that says no after the row already exists.
 */

const MAX_UPLOAD_BYTES = 5_242_880;
const OVER_THE_LIMIT_BYTES = 6_291_456;
const SCAN_BYTES = 1024;

const CONFIG = {
  maxUploadBytes: MAX_UPLOAD_BYTES,
  acceptedMimeTypes: ['application/pdf', 'image/png', 'text/plain'],
  ocrAvailable: true,
  ocrDefault: true,
};

const DOCUMENT_ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';
const TAXES_ID = '7d1e0c55-8a2b-4f3c-9d4e-5f6a7b8c9d0e';
const YEAR_ID = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';

const FOLDERS = [
  { id: TAXES_ID, name: 'Taxes', parentId: null },
  { id: YEAR_ID, name: '2026', parentId: TAXES_ID },
];

function file(name: string, bytes: number, type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * The panel's file input, found by selector because it has no role to find it by.
 *
 * It is `hidden` and the dropzone button stands in for it, so it is absent from the
 * accessibility tree — which is the one case a role query cannot reach.
 *
 * @param canvasElement - The story's root element.
 * @returns The hidden `<input type="file">`.
 */
function fileInput(canvasElement: HTMLElement): HTMLInputElement {
  const input = canvasElement.querySelector('input[type="file"]');
  if (input instanceof HTMLInputElement) {
    return input;
  }
  throw new Error('The upload panel rendered no file input');
}

/** The pair of mutations one successful upload makes, pointed at a bucket that accepts. */
function uploadMocks(uploadUrl: string, folderId: string | null = null): MockLink.MockedResponse[] {
  return [
    {
      request: {
        query: CreateDocumentUploadDocument,
        variables: {
          input: {
            filename: 'scan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: SCAN_BYTES,
            ocr: true,
            folderId,
          },
        },
      },
      result: {
        data: {
          createDocumentUpload: {
            document: { id: DOCUMENT_ID },
            uploadUrl,
            uploadHeaders: [{ name: 'Content-Type', value: 'application/pdf' }],
          },
        },
      },
    },
    {
      request: { query: CompleteDocumentUploadDocument, variables: { id: DOCUMENT_ID } },
      result: { data: { completeDocumentUpload: { id: DOCUMENT_ID, status: 'uploaded' } } },
    },
    // Once it is done the panel asks whether it was a duplicate; this one is not.
    {
      request: { query: UploadDuplicatesDocument, variables: { ids: [DOCUMENT_ID] } },
      result: {
        data: {
          documentDuplicates: [
            {
              document: { id: DOCUMENT_ID, status: DocumentStatusEnum.Ready },
              checked: true,
              duplicates: [],
            },
          ],
        },
      },
    },
  ];
}

const meta = {
  title: 'Domain/UploadPanel',
  component: UploadPanel,
  args: { config: CONFIG, folders: FOLDERS, folderId: null, onFolderChange: fn(), onChanged: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof UploadPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing uploading yet: the dropzone, the limit it will enforce, and the OCR switch. */
export const Idle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /up to 5.0 MB each/i })).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Run OCR on new uploads' })).toBeChecked();
  },
};

/**
 * The server has OCR turned off, or `ocrmypdf` is not installed on it. The switch is off and
 * disabled and says why — the failure mode this guards against is a toggle that looks live,
 * takes a click, and quietly changes nothing.
 */
export const OcrUnavailable: Story = {
  args: { config: { ...CONFIG, ocrAvailable: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ocr = canvas.getByRole('switch', { name: 'Run OCR on new uploads' });
    await expect(ocr).toBeDisabled();
    await expect(ocr).not.toBeChecked();
    await expect(ocr).toHaveAccessibleDescription(/ocrmypdf is not installed/i);
  },
};

/**
 * A file over the limit. There are no Apollo mocks on purpose: the size check happens before
 * `createDocumentUpload`, so a story that passes here proves the panel did not ask the server
 * to sign a URL it was always going to refuse.
 */
export const RejectsAnOversizedFile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = fileInput(canvasElement);

    await userEvent.upload(input, file('enormous.pdf', OVER_THE_LIMIT_BYTES));

    const job = await canvas.findByRole('listitem');
    await expect(job).toHaveTextContent(/Larger than the 5.0 MB limit/i);
    await expect(job).toHaveTextContent('Failed');
  },
};

/** The happy path, end to end: sign, PUT the bytes, confirm. */
export const UploadsAFile: Story = {
  parameters: { apolloClient: { mocks: uploadMocks(MOCK_BUCKET_OK) } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = fileInput(canvasElement);

    await userEvent.upload(input, file('scan.pdf', SCAN_BYTES));

    await waitFor(() => expect(canvas.getByRole('listitem')).toHaveTextContent('Uploaded'));
    await expect(canvas.queryByText(/Already in your archive/)).not.toBeInTheDocument();
    // Twice: once when the row exists so the list can show it as pending, once when it is done.
    // The list has no subscription, so a missed call is a row that never appears.
    await expect(args.onChanged).toHaveBeenCalledTimes(2);
  },
};

/** The folder picker offers the top level and every folder by its path, and says which was chosen. */
export const ChoosesAFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const picker = canvas.getByRole('combobox', { name: 'Upload into' });
    await expect(picker).toHaveTextContent('Top level');

    await userEvent.click(picker);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('option', { name: 'Taxes/2026' }));
    await expect(args.onFolderChange).toHaveBeenCalledWith(YEAR_ID);
  },
};

/** With a folder chosen, `createDocumentUpload` names it, so the document lands there. */
export const UploadsIntoAFolder: Story = {
  args: { folderId: YEAR_ID },
  parameters: { apolloClient: { mocks: uploadMocks(MOCK_BUCKET_OK, YEAR_ID) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('combobox', { name: 'Upload into' })).toHaveTextContent('Taxes/2026');

    await userEvent.upload(fileInput(canvasElement), file('scan.pdf', SCAN_BYTES));
    await waitFor(() => expect(canvas.getByRole('listitem')).toHaveTextContent('Uploaded'));
  },
};

/**
 * The bucket refuses the PUT — an expired signature, or CORS. The server already has the row,
 * and the panel has to say so rather than looking like nothing happened.
 */
export const StorageRefusesTheUpload: Story = {
  parameters: { apolloClient: { mocks: uploadMocks(MOCK_BUCKET_DENIED) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = fileInput(canvasElement);

    await userEvent.upload(input, file('scan.pdf', SCAN_BYTES));

    await waitFor(() =>
      expect(canvas.getByRole('listitem')).toHaveTextContent(/Storage rejected the upload \(HTTP 403\)/i),
    );
  },
};

/**
 * The server refuses before there is anything to PUT: a type its allowlist has since dropped, or
 * a full disk. The row says why, and the bucket is never asked.
 */
export const ServerRefusesTheUpload: Story = {
  parameters: {
    apolloClient: {
      mocks: [
        {
          request: {
            query: CreateDocumentUploadDocument,
            variables: {
              input: {
                filename: 'scan.pdf',
                mimeType: 'application/pdf',
                sizeBytes: SCAN_BYTES,
                ocr: true,
                folderId: null,
              },
            },
          },
          result: {
            errors: [
              new GraphQLError('This server no longer accepts PDFs', { extensions: { code: 'BAD_USER_INPUT' } }),
            ],
          },
        },
      ],
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(fileInput(canvasElement), file('scan.pdf', SCAN_BYTES));

    const job = await canvas.findByRole('listitem');
    await waitFor(() => expect(job).toHaveTextContent('This server no longer accepts PDFs'));
    await expect(job).toHaveTextContent('Failed');
    await expect(args.onChanged).not.toHaveBeenCalled();
  },
};

const EARLIER_ID = '5c4b3a29-1807-4f6e-8d5c-4b3a29180716';
// The pipeline's first step has to run before the server knows the checksum, so the panel's
// first look finds nothing to say and it has to look again.
let duplicateLooks = 0;

/**
 * The file is one the reader already has. The upload still stands, since that is sometimes
 * meant, and the row says where the other copy is once the server has read the checksum: the
 * first answer is "not checked yet", so this also proves the panel asks again.
 */
export const WarnsAboutADuplicate: Story = {
  parameters: {
    apolloClient: {
      resolvers: {
        Mutation: {
          createDocumentUpload: () => ({
            document: { id: DOCUMENT_ID },
            uploadUrl: MOCK_BUCKET_OK,
            uploadHeaders: [{ name: 'Content-Type', value: 'application/pdf' }],
          }),
          completeDocumentUpload: () => ({ id: DOCUMENT_ID, status: DocumentStatusEnum.Uploaded }),
        },
        Query: {
          documentDuplicates: () => {
            duplicateLooks += 1;
            const checked = duplicateLooks > 1;
            return [
              {
                document: {
                  id: DOCUMENT_ID,
                  status: checked ? DocumentStatusEnum.Processing : DocumentStatusEnum.Uploaded,
                },
                checked,
                duplicates: checked ? [{ id: EARLIER_ID, title: 'scan', folderId: YEAR_ID }] : [],
              },
            ];
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    duplicateLooks = 0;
    const canvas = within(canvasElement);
    await userEvent.upload(fileInput(canvasElement), file('scan.pdf', SCAN_BYTES));
    await waitFor(() => expect(canvas.getByRole('listitem')).toHaveTextContent('Uploaded'));

    const other = await canvas.findByRole('link', { name: 'Taxes/2026/scan' }, { timeout: 10_000 });
    await expect(other).toHaveAttribute('href', documentPath(EARLIER_ID));
    await expect(canvas.getByRole('link', { name: 'Open this copy' })).toHaveAttribute(
      'href',
      documentPath(DOCUMENT_ID),
    );
    await expect(duplicateLooks).toBeGreaterThan(1);
  },
};
