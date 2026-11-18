import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import type { MergeCandidate } from '../../merge-suggestions/features.ts';

// One morning at a sheet-feed scanner, plus a phone and a stray pair, as the suggester would
// read them. The scanner numbers every file in turn, so documents that follow each other are
// named in sequence whether they belong together or not; a person feeds the next document a few
// minutes after the last. The text is what OCR makes of each page: a head and a tail, cut as the
// suggester will cut them.

const MORNING = Date.parse('2026-11-17T09:00:00Z');
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const INBOX = 'f-inbox';

/** A time on the morning, `seconds` after 09:00. */
export const at = (seconds: number): Date => new Date(MORNING + seconds * SECOND_MS);

/** A candidate with everything a test does not name filled in, its text cut into head and tail. */
export function candidate(given: Partial<MergeCandidate> & { id: string; text?: string }): MergeCandidate {
  const { text = '', ...fields } = given;
  const chars = MERGE_SUGGESTION_DEFAULTS.aiContextChars;
  return {
    createdAt: at(0),
    originalFilename: `${given.id}.pdf`,
    folderId: INBOX,
    mimeType: 'application/pdf',
    documentDate: null,
    vendor: null,
    textHead: text.slice(0, chars),
    textTail: text.slice(-chars),
    meanEmbedding: null,
    ...fields,
  };
}

// The invoice's pages all sit near one point; the receipts point elsewhere.
const INVOICE_VECTOR = [0.9, 0.3, 0.1, 0.2];
const GROCERY_VECTOR = [0.1, 0.9, 0.3, 0.1];
const HARDWARE_VECTOR = [0.2, 0.1, 0.1, 0.95];

/** A three-page invoice, a page per file, 20 s apart, each page numbered "Seite n von 3". */
export const invoicePages = [
  candidate({
    id: 'invoice-1',
    createdAt: at(0),
    originalFilename: 'scan_0003.pdf',
    documentDate: '2026-11-03',
    meanEmbedding: INVOICE_VECTOR,
    text: `ACME Supplies GmbH
Industriestraße 12 · 70565 Stuttgart

Mustermann Design
Beispielweg 5
54321 Beispielstadt

Rechnung
Rechnungsnummer: 10432
Kundennummer: 77341192
Datum: 03.11.2026

Pos. Beschreibung Menge Einzelpreis Gesamt
1 Druckerpapier A4, 80 g 20 4,20 84,00
2 Toner schwarz TN-2420 3 58,90 176,70
3 Heftklammern 24/6 10 1,15 11,50

Seite 1 von 3`,
  }),
  candidate({
    id: 'invoice-2',
    createdAt: at(20),
    originalFilename: 'scan_0004.pdf',
    meanEmbedding: [0.88, 0.32, 0.12, 0.2],
    text: `ACME Supplies GmbH · Rechnung 10432 · Seite 2 von 3

Pos. Beschreibung Menge Einzelpreis Gesamt
4 Ordner breit, blau 10 2,90 29,00
5 Kugelschreiber, 50 Stück 2 12,40 24,80
6 Haftnotizen 76 x 76 mm 12 1,95 23,40
7 Briefumschläge DIN lang 4 15,90 63,60`,
  }),
  candidate({
    id: 'invoice-3',
    createdAt: at(40),
    originalFilename: 'scan_0005.pdf',
    vendor: 'ACME Supplies GmbH',
    meanEmbedding: [0.9, 0.28, 0.1, 0.22],
    text: `ACME Supplies GmbH · Rechnung 10432 · Seite 3 von 3

Summe netto 412,30
USt. 19 % 78,34
Gesamtbetrag 490,64 EUR

Zahlbar innerhalb von 14 Tagen ohne Abzug.
Bankverbindung: Volksbank Stuttgart · IBAN DE44 6009 0100 0123 4567 89`,
  }),
];

/** The front and back of a form, as two images 35 s apart. The back is boilerplate. */
export const frontAndBack = [
  candidate({
    id: 'form-front',
    createdAt: at(4 * 60),
    originalFilename: 'scan_0006.jpg',
    mimeType: 'image/jpeg',
    documentDate: '2026-11-12',
    text: `City Library
Membership Application

Name: Max Mustermann
Address: 5 Example Road, Springfield
Date: 12 November 2026

I would like to become a member of the City Library and accept
the terms printed overleaf.

Signature: ______________________`,
  }),
  candidate({
    id: 'form-back',
    createdAt: at(4 * 60 + 35),
    originalFilename: 'scan_0007.jpg',
    mimeType: 'image/jpeg',
    text: `Terms of Membership
1. Membership runs for twelve months from the day it is approved.
2. Members may borrow up to ten items at a time.
3. Items not returned within four weeks incur a fee.
4. Lost cards are replaced for a small charge.`,
  }),
];

/** A letter and the envelope it came in, envelope first, 40 s apart. */
export const letterAndEnvelope = [
  candidate({
    id: 'envelope',
    createdAt: at(8 * 60),
    originalFilename: 'scan_0008.pdf',
    text: `Stadtwerke Musterstadt GmbH · Postfach 1120 · 12345 Musterstadt
Deutsche Post
Entgelt bezahlt
Herrn
Max Mustermann
Beispielweg 5
54321 Beispielstadt`,
  }),
  candidate({
    id: 'letter',
    createdAt: at(8 * 60 + 40),
    originalFilename: 'scan_0009.pdf',
    documentDate: '2026-11-05',
    text: `Stadtwerke Musterstadt GmbH
Hauptstraße 1
12345 Musterstadt

Herrn
Max Mustermann
Beispielweg 5
54321 Beispielstadt

Musterstadt, 05.11.2026

Ihre Jahresabrechnung 2026
Kundennummer: 4471229018

Sehr geehrter Herr Mustermann,

anbei erhalten Sie Ihre Jahresabrechnung für Strom und Wasser. Der neue Abschlag beträgt
ab Dezember 62,00 EUR im Monat.

Mit freundlichen Grüßen
Ihre Stadtwerke Musterstadt`,
  }),
];

/**
 * Two unrelated receipts fed one after the other, 25 s apart and named in sequence: the hard
 * negative. Only what they say tells them apart.
 */
export const twoReceipts = [
  candidate({
    id: 'receipt-rewe',
    createdAt: at(12 * 60),
    originalFilename: 'scan_0010.jpg',
    mimeType: 'image/jpeg',
    documentDate: '2026-11-03',
    vendor: 'REWE Markt GmbH',
    meanEmbedding: GROCERY_VECTOR,
    text: `REWE Markt GmbH
Hauptstr. 12, 12345 Musterstadt
UID Nr.: DE812706034

Bananen 1,99
Vollmilch 3,5% 1,29
Dinkelbrot 3,49
Bio Eier 10 Stk 4,29
--------------------------
SUMME EUR 23,47
Geg. BAR EUR 30,00
Rückgeld EUR 6,53

03.11.2026 18:42 Bon-Nr.: 4711
Vielen Dank für Ihren Einkauf!`,
  }),
  candidate({
    id: 'receipt-hardware',
    createdAt: at(12 * 60 + 25),
    originalFilename: 'scan_0011.jpg',
    mimeType: 'image/jpeg',
    documentDate: '2026-11-05',
    vendor: 'Baumarkt Müller',
    meanEmbedding: HARDWARE_VECTOR,
    text: `Baumarkt Müller KG
Filiale Musterstadt · Bahnhofstr. 7
Schrauben 4x40 200 Stk 6,99
Dübel 6 mm 100 Stk 3,49
Malerkrepp 2,51
Summe 12,99
Kartenzahlung 12,99
05.11.2026 09:15
Danke für Ihren Einkauf`,
  }),
];

/** A two-page letter photographed with a phone, 15 s apart, at the top level. */
export const phonePhotos = [
  candidate({
    id: 'photo-1',
    createdAt: at(30 * 60),
    originalFilename: 'IMG_1234.jpg',
    folderId: null,
    mimeType: 'image/jpeg',
    documentDate: '2026-11-10',
    meanEmbedding: [0.3, 0.3, 0.9, 0.1],
    text: `Hausverwaltung Schmidt & Partner
Lindenallee 8 · 10115 Berlin

Frau
Erika Musterfrau
Gartenstraße 3
10117 Berlin

Berlin, 10. November 2026

Nebenkostenabrechnung 2025
Objekt: Gartenstraße 3, Wohnung 4
Vertragsnummer: 2019-08812

Sehr geehrte Frau Musterfrau,

mit diesem Schreiben erhalten Sie die Abrechnung der Nebenkosten für das Jahr 2025.
Es ergibt sich eine Nachzahlung von 84,20 EUR. Wir bitten Sie, diesen Betrag innerhalb von vier Wochen`,
  }),
  candidate({
    id: 'photo-2',
    createdAt: at(30 * 60 + 15),
    originalFilename: 'IMG_1235.jpg',
    folderId: null,
    mimeType: 'image/jpeg',
    meanEmbedding: [0.32, 0.28, 0.88, 0.12],
    text: `auf das unten genannte Konto zu überweisen. Bitte geben Sie dabei die Vertragsnummer
2019-08812 als Verwendungszweck an.

Mit freundlichen Grüßen

Hausverwaltung Schmidt & Partner

Bankverbindung: Berliner Sparkasse · IBAN DE12 1005 0000 0190 2345 67`,
  }),
];

/** Named in sequence, but filed four hours apart into different folders. */
export const apartPair = [
  candidate({
    id: 'tax-1',
    createdAt: at(HOUR_MS / SECOND_MS),
    originalFilename: 'scan_0030.pdf',
    folderId: 'f-taxes',
  }),
  candidate({ id: 'tax-2', createdAt: at((5 * HOUR_MS) / SECOND_MS), originalFilename: 'scan_0031.pdf' }),
];

/** Everything above, as one morning's archive. */
export const morning = [
  ...invoicePages,
  ...frontAndBack,
  ...letterAndEnvelope,
  ...twoReceipts,
  ...phonePhotos,
  ...apartPair,
];
