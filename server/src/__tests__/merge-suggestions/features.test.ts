import { describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS as SETTINGS } from '../../core/defaults.ts';
import {
  cosine,
  documentDateSignal,
  embeddingSignal,
  filenameSignal,
  identifierSignal,
  isCandidatePair,
  pageEnd,
  pageMarkerSignal,
  pageStart,
  seriesPlace,
  textFlowSignal,
  timeGapSignal,
  vendorSignal,
} from '../../merge-suggestions/features.ts';
import { at, candidate, invoicePages } from './fixtures.ts';

const pair = (first: Parameters<typeof candidate>[0], second: Parameters<typeof candidate>[0]) =>
  [candidate(first), candidate(second)] as const;

describe('isCandidatePair', () => {
  it('compares two PDFs or images in one folder filed close together', () => {
    const [a, b] = pair({ id: 'a' }, { id: 'b', createdAt: at(30), mimeType: 'image/png' });
    expect(isCandidatePair(a, b, SETTINGS)).toBe(true);
  });

  it('never compares across folders', () => {
    const [a, b] = pair({ id: 'a', folderId: 'f-1' }, { id: 'b', folderId: null });
    expect(isCandidatePair(a, b, SETTINGS)).toBe(false);
  });

  it('never compares documents filed further apart than the window', () => {
    const hoursPastWindow = SETTINGS.pairWindowHours + 1;
    const [a, b] = pair({ id: 'a' }, { id: 'b', createdAt: at(hoursPastWindow * 3600) });
    expect(isCandidatePair(a, b, SETTINGS)).toBe(false);
  });

  it('never compares a document with no pages, nor one with itself', () => {
    const [a, b] = pair({ id: 'a' }, { id: 'b', mimeType: 'text/markdown' });
    expect(isCandidatePair(a, b, SETTINGS)).toBe(false);
    expect(isCandidatePair(a, a, SETTINGS)).toBe(false);
  });
});

describe('timeGapSignal', () => {
  const gap = (seconds: number) =>
    timeGapSignal(candidate({ id: 'a' }), candidate({ id: 'b', createdAt: at(seconds) }), SETTINGS);

  it('calls seconds apart close and says how close', () => {
    expect(gap(40)).toMatchObject({ kind: 'close', seconds: 40, reason: 'scanned 40 s apart' });
  });

  it('calls a few minutes near, in minutes', () => {
    expect(gap(180)).toMatchObject({ kind: 'near', reason: 'scanned 3 min apart' });
  });

  it('says nothing between near and far', () => {
    expect(gap(30 * 60)).toMatchObject({ kind: 'apart', reason: null });
  });

  it('calls hours far, in hours, either way round', () => {
    const later = timeGapSignal(candidate({ id: 'a', createdAt: at(2 * 3600) }), candidate({ id: 'b' }), SETTINGS);
    expect(later).toMatchObject({ kind: 'far', reason: 'scanned 2 h apart' });
  });
});

describe('seriesPlace', () => {
  it('reads a scanner counter, ignoring case, padding and extension', () => {
    expect(seriesPlace('scan_0003.pdf', 'scan_0004.pdf')).toEqual({ first: 3, second: 4, isNext: true });
    expect(seriesPlace('scan_003.pdf', 'SCAN_0004.JPG')).toMatchObject({ isNext: true });
  });

  it("reads a phone's numbering", () => {
    expect(seriesPlace('IMG_1234.jpg', 'IMG_1235.HEIC')).toMatchObject({ isNext: true });
  });

  it('reads a copy counter, and the plain name as the start of its copies', () => {
    expect(seriesPlace('Scan 2026-11-17 (1).pdf', 'Scan 2026-11-17 (2).pdf')).toMatchObject({ isNext: true });
    expect(seriesPlace('Scan 2026-11-17.pdf', 'Scan 2026-11-17 (1).pdf')).toMatchObject({ isNext: true });
    // Windows numbers the first copy (2).
    expect(seriesPlace('Scan.pdf', 'Scan (2).pdf')).toMatchObject({ isNext: true });
    expect(seriesPlace('Scan (1).pdf', 'Scan.pdf')).toMatchObject({ first: 1, second: 0, isNext: false });
  });

  it('places the same series out of order without calling it next', () => {
    expect(seriesPlace('scan_0004.pdf', 'scan_0003.pdf')).toEqual({ first: 4, second: 3, isNext: false });
    expect(seriesPlace('IMG_1234.jpg', 'IMG_1240.jpg')).toMatchObject({ isNext: false });
  });

  it('finds no series in different stems', () => {
    expect(seriesPlace('scan_0003.pdf', 'IMG_0004.jpg')).toBeNull();
    expect(seriesPlace('invoice.pdf', 'contract.pdf')).toBeNull();
    expect(seriesPlace('scan_0003_front.pdf', 'scan_0004_back.pdf')).toBeNull();
  });
});

describe('filenameSignal', () => {
  it('tells next, series and unrelated apart', () => {
    const kind = (x: string, y: string) =>
      filenameSignal(candidate({ id: 'a', originalFilename: x }), candidate({ id: 'b', originalFilename: y })).kind;
    expect(kind('scan_0003.pdf', 'scan_0004.pdf')).toBe('next');
    expect(kind('scan_0004.pdf', 'scan_0003.pdf')).toBe('series');
    expect(kind('Rechnung.pdf', 'Brief.pdf')).toBe('unrelated');
  });
});

describe('pageMarkerSignal', () => {
  const markers = (first: string, second: string) =>
    pageMarkerSignal(candidate({ id: 'a', text: first }), candidate({ id: 'b', text: second }), SETTINGS);

  it('finds "page 2 of 3" after "page 1 of 3"', () => {
    const signal = markers('Total due\nPage 1 of 3', 'Page 2 of 3\nItems continued');
    expect(signal).toMatchObject({ kind: 'consecutive', end: { page: 1, total: 3 }, start: { page: 2, total: 3 } });
    expect(signal.reason).toContain('page 2 of 3');
  });

  it('reads German markers and abbreviations', () => {
    expect(markers('Seite 1 von 2', 'Seite 2 von 2').kind).toBe('consecutive');
    expect(markers('S. 2 von 4', 'Rechnung 10432 S. 3 von 4').kind).toBe('consecutive');
    expect(markers('Blatt 1 von 2', 'Blatt 2 von 2').kind).toBe('consecutive');
  });

  it('reads a bare "2/3" or a lone "Page 2" only on a line of its own', () => {
    expect(markers('text\n- 1/3 -', 'text\n- 2/3 -').kind).toBe('consecutive');
    expect(markers('text\nPage 1', 'Page 2\ntext').kind).toBe('consecutive');
    expect(markers('see page 1 for details', 'see page 2 for details').kind).toBe('none');
    expect(markers('we paid 1/3 up front', 'and 2/3 later').kind).toBe('none');
  });

  it('counts B starting at page 1 against, whatever A says', () => {
    const signal = markers('Page 2 of 2', 'Page 1 of 4');
    expect(signal.kind).toBe('restart');
    expect(signal.reason).toContain('page 1 of 4');
    expect(markers('no marker here', 'Page 1 of 4').kind).toBe('restart');
  });

  it('counts A ending on its last page, before an unnumbered page, against', () => {
    expect(markers('Page 3 of 3', 'Dear Ms Smith').kind).toBe('complete');
    expect(markers('Page 2 of 3', 'Dear Ms Smith').kind).toBe('none');
  });

  it('counts differing page counts against', () => {
    expect(markers('Page 1 of 3', 'Page 2 of 5').kind).toBe('conflict');
  });

  it('calls two pages of one count out of order the same set', () => {
    expect(markers('Page 1 of 4', 'Page 3 of 4')).toMatchObject({ kind: 'sameSet', reason: 'pages 1 and 3 of 4' });
  });

  it('ignores a page number past its count, or a count too large to be pages', () => {
    expect(markers('Page 1 of 2', 'Page 4 of 2').kind).toBe('none');
    expect(markers('Page 1 of 9000', 'Page 2 of 9000').kind).toBe('none');
  });
});

describe('pageStart and pageEnd', () => {
  it('read the first marker of the head and the last of the tail', () => {
    const twoPages = candidate({ id: 'a', textHead: 'Page 1 of 3\nintro', textTail: 'more\nPage 2 of 3' });
    expect(pageStart(twoPages, SETTINGS)).toEqual({ page: 1, total: 3 });
    expect(pageEnd(twoPages, SETTINGS)).toEqual({ page: 2, total: 3 });
  });

  it('fall back to the other end for a page longer than either', () => {
    const footerOnly = candidate({ id: 'a', textHead: 'A long page', textTail: 'end\nPage 2 of 3' });
    expect(pageStart(footerOnly, SETTINGS)).toEqual({ page: 2, total: 3 });
  });
});

describe('identifierSignal', () => {
  const shared = (first: string, second: string) =>
    identifierSignal(candidate({ id: 'a', text: first }), candidate({ id: 'b', text: second }), SETTINGS);

  it('finds an invoice number labelled on both', () => {
    const signal = shared('Invoice no. 10432\nDate 3 Nov', 'Invoice No: 10432 continued');
    expect(signal.kind).toBe('shared');
    expect(signal.reason).toBe('same invoice no. 10432');
  });

  it('finds a labelled number repeated bare on the other page', () => {
    expect(shared('Kundennummer: 77341192', 'ACME · 77341192 · Seite 2').identifiers).toEqual([
      { label: 'customer no.', value: '77341192' },
    ]);
    expect(shared('Rechnungs-Nr. RE-2026-10432', 'RE-2026-10432').kind).toBe('shared');
  });

  it('names each identifier once, however often it is printed', () => {
    const signal = shared('Rechnung 10432\nRechnungsnummer 10432', 'Rechnung 10432');
    expect(signal.identifiers).toHaveLength(1);
  });

  it('ignores short numbers and dates', () => {
    expect(shared('Order no. 1234', 'Order no. 1234').kind).toBe('none');
    expect(shared('Reference: 2026-11-03', 'Reference: 2026-11-03').kind).toBe('none');
  });

  it('ignores a number neither document labels as an identifier', () => {
    expect(shared('Total 10432', 'Total 10432').kind).toBe('none');
  });
});

describe('documentDateSignal and vendorSignal', () => {
  const fields = (first: Partial<Parameters<typeof candidate>[0]>, second: Partial<Parameters<typeof candidate>[0]>) =>
    [candidate({ id: 'a', originalFilename: 'scan_1.pdf', ...first }), candidate({ id: 'b', ...second })] as const;

  it('call only the first being dated a continuation, and two dates a conflict', () => {
    expect(documentDateSignal(...fields({ documentDate: '2026-11-03' }, {}))).toEqual({
      kind: 'onlyFirst',
      reason: 'only scan_1.pdf is dated',
    });
    expect(documentDateSignal(...fields({ documentDate: '2026-11-03' }, { documentDate: '2026-11-03' })).kind).toBe(
      'agree',
    );
    expect(documentDateSignal(...fields({ documentDate: '2026-11-03' }, { documentDate: '2026-11-05' }))).toEqual({
      kind: 'conflict',
      reason: 'dated 2026-11-03 and 2026-11-05',
    });
    expect(documentDateSignal(...fields({}, { documentDate: '2026-11-05' }))).toEqual({ kind: 'none', reason: null });
  });

  it('take one vendor written two ways as the same', () => {
    expect(vendorSignal(...fields({ vendor: 'ACME' }, { vendor: 'ACME Supplies GmbH' })).kind).toBe('agree');
    expect(vendorSignal(...fields({ vendor: 'REWE Markt GmbH' }, { vendor: 'Lidl' }))).toEqual({
      kind: 'conflict',
      reason: 'from REWE Markt GmbH and from Lidl',
    });
  });
});

describe('textFlowSignal', () => {
  const flow = (first: string, second: string) =>
    textFlowSignal(
      candidate({ id: 'a', text: first }),
      candidate({ id: 'b', originalFilename: 'scan_2.pdf', text: second }),
      SETTINGS,
    );

  it('finds a sentence running on into a lower-case page', () => {
    expect(flow('we kindly ask you to', 'transfer the amount by Friday.').kind).toBe('runsOn');
    expect(flow('Wir bitten Sie, den Betrag', '„auf unser Konto zu überweisen.').kind).toBe('runsOn');
  });

  it('looks past a running header or footer with a page marker', () => {
    expect(flow('we kindly ask you to\nPage 1 of 2', 'ACME Ltd · Page 2 of 2\ntransfer the amount.').kind).toBe(
      'runsOn',
    );
  });

  it('does not run on from a finished sentence or into a capital', () => {
    expect(flow('Thank you.', 'transfer the amount.').kind).toBe('none');
    expect(flow('we kindly ask you to', 'Transfer the amount.').kind).toBe('none');
  });

  it('counts a letterhead, a date or a greeting at the top against, and names it', () => {
    expect(flow('Thank you.', 'ACME Supplies GmbH\nIndustriestraße 12')).toEqual({
      kind: 'freshStart',
      reason: 'scan_2.pdf opens with a letterhead',
    });
    expect(flow('Thank you.', 'Musterstadt, 05.11.2026').reason).toContain('a date');
    expect(flow('Thank you.', 'Dear Ms Smith,').reason).toContain('a greeting');
  });

  it('only reads the first few lines for a fresh start', () => {
    const deepDate = ['one', 'two', 'three', 'four', 'Signed 05.11.2026'].join('\n');
    expect(flow('Thank you.', deepDate).kind).toBe('none');
  });
});

describe('embeddingSignal', () => {
  const embedded = (x: number[] | null, y: number[] | null) =>
    embeddingSignal(candidate({ id: 'a', meanEmbedding: x }), candidate({ id: 'b', meanEmbedding: y }), SETTINGS);

  it('calls a high cosine similar and only a very low one unrelated', () => {
    expect(embedded([1, 0], [0.95, 0.1]).kind).toBe('similar');
    expect(embedded([1, 0], [0.6, 0.8]).kind).toBe('none');
    expect(embedded([1, 0], [0.1, 1]).kind).toBe('dissimilar');
  });

  it('says nothing without two embeddings of one length', () => {
    expect(embedded(null, [1, 0])).toEqual({ kind: 'none', reason: null, cosine: null });
    expect(embedded([1, 0, 0], [1, 0]).cosine).toBeNull();
  });
});

describe('cosine', () => {
  it('is 1 for one direction and null for a zero vector', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBeNull();
  });
});

describe('the invoice fixture', () => {
  it('reads as three numbered pages', () => {
    expect(invoicePages.map((page) => pageStart(page, SETTINGS)?.page)).toEqual([1, 2, 3]);
  });
});
