import { type ArchiveQuery, DocumentStatusEnum } from '@/__generated__/graphql';
import { archiveServer, SERVER_CONFIG } from './archive.ts';

// A lived-in archive for the stories that draw a whole screen, shell and all: a household's
// folders, the documents in them, and a couple of saved searches. The ids are fixed, not
// `clientId()`, so a screen comes out the same every run and a story can link to a document.

type Folder = ArchiveQuery['folders'][number];
type ArchiveDocument = ArchiveQuery['documents'][number];

function folder(id: string, name: string, parentId: string | null = null, mcpEnabled = false): Folder {
  return { id, name, parentId, mcpEnabled };
}

export const HOME = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000001', 'Home');
export const UTILITIES = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000002', 'Utilities', HOME.id);
export const MEDICAL = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000003', 'Medical');
export const RECEIPTS = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000004', 'Receipts', null, true);
export const TAXES = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000005', 'Taxes');
export const TAXES_2025 = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000006', '2025', TAXES.id);
export const TAXES_2026 = folder('5b0e7c1a-0d1e-4f9a-8a10-000000000007', '2026', TAXES.id);

export const SAMPLE_FOLDERS: Folder[] = [HOME, UTILITIES, MEDICAL, RECEIPTS, TAXES, TAXES_2025, TAXES_2026];

/** A document as every list here draws it, with the fields a search hit and a browse row add. */
export interface SampleDocument extends ArchiveDocument {
  originalFilename: string;
  mimeType: string;
  archiveKey: string | null;
  createdAt: string;
  documentDate: string | null;
}

// Ids end in the document's place in the list, so they are fixed and still unique.
const ID_PREFIX = '7d4c2b1a-6e5f-4a3b-9c8d-';
const ID_DIGITS = 12;
// Sizes that differ row to row, as a real archive's do.
const BASE_SIZE_BYTES = 180_000;
const SIZE_STEP_BYTES = 37_411;
let made = 0;

function sample(title: string, folderId: string | null, overrides: Partial<SampleDocument> = {}): SampleDocument {
  made += 1;
  return {
    id: `${ID_PREFIX}${String(made).padStart(ID_DIGITS, '0')}`,
    title,
    folderId,
    sizeBytes: BASE_SIZE_BYTES + made * SIZE_STEP_BYTES,
    status: DocumentStatusEnum.Ready,
    originalFilename: `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.pdf`,
    mimeType: 'application/pdf',
    archiveKey: `archive/${made}.pdf`,
    createdAt: '2026-11-02T09:14:00.000Z',
    documentDate: null,
    ...overrides,
  };
}

/** A photographed receipt: an image, which OCR reads but no archive PDF is kept for. */
const PHOTO = { mimeType: 'image/jpeg', archiveKey: null };

export const LEASE = sample('Lease agreement', HOME.id, { documentDate: '2024-05-01' });
export const ELECTRICITY_OCTOBER = sample('Electricity bill — October', UTILITIES.id, { documentDate: '2026-10-14' });
export const ELECTRICITY_SEPTEMBER = sample('Electricity bill — September', UTILITIES.id, {
  documentDate: '2026-09-12',
});
export const WATER = sample('Water bill — Q3', UTILITIES.id, { documentDate: '2026-10-03' });
export const INTERNET = sample('Internet contract', HOME.id, { documentDate: '2025-02-18' });
export const DENTIST = sample('Dentist invoice', MEDICAL.id, { documentDate: '2026-08-21' });
export const HARDWARE = sample('Hardware store', RECEIPTS.id, {
  ...PHOTO,
  originalFilename: 'IMG_2231.jpg',
  documentDate: '2026-10-30',
});
export const GROCERIES = sample('Groceries', RECEIPTS.id, {
  ...PHOTO,
  originalFilename: 'IMG_2240.jpg',
  documentDate: '2026-11-07',
});
export const TAX_RETURN = sample('Tax return', TAXES_2025.id, { documentDate: '2026-04-28' });
export const PAYSLIP = sample('Payslip — October', TAXES_2026.id, { documentDate: '2026-10-31' });
/** One letter, scanned a page per file: what a suggested merge is for. */
export const SCANS = ['scan_0004', 'scan_0005', 'scan_0006'].map((name) =>
  sample(name, null, { originalFilename: `${name}.pdf`, archiveKey: null }),
);

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  LEASE,
  ELECTRICITY_OCTOBER,
  ELECTRICITY_SEPTEMBER,
  WATER,
  INTERNET,
  DENTIST,
  HARDWARE,
  GROCERIES,
  TAX_RETURN,
  PAYSLIP,
  ...SCANS,
];

export const SAMPLE_SAVED_SEARCHES = [
  {
    id: '1e2d3c4b-5a69-4788-9a0b-000000000001',
    name: 'Receipts this year',
    query: null,
    filters: { hasReceipt: true },
  },
  {
    id: '1e2d3c4b-5a69-4788-9a0b-000000000002',
    name: 'Utility bills',
    query: 'bill',
    filters: { folderId: UTILITIES.id },
  },
];

// A thumbnail's page, in SVG user units: the sheet, and lines of text down it.
const LINE_COUNT = 9;
const FIRST_LINE_Y = 58;
const LINE_GAP = 13;
/** Line lengths, as SVG attributes, so no two thumbnails in a list look the same. */
const LINE_WIDTHS = ['118', '96', '124', '72', '110', '88', '120', '64', '104', '92', '116', '80'];
const HEADING_WIDTHS = ['48', '62', '76'];
/** A total box on every other page, as on a bill or a receipt. */
const TOTAL_BOX = '<rect x="88" y="182" width="56" height="12" rx="2" fill="#9aa3ad"/>';

/**
 * A first page as a thumbnail would show it: a white sheet, a heading, lines of text, and for
 * some a total box. An SVG `data:` URL, because a story has no bucket to sign a URL for.
 */
export function pageThumbnail(seed: number): string {
  const lines = Array.from({ length: LINE_COUNT }, (_, i) => {
    const width = LINE_WIDTHS[(seed + i) % LINE_WIDTHS.length];
    return `<rect x="16" y="${FIRST_LINE_Y + i * LINE_GAP}" width="${width}" height="5" rx="2" fill="#c9ccd1"/>`;
  }).join('');
  const heading = HEADING_WIDTHS[seed % HEADING_WIDTHS.length];
  const total = seed % 2 === 0 ? TOTAL_BOX : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="210" viewBox="0 0 160 210"><rect width="160" height="210" fill="#ffffff"/><rect x="16" y="18" width="${heading}" height="9" rx="2" fill="#5b6470"/><rect x="16" y="33" width="44" height="5" rx="2" fill="#aab0b8"/>${lines}${total}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** S3's single-PUT ceiling, the server's default. */
const SAMPLE_MAX_IMPORT_BYTES = 5_368_709_120;

type Resolvers = { Query?: Record<string, unknown>; Mutation?: Record<string, unknown> };

/**
 * The shell's server over the sample archive, with a screen's own resolvers laid on top. The
 * sidebar reads the archive, the trash's and the suggestions' counts and the saved searches on
 * every page, so every screen story starts from this.
 */
export function sampleServer(screen: Resolvers = {}, config: Partial<typeof SERVER_CONFIG> = {}) {
  const archive = archiveServer({ folders: SAMPLE_FOLDERS, documents: SAMPLE_DOCUMENTS });
  return {
    Query: {
      ...archive.Query,
      serverConfig: () => ({
        ...SERVER_CONFIG,
        visionAvailable: true,
        // Settings asks for it; the archive's own stories never open Settings.
        maxImportBytes: SAMPLE_MAX_IMPORT_BYTES,
        ...config,
      }),
      savedSearches: () => SAMPLE_SAVED_SEARCHES,
      trash: () => ({ count: 2, retentionDays: 30, documents: [] }),
      mergeSuggestions: () => ({ count: 1, suggestions: [] }),
      documentThumbnailUrls: (_parent: unknown, args: { ids: string[] }) =>
        args.ids
          .map((id) => SAMPLE_DOCUMENTS.findIndex((doc) => doc.id === id))
          .filter((index) => index >= 0)
          .map((index) => ({ documentId: SAMPLE_DOCUMENTS[index].id, url: pageThumbnail(index) })),
      ...screen.Query,
    },
    Mutation: { ...archive.Mutation, ...screen.Mutation },
  };
}
