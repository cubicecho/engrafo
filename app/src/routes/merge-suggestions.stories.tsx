import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { MergeSuggestionBand } from '@/__generated__/graphql';
import { clientId } from '@/lib/id';
import { documentPath, mergeSuggestionPath, ROUTES } from '@/lib/routes';
import { archiveServer, SERVER_CONFIG, TAXES } from '../../.storybook/archive.ts';
import { MergeSuggestionsRoute } from './merge-suggestions';

/**
 * Suggested merges against a mock server built from the real SDL, one that remembers: a dismissal
 * or a merge takes the suggestion off the next read, as the real one does, and "Check again"
 * finds one more. The claims are that each card shows its documents in page order with the band,
 * the reasons for and against and the model's part only when it checked; that Dismiss and Review
 * merge send their mutation for that card; and that the dialog opens in the suggested order,
 * from the card or from a link.
 */

interface DocumentFixture {
  id: string;
  title: string;
  folderId: string | null;
  mimeType: string;
  sizeBytes: number;
  archiveKey: string | null;
}

function page(title: string, overrides: Partial<DocumentFixture> = {}): DocumentFixture {
  return {
    id: clientId(),
    title,
    folderId: null,
    mimeType: 'application/pdf',
    sizeBytes: 182_113,
    archiveKey: null,
    ...overrides,
  };
}

const SCANS = [
  page('scan_0004', { folderId: TAXES.id }),
  page('scan_0005', { folderId: TAXES.id }),
  page('scan_0006', { folderId: TAXES.id }),
];
const PHOTOS = [page('IMG_1234', { mimeType: 'image/jpeg' }), page('IMG_1235', { mimeType: 'image/jpeg' })];
const RECEIPT = [page('Receipt front'), page('Receipt back')];
const LETTER = [page('Letter page 1'), page('Letter page 2')];

function suggestion(id: string, documents: DocumentFixture[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    confidence: 0.9,
    heuristicConfidence: 0.9,
    band: MergeSuggestionBand.High,
    reasons: [],
    verdicts: [],
    createdAt: '2026-11-17T09:00:00.000Z',
    documents,
    ...overrides,
  };
}

const SURE = suggestion(clientId(), SCANS, {
  confidence: 0.93,
  heuristicConfidence: 0.93,
  band: MergeSuggestionBand.High,
  reasons: [
    { signal: 'pageMarker', text: 'page 2 of 3 follows page 1', points: 3 },
    { signal: 'time', text: 'scanned 40 s apart', points: 1.5 },
    { signal: 'sequence', text: 'scan_0004 then scan_0005', points: 2 },
    { signal: 'letterhead', text: 'page 3 opens with a date', points: -0.8 },
  ],
});
const CONFIRMED = suggestion(clientId(), PHOTOS, {
  confidence: 0.74,
  heuristicConfidence: 0.58,
  band: MergeSuggestionBand.Medium,
  reasons: [
    { signal: 'ai', text: 'AI: page 2 continues page 1 (the sentence runs on)', points: 2.4 },
    { signal: 'time', text: 'scanned 2 min apart', points: 1 },
  ],
  verdicts: [
    {
      fromId: PHOTOS[0].id,
      toId: PHOTOS[1].id,
      continues: true,
      confidence: 0.8,
      reason: 'the sentence runs on',
      model: 'qwen3-vl',
      checkedAt: '2026-11-17T09:01:00.000Z',
    },
  ],
});
const UNSURE = suggestion(clientId(), RECEIPT, {
  confidence: 0.55,
  heuristicConfidence: 0.55,
  band: MergeSuggestionBand.Low,
  reasons: [{ signal: 'time', text: 'scanned 10 s apart', points: 1.5 }],
});
const FOUND_ON_RESCORE = suggestion(clientId(), LETTER, {
  confidence: 0.88,
  heuristicConfidence: 0.88,
  reasons: [{ signal: 'pageMarker', text: 'page 2 of 2 follows page 1', points: 3 }],
});

type Suggestion = ReturnType<typeof suggestion>;

/** What a story's server was asked to do, in order. */
let calls: string[] = [];

function suggestionsServer(start: Suggestion[]) {
  const shown = [...start];
  const archive = archiveServer({ folders: [TAXES], documents: [] });
  const take = (matches: (each: Suggestion) => boolean) => {
    const index = shown.findIndex(matches);
    if (index >= 0) {
      shown.splice(index, 1);
    }
    return index >= 0;
  };
  return {
    Query: {
      ...archive.Query,
      serverConfig: () => ({ ...SERVER_CONFIG, visionAvailable: true }),
      mergeSuggestions: () => ({ count: shown.length, suggestions: shown }),
      // The dialog frames the file it previews; `about:blank`, so nothing loads.
      documentFileUrl: () => 'about:blank',
    },
    Mutation: {
      dismissMergeSuggestion: (_parent: unknown, args: { id: string }) => {
        calls.push(`dismiss ${args.id}`);
        if (take((each) => each.id === args.id) === false) {
          throw new Error('Suggestion not found');
        }
        return true;
      },
      rescoreMergeSuggestions: () => {
        calls.push('rescore');
        if (shown.includes(FOUND_ON_RESCORE) === false) {
          shown.push(FOUND_ON_RESCORE);
        }
        return { count: shown.length, suggestions: shown };
      },
      mergeDocuments: (_parent: unknown, args: { input: { ids: string[]; title: string } }) => {
        calls.push(`merge ${args.input.ids.join(',')}`);
        // The server marks the suggestion of exactly this set merged, in any order.
        const key = [...args.input.ids].sort().join(',');
        take(
          (each) =>
            each.documents
              .map((doc) => doc.id)
              .sort()
              .join(',') === key,
        );
        return { id: clientId(), title: args.input.title };
      },
    },
  };
}

/** Bounded height, because `PageLayout` is a sticky chassis that scrolls its own body. */
function Framed() {
  return (
    <div className="h-screen">
      <MergeSuggestionsRoute />
    </div>
  );
}

/** The card a heading names: the card's own region, found from its title. */
async function cardTitled(canvas: ReturnType<typeof within>, name: string) {
  const heading: HTMLElement = await canvas.findByRole('heading', { level: 2, name });
  const card = heading.closest<HTMLElement>('[data-slot="card-layout"]');
  if (card === null) {
    throw new Error(`"${name}" is not a card's title`);
  }
  return within(card);
}

const meta = {
  title: 'Routes/MergeSuggestions',
  component: MergeSuggestionsRoute,
  render: () => <Framed />,
  parameters: { layout: 'fullscreen', router: { initialEntries: [ROUTES.mergeSuggestions] } },
  beforeEach: () => {
    calls = [];
  },
} satisfies Meta<typeof MergeSuggestionsRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One card per suggestion, in the order the server ranks them. Each says its band in words as
 * well as colour, lists its documents in page order as links, and puts the rules' reasons under
 * For and Against. The model's part is a line of its own, on the one it checked only.
 */
export const Suggestions: Story = {
  parameters: { apolloClient: { resolvers: suggestionsServer([SURE, CONFIRMED, UNSURE]) } },
  play: async ({ canvas }) => {
    await canvas.findByRole('heading', { level: 2, name: 'scan_0004 and 2 more' });
    const titles = canvas.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    await expect(titles).toEqual(['scan_0004 and 2 more', 'IMG_1234 and 1 more', 'Receipt front and 1 more']);

    const sure = await cardTitled(canvas, 'scan_0004 and 2 more');
    await expect(sure.getByText('High · 93%')).toBeVisible();
    const pages = within(sure.getByRole('list', { name: /in page order/ })).getAllByRole('link');
    await expect(pages.map((link) => link.textContent)).toEqual([
      expect.stringContaining('scan_0004'),
      expect.stringContaining('scan_0005'),
      expect.stringContaining('scan_0006'),
    ]);
    await expect(pages[0]).toHaveAttribute('href', documentPath(SCANS[0].id));
    await expect(pages[0]).toHaveTextContent('Taxes');
    // The strongest first on each side.
    const supporting = within(sure.getByRole('list', { name: 'For' })).getAllByRole('listitem');
    await expect(supporting.map((row) => row.textContent)).toEqual([
      'page 2 of 3 follows page 1',
      'scan_0004 then scan_0005',
      'scanned 40 s apart',
    ]);
    await expect(
      within(sure.getByRole('list', { name: 'Against' })).getByText('page 3 opens with a date'),
    ).toBeVisible();
    // The rules decided this one alone.
    await expect(sure.queryByText(/AI/)).not.toBeInTheDocument();

    const confirmed = await cardTitled(canvas, 'IMG_1234 and 1 more');
    await expect(confirmed.getByText('Medium · 74%')).toBeVisible();
    await expect(confirmed.getByText('rules 58% · AI confirmed: the sentence runs on')).toBeVisible();
    // Said once, in that line, not again among the rules' reasons.
    await expect(confirmed.queryByText(/^AI: page 2/)).not.toBeInTheDocument();
    await expect(confirmed.queryByRole('list', { name: 'Against' })).not.toBeInTheDocument();

    const unsure = await cardTitled(canvas, 'Receipt front and 1 more');
    await expect(unsure.getByText('Low · 55%')).toBeVisible();
  },
};

/** Dismiss sends the mutation for that card, and the card goes; the others stay. */
export const Dismissing: Story = {
  parameters: { apolloClient: { resolvers: suggestionsServer([SURE, CONFIRMED]) } },
  play: async ({ canvas }) => {
    const sure = await cardTitled(canvas, 'scan_0004 and 2 more');
    await userEvent.click(sure.getByRole('button', { name: /^Dismiss/ }));

    await waitFor(() => expect(calls).toEqual([`dismiss ${SURE.id}`]));
    await waitFor(() =>
      expect(canvas.queryByRole('heading', { level: 2, name: 'scan_0004 and 2 more' })).not.toBeInTheDocument(),
    );
    await expect(canvas.getByRole('heading', { level: 2, name: 'IMG_1234 and 1 more' })).toBeVisible();
  },
};

/**
 * Review merge opens the merge dialog with the documents in the order suggested, the title
 * suggestion there because a model is set up, and Merge sends exactly that order. The card goes
 * once the set is merged, and the page links to the new document.
 */
export const ReviewingAMerge: Story = {
  parameters: { apolloClient: { resolvers: suggestionsServer([SURE, CONFIRMED]) } },
  play: async ({ canvas, canvasElement }) => {
    const sure = await cardTitled(canvas, 'scan_0004 and 2 more');
    await userEvent.click(sure.getByRole('button', { name: /^Review merge/ }));

    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Merge documents' }));
    const rows = within(dialog.getByRole('list', { name: 'Documents to merge, in page order' })).getAllByRole(
      'listitem',
    );
    await expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('scan_0004'),
      expect.stringContaining('scan_0005'),
      expect.stringContaining('scan_0006'),
    ]);
    await expect(dialog.getByRole('button', { name: /Suggest a title/ })).toBeVisible();

    await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(calls).toEqual([`merge ${SCANS.map((doc) => doc.id).join(',')}`]));
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Merge documents' })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(canvas.queryByRole('heading', { level: 2, name: 'scan_0004 and 2 more' })).not.toBeInTheDocument(),
    );
    const merged = (await canvas.findByText('Merged')).closest<HTMLElement>('[data-slot="alert"]');
    if (merged === null) {
      throw new Error('The merge is not reported in an alert');
    }
    await expect(within(merged).getByRole('link', { name: 'scan_0004' })).toBeVisible();
  },
};

/** `?review=<id>` is the document page's way in: the dialog is open on arrival. */
export const OpenedFromALink: Story = {
  parameters: {
    router: { initialEntries: [mergeSuggestionPath(CONFIRMED.id)] },
    apolloClient: { resolvers: suggestionsServer([SURE, CONFIRMED]) },
  },
  play: async ({ canvasElement }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Merge documents' }),
    );
    const rows = within(dialog.getByRole('list', { name: 'Documents to merge, in page order' })).getAllByRole(
      'listitem',
    );
    await expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('IMG_1234'),
      expect.stringContaining('IMG_1235'),
    ]);
  },
};

/** "Check again" asks for a rescore now, and what it found is on the page when it answers. */
export const CheckingAgain: Story = {
  parameters: { apolloClient: { resolvers: suggestionsServer([]) } },
  play: async ({ canvas }) => {
    await canvas.findByText('Nothing to merge');
    await userEvent.click(canvas.getByRole('button', { name: /^Check again/ }));

    await waitFor(() => expect(calls).toEqual(['rescore']));
    await expect(await canvas.findByRole('heading', { level: 2, name: 'Letter page 1 and 1 more' })).toBeVisible();
  },
};

/** The server said there are none: an empty state that says where they come from. */
export const Empty: Story = {
  parameters: { apolloClient: { resolvers: suggestionsServer([]) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Nothing to merge')).toBeVisible();
    await expect(canvas.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  },
};
