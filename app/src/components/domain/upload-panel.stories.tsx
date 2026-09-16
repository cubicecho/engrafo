import type { MockLink } from '@apollo/client/testing';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { CompleteDocumentUploadDocument, CreateDocumentUploadDocument } from '@/__generated__/graphql';
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

const CONFIG = {
  maxUploadBytes: 5 * 1024 * 1024,
  acceptedMimeTypes: ['application/pdf', 'image/png', 'text/plain'],
  ocrAvailable: true,
  ocrDefault: true,
};

const DOCUMENT_ID = '3f7c5d2e-0b41-4c8a-9e5b-1d2a3b4c5d6e';

function file(name: string, bytes: number, type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** The pair of mutations one successful upload makes, pointed at a bucket that accepts. */
function uploadMocks(uploadUrl: string): MockLink.MockedResponse[] {
  return [
    {
      request: {
        query: CreateDocumentUploadDocument,
        variables: {
          input: {
            filename: 'scan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            ocr: true,
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
  ];
}

const meta = {
  title: 'Domain/UploadPanel',
  component: UploadPanel,
  args: { config: CONFIG, onChanged: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof UploadPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing uploading yet: the dropzone, the limit it will enforce, and the OCR switch. */
export const Idle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/up to 5.0 MB each/i)).toBeInTheDocument();
    await expect(canvas.getByLabelText('Run OCR on new uploads')).toBeChecked();
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
    const ocr = canvas.getByLabelText('Run OCR on new uploads');
    await expect(ocr).toBeDisabled();
    await expect(ocr).not.toBeChecked();
    await expect(canvas.getByText(/ocrmypdf is not installed/i)).toBeInTheDocument();
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
    const input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, file('enormous.pdf', 6 * 1024 * 1024));

    await waitFor(() => expect(canvas.getByText(/Larger than the 5.0 MB limit/i)).toBeInTheDocument());
    await expect(canvas.getByText('Failed')).toBeInTheDocument();
  },
};

/** The happy path, end to end: sign, PUT the bytes, confirm. */
export const UploadsAFile: Story = {
  parameters: { apolloClient: { mocks: uploadMocks(MOCK_BUCKET_OK) } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, file('scan.pdf', 1024));

    await waitFor(() => expect(canvas.getByText('Uploaded')).toBeInTheDocument());
    // Twice: once when the row exists so the list can show it as pending, once when it is done.
    // The list has no subscription, so a missed call is a row that never appears.
    await expect(args.onChanged).toHaveBeenCalledTimes(2);
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
    const input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, file('scan.pdf', 1024));

    await waitFor(() => expect(canvas.getByText(/Storage rejected the upload \(HTTP 403\)/i)).toBeInTheDocument());
  },
};
