import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { expect, within } from 'storybook/test';
import {
  ContentFormatEnum,
  type DocumentDetailQuery,
  DocumentStatusEnum,
  FieldSourceEnum,
  MergeSuggestionBand,
  StepStatusEnum,
} from '@/__generated__/graphql';
import { documentPath, ROUTES } from '@/lib/routes';
import { DocumentRoute } from '@/routes/document';
import { DocumentsRoute } from '@/routes/documents';
import { MergeSuggestionsRoute } from '@/routes/merge-suggestions';
import { ProcessingRoute } from '@/routes/processing';
import { SettingsRoute } from '@/routes/settings';
import {
  DENTIST,
  ELECTRICITY_OCTOBER,
  ELECTRICITY_SEPTEMBER,
  GROCERIES,
  HARDWARE,
  LEASE,
  PAYSLIP,
  type SampleDocument,
  SCANS,
  sampleServer,
  TAX_RETURN,
  UTILITIES,
  WATER,
} from '../../../.storybook/sample-archive.ts';
import { AppLayout } from './app-layout';

/**
 * Whole screens: a real page inside the real shell, over a lived-in archive. The route stories
 * draw each page alone and the shell's own stories draw it around filler, so neither says that
 * the two fit together; these do. The claims are the shell's: the tree is in the sidebar beside
 * the page, the page's heading is there, and nothing pushes the window sideways.
 *
 * They are also what the project site's screenshots are taken from, which is why the data reads
 * like someone's paperwork rather than like a fixture.
 */

/** The route the page reads its params from, inside the shell, as `main.tsx` mounts it. */
function Screen({ path, page }: { path: string; page: ReactElement }) {
  return (
    <div className="h-screen">
      <Routes>
        <Route path={path} element={<AppLayout contentSlot={page} />} />
      </Routes>
    </div>
  );
}

/** What every screen here claims about the shell around the page. */
async function expectShellAround(canvasElement: HTMLElement, heading: string) {
  const canvas = within(canvasElement);
  const sidebar = within(canvas.getByRole('complementary'));
  // The tree has loaded, folders and documents both.
  await expect(await sidebar.findByText('Utilities')).toBeVisible();
  await expect(await sidebar.findByText('Lease agreement')).toBeVisible();
  await expect(await canvas.findByRole('heading', { level: 1, name: heading })).toBeVisible();
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
    canvasElement.ownerDocument.documentElement.clientWidth,
  );
}

const meta = {
  title: 'Layouts/AppLayout/Screens',
  component: AppLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A search hit as `searchDocuments` answers it. */
function hit(document: SampleDocument, snippet: string) {
  return { score: 0.03, snippet, document };
}

const SEARCH_HITS = [
  hit(ELECTRICITY_OCTOBER, '…your electricity consumption for October was 312 kWh, an amount due of 84.20 EUR…'),
  hit(ELECTRICITY_SEPTEMBER, '…for September we have billed 296 kWh. The amount due of 79.85 EUR will be debited…'),
  hit(WATER, '…water and wastewater charges for July to September, 41.60 EUR, payable by…'),
  hit(LEASE, '…the tenant pays the landlord 950 EUR on the first day of each month, plus utilities…'),
  hit(PAYSLIP, '…utilities allowance 45.00 EUR, paid with the October salary…'),
];

/** Search, by meaning and by word: each hit with its first page and the passage that matched. */
export const Searching: Story = {
  args: { contentSlot: <DocumentsRoute /> },
  render: () => <Screen path={ROUTES.documents} page={<DocumentsRoute />} />,
  parameters: {
    router: { initialEntries: [`${ROUTES.documents}?q=utility%20bills`] },
    apolloClient: { resolvers: sampleServer({ Query: { searchDocuments: () => SEARCH_HITS } }) },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, 'Documents');
    const results = await within(canvasElement).findByRole('list', { name: /Documents matching/ });
    await expect(within(results).getAllByRole('listitem')).toHaveLength(SEARCH_HITS.length);
  },
};

const BILL_TEXT = `# Stadtwerke München

**Electricity bill — October 2026**

Customer number 4471 2093 · Meter 1ESY1160 3378 21

| Period | Reading | Consumption |
| --- | --- | --- |
| 14 Sep – 13 Oct 2026 | 48 112 kWh | 312 kWh |

| Item | Amount |
| --- | ---: |
| Energy, 312 kWh at 0.2140 EUR | 66.77 EUR |
| Standing charge | 4.00 EUR |
| Net | 70.77 EUR |
| VAT 19% | 13.43 EUR |
| **Total due** | **84.20 EUR** |

The amount due will be debited from your account ending 3381 on 28 October 2026.
Questions about this bill? Call 089 2361 0 or write to service@example.com.
`;

type DetailDocument = NonNullable<DocumentDetailQuery['document']>;

function finished(step: string): DetailDocument['processingSteps'][number] {
  return {
    id: `${step}-step`,
    step,
    status: StepStatusEnum.Succeeded,
    attempts: 1,
    error: null,
    startedAt: '2026-10-15T07:02:00.000Z',
    finishedAt: '2026-10-15T07:02:41.000Z',
    progressDone: null,
    progressTotal: null,
  };
}

const BILL: DetailDocument = {
  id: ELECTRICITY_OCTOBER.id,
  title: ELECTRICITY_OCTOBER.title,
  folderId: UTILITIES.id,
  folder: { id: UTILITIES.id, name: UTILITIES.name },
  originalFilename: 'stadtwerke-2026-10.pdf',
  mimeType: 'application/pdf',
  sizeBytes: ELECTRICITY_OCTOBER.sizeBytes,
  checksumSha256: '4c1b7e0f5a2d9c3e8b6a1f0d7e2c5b9a3d8f1e6c0b4a7d2e9f5c1b8a3e6d0f2c',
  archiveKey: 'archive/2.pdf',
  contentKey: 'text/2.md',
  contentBytes: BILL_TEXT.length,
  contentFormat: ContentFormatEnum.Markdown,
  ocrRequested: true,
  visionRequested: true,
  status: DocumentStatusEnum.Ready,
  error: null,
  createdAt: '2026-10-15T07:02:00.000Z',
  documentDate: '2026-10-14',
  documentDateSource: FieldSourceEnum.Extracted,
  vendor: 'Stadtwerke München',
  total: '84.20',
  currency: 'EUR',
  receiptSource: FieldSourceEnum.Extracted,
  processingSteps: ['inspect', 'ocr', 'vision', 'metadata', 'index', 'thumbnail'].map(finished),
};

/** A bill read by the vision model: its text as Markdown, with the receipt and details beside it. */
export const ReadingADocument: Story = {
  args: { contentSlot: <DocumentRoute /> },
  render: () => <Screen path={ROUTES.document} page={<DocumentRoute />} />,
  parameters: {
    router: { initialEntries: [`${documentPath(BILL.id)}?tab=text`] },
    apolloClient: {
      resolvers: sampleServer({
        Query: {
          document: () => BILL,
          documentFileUrl: () => `data:text/plain,${encodeURIComponent(BILL_TEXT)}`,
        },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, BILL.title);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Total due')).toBeVisible();
    // Once in the text and once in the receipt card beside it.
    await expect(canvas.getAllByText('Stadtwerke München').length).toBeGreaterThanOrEqual(2);
  },
};

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS).toISOString();

// The running read is on page 8 of 18: seven done.
const PAGES_DONE = 7;
const PAGES = 18;
const FINISHED_TODAY = 14;
const QUEUED_FOR_MINUTES = 4;
const READING_FOR_MINUTES = 6;
// When each key was last used.
const LAPTOP_KEY_USED_MINUTES_AGO = 42;
const DESKTOP_KEY_USED_HOURS_AGO = 26;

/** A row of the processing page, as `processing.entries` answers it. */
function entry(
  document: SampleDocument,
  status: DocumentStatusEnum,
  steps: { step: string; status: StepStatusEnum; progressDone?: number; progressTotal?: number; startedAt?: string }[],
  finishedMinutesAgo: number | null = null,
) {
  return {
    finishedAt: finishedMinutesAgo === null ? null : ago(finishedMinutesAgo),
    document: {
      id: document.id,
      title: document.title,
      folderId: document.folderId,
      status,
      error: null,
      updatedAt: ago(QUEUED_FOR_MINUTES),
    },
    steps: steps.map((step) => ({ error: null, progressDone: null, progressTotal: null, startedAt: null, ...step })),
  };
}

const PROCESSING_ROWS = {
  RUNNING: [
    entry(TAX_RETURN, DocumentStatusEnum.Processing, [
      { step: 'ocr', status: StepStatusEnum.Succeeded },
      {
        step: 'vision',
        status: StepStatusEnum.Running,
        progressDone: PAGES_DONE,
        progressTotal: PAGES,
        startedAt: ago(READING_FOR_MINUTES),
      },
    ]),
  ],
  QUEUED: [GROCERIES, HARDWARE, DENTIST].map((doc) =>
    entry(doc, DocumentStatusEnum.Uploaded, [{ step: 'ocr', status: StepStatusEnum.Queued }]),
  ),
  FAILED: [],
  FINISHED: [],
};

/** A batch going through: one read page by page, three waiting their turn. */
export const Processing: Story = {
  args: { contentSlot: <ProcessingRoute /> },
  render: () => <Screen path={ROUTES.processing} page={<ProcessingRoute />} />,
  parameters: {
    router: { initialEntries: [ROUTES.processing] },
    apolloClient: {
      resolvers: sampleServer({
        Query: {
          processing: () => ({
            concurrency: 1,
            finishedWithinHours: 24,
            listLimit: 200,
            counts: {
              running: PROCESSING_ROWS.RUNNING.length,
              queued: PROCESSING_ROWS.QUEUED.length,
              failed: PROCESSING_ROWS.FAILED.length,
              finished: FINISHED_TODAY,
            },
            entries: ({ state }: { state: keyof typeof PROCESSING_ROWS }) => PROCESSING_ROWS[state],
          }),
        },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, 'Processing');
    await expect(
      await within(canvasElement).findByText(`Page ${PAGES_DONE + 1} of ${PAGES}`, { exact: false }),
    ).toBeVisible();
  },
};

const SUGGESTIONS = [
  {
    id: '2a3b4c5d-6e7f-4801-9a2b-000000000001',
    confidence: 0.93,
    heuristicConfidence: 0.86,
    band: MergeSuggestionBand.High,
    createdAt: '2026-11-17T09:00:00.000Z',
    documents: SCANS,
    reasons: [
      { signal: 'pageMarker', text: 'page 2 of 3 follows page 1', points: 3 },
      { signal: 'sequence', text: 'scan_0004 then scan_0005', points: 2 },
      { signal: 'time', text: 'scanned 40 s apart', points: 1.5 },
      { signal: 'ai', text: 'AI: page 3 continues page 2 (the table runs on)', points: 1.2 },
      { signal: 'letterhead', text: 'page 3 opens with a date', points: -0.8 },
    ],
    verdicts: [
      {
        fromId: SCANS[1].id,
        toId: SCANS[2].id,
        continues: true,
        confidence: 0.8,
        reason: 'the table runs on',
        model: 'qwen2.5vl:7b',
        checkedAt: '2026-11-17T09:01:00.000Z',
      },
    ],
  },
];

/** A scan filed a page per file, found and explained before anything is merged. */
export const SuggestedMerges: Story = {
  args: { contentSlot: <MergeSuggestionsRoute /> },
  render: () => <Screen path={ROUTES.mergeSuggestions} page={<MergeSuggestionsRoute />} />,
  parameters: {
    router: { initialEntries: [ROUTES.mergeSuggestions] },
    apolloClient: {
      resolvers: sampleServer({
        Query: { mergeSuggestions: () => ({ count: SUGGESTIONS.length, suggestions: SUGGESTIONS }) },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, 'Suggested merges');
    await expect(
      await within(canvasElement).findByRole('heading', { level: 2, name: 'scan_0004 and 2 more' }),
    ).toBeVisible();
  },
};

const API_KEYS = [
  {
    id: '3f2a1b4c-5d6e-4f70-8a9b-000000000001',
    name: 'Claude Code on my laptop',
    start: 'engr_Ab12Cd34',
    lastUsedAt: ago(LAPTOP_KEY_USED_MINUTES_AGO),
    expiresAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: '3f2a1b4c-5d6e-4f70-8a9b-000000000002',
    name: 'Claude Desktop',
    start: 'engr_Xy98Wv76',
    lastUsedAt: ago(DESKTOP_KEY_USED_HOURS_AGO * HOUR_MINUTES),
    expiresAt: null,
    createdAt: '2026-10-12T18:30:00.000Z',
  },
];

const ADMIN = {
  id: '9c1f0a6e-5d33-4f1b-8e27-0a9b8c7d6e5f',
  email: 'archivist@example.com',
  createdAt: '2026-01-14T09:30:00.000Z',
  isAdmin: true,
};

/** What the admin's Settings tabs ask the server for, whichever tab is open. */
const ADMIN_SETTINGS = {
  me: () => ADMIN,
  latestImport: () => null,
  ssoSetup: () => ({
    source: 'NONE',
    issuer: null,
    name: null,
    canPair: true,
    redirectUri: 'http://nas.local:3004/api/auth/callback/oidc',
  }),
  visionModels: () => [{ id: 'qwen2.5vl:7b', contextLength: null }],
};

// The vision model's own defaults, as the server answers a fresh install.
const VISION_TIMEOUT_SECONDS = 600;
const VISION_MAX_TOKENS = 4096;
const VISION_TEMPERATURE = 0.6;

const VISION_SETTINGS = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5vl:7b',
  hasApiKey: false,
  auto: true,
  skipOcr: false,
  requestTimeoutSeconds: VISION_TIMEOUT_SECONDS,
  maxResponseTokens: VISION_MAX_TOKENS,
  imageDetail: 'AUTO',
  temperature: VISION_TEMPERATURE,
  topP: null,
  topK: null,
  minP: null,
  presencePenalty: null,
  frequencyPenalty: null,
  repeatPenalty: null,
  textFormat: 'MARKDOWN',
  prompt: null,
  builtInPrompts: { plain: 'Transcribe the page.', markdown: 'Transcribe the page as Markdown.' },
  configured: true,
};

/** The admin's Processing tab: a local vision model, connected, reading every scan as Markdown. */
export const ConfiguringTheVisionModel: Story = {
  args: { contentSlot: <SettingsRoute /> },
  render: () => <Screen path={ROUTES.settings} page={<SettingsRoute />} />,
  parameters: {
    router: { initialEntries: [`${ROUTES.settings}?tab=processing`] },
    apolloClient: {
      resolvers: sampleServer({
        Query: { ...ADMIN_SETTINGS, apiKeys: () => [], visionSettings: () => VISION_SETTINGS },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, 'Settings');
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('textbox', { name: 'Base URL' })).toHaveValue(VISION_SETTINGS.baseUrl);
    await expect(await canvas.findByText('Connected')).toBeVisible();
  },
};

/** The MCP tab: the endpoint and the keys agents read the shared folder with (Receipts, marked in the tree). */
export const SharingWithAnAgent: Story = {
  args: { contentSlot: <SettingsRoute /> },
  render: () => <Screen path={ROUTES.settings} page={<SettingsRoute />} />,
  parameters: {
    router: { initialEntries: [`${ROUTES.settings}?tab=mcp`] },
    apolloClient: {
      resolvers: sampleServer({
        Query: {
          ...ADMIN_SETTINGS,
          apiKeys: () => API_KEYS,
          visionSettings: () => VISION_SETTINGS,
        },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    await expectShellAround(canvasElement, 'Settings');
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Claude Desktop')).toBeVisible();
    // The shared folder wears its mark in the tree.
    await expect(within(canvas.getByRole('complementary')).getByText('MCP')).toBeVisible();
  },
};
