import { describe, expect, it } from 'vitest';
import { extractReceipt, parseAmount } from '../../metadata/receipt.ts';

// Receipts as OCR and pdftotext hand them over: columns flattened to lines, the odd stray
// character, the total sometimes on the line under its label.

const GERMAN_SUPERMARKET = `REWE Markt GmbH
Hauptstr. 12, 10115 Berlin
UID Nr.: DE812706034
EUR
BIO MILCH 1,5%           1,19 A
BROT                     2,49 A
KAFFEE                   8,99 A
--------------------------------
Zwischensumme           12,67
SUMME           EUR     12,67
Geg. BAR        EUR     20,00
Rückgeld        EUR      7,33
Steuer  %   Netto   Steuer  Brutto
A= 7,0%     11,84    0,83    12,67
Datum: 14.10.2026  Uhrzeit: 18:42`;

const US_DINER = `*** JOE'S DINER ***
1201 Main St, Springfield
Tel (555) 010-2030
10/14/2026 12:31 PM
2 Coffee              5.00
1 Pancakes           11.50
Subtotal             16.50
Tax 8.25%             1.36
Total               $17.86
Tip                   3.00
Grand Total         $20.86
Thank you!`;

const UK_INVOICE = `Invoice
Acme Widgets Ltd
Invoice date: 3 March 2026
Widgets x 1,000                  £1,000.00
Net total                        £1,000.00
VAT 20%                            £200.00
Amount due                       £1,200.00`;

const SPLIT_COLUMN = `Café Nord
Espresso 2,80
Croissant 3,20
Gesamtbetrag
6,00 €`;

const SWISS = `Migros
Total CHF 1'234.50`;

describe('extractReceipt', () => {
  it('takes the total, not the subtotal, the tax line or the cash handed over', () => {
    expect(extractReceipt(GERMAN_SUPERMARKET)).toEqual({ vendor: 'REWE Markt GmbH', total: '12.67', currency: 'EUR' });
  });

  it('takes the largest labelled amount, so a grand total with a tip beats the total before it', () => {
    // The `$` alone could be five currencies, so the currency is left empty rather than guessed.
    expect(extractReceipt(US_DINER)).toEqual({ vendor: "JOE'S DINER", total: '20.86', currency: null });
  });

  it('reads grouped thousands and a currency symbol, and skips a heading for the vendor', () => {
    expect(extractReceipt(UK_INVOICE)).toEqual({ vendor: 'Acme Widgets Ltd', total: '1200.00', currency: 'GBP' });
  });

  it('takes the amount from the next line when OCR split the columns', () => {
    expect(extractReceipt(SPLIT_COLUMN)).toEqual({ vendor: 'Café Nord', total: '6.00', currency: 'EUR' });
  });

  it('reads a Swiss apostrophe and a code before the amount', () => {
    expect(extractReceipt(SWISS)).toEqual({ vendor: 'Migros', total: '1234.50', currency: 'CHF' });
  });

  it('takes the currency the receipt names elsewhere when the total line names none', () => {
    const receipt = 'Bakery\nAll prices in EUR\nBread 3,50\nTotal 3,50';
    expect(extractReceipt(receipt).currency).toBe('EUR');
  });

  it('leaves the currency empty when the receipt names two', () => {
    const receipt = 'Exchange\nPaid in USD, charged in EUR\nTotal 10.00';
    expect(extractReceipt(receipt)).toMatchObject({ total: '10.00', currency: null });
  });

  it('reads a prefixed dollar as the one currency it is', () => {
    expect(extractReceipt('Tim Hortons\nTotal C$4.25').currency).toBe('CAD');
    expect(extractReceipt('Tim Hortons\nCA$4.25 paid\nTotal 4.25').currency).toBe('CAD');
    expect(extractReceipt('Hawker\nUS$ accepted\nTotal 4.25').currency).toBe('USD');
  });

  it('does not take a count for a total', () => {
    expect(extractReceipt('Shop\nTotal items 3\nTotal 4')).toEqual({ vendor: null, total: null, currency: null });
  });

  it('fills nothing in for a document with no labelled total', () => {
    const letter = 'Dear Ms Smith,\n\nThank you for the 12.50 you sent on 01.02.2026.\n\nYours, Bob';
    expect(extractReceipt(letter)).toEqual({ vendor: null, total: null, currency: null });
    expect(extractReceipt('')).toEqual({ vendor: null, total: null, currency: null });
  });

  it('leaves the vendor empty when no opening line reads like a name', () => {
    expect(extractReceipt('12345 678\n2026-10-14\nTotal 9.99 EUR')).toEqual({
      vendor: null,
      total: '9.99',
      currency: 'EUR',
    });
  });
});

describe('parseAmount', () => {
  it('reads either separator as the decimal point, and the other as thousands', () => {
    expect(parseAmount('12,50')).toBe('12.50');
    expect(parseAmount('12.50')).toBe('12.50');
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount("1'234.50")).toBe('1234.50');
  });

  it('reads three digits after one separator as thousands, and pads one decimal to two', () => {
    expect(parseAmount('1,234')).toBe('1234');
    expect(parseAmount('12,5')).toBe('12.50');
    expect(parseAmount('1200')).toBe('1200');
    expect(parseAmount('0,99')).toBe('0.99');
  });
});
