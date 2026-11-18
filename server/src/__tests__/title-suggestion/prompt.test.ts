import { describe, expect, it } from 'vitest';
import { TITLE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import { titleSchema } from '../../documents/create.ts';
import { excerptBudgetChars, sanitizeTitle, type TitleSource, titlePrompt } from '../../title-suggestion/prompt.ts';

const LEASE: TitleSource = {
  title: 'scan_0001',
  documentDate: '2025-03-12',
  vendor: null,
  excerpt: 'RESIDENTIAL LEASE\n\n\nThis lease   is made between',
};

describe('titlePrompt', () => {
  it('shows each document in order, with what is known of it and its text on one line', () => {
    const receipt: TitleSource = { title: 'IMG_2231', documentDate: null, vendor: 'Hardware Barn', excerpt: '' };
    expect(titlePrompt([LEASE, receipt])).toBe(
      [
        'Document 1 of 2',
        'Current title: scan_0001',
        'Date on it: 2025-03-12',
        'Start of its text: RESIDENTIAL LEASE This lease is made between',
        '',
        'Document 2 of 2',
        'Current title: IMG_2231',
        'Vendor: Hardware Barn',
      ].join('\n'),
    );
  });

  it('gives a document with no text its title alone', () => {
    expect(titlePrompt([{ title: 'Notes', documentDate: null, vendor: null, excerpt: '  \n ' }])).toBe(
      'Document 1 of 1\nCurrent title: Notes',
    );
  });

  it('caps each document’s text, and shares the total so the last of many is still in it', () => {
    const long = 'word '.repeat(5000);
    const one = titlePrompt([{ ...LEASE, excerpt: long }]);
    expect(one.length).toBeLessThan(TITLE_SUGGESTION_DEFAULTS.textPerDocumentMaxChars + 200);

    const many = Array.from({ length: 40 }, (_, index) => ({ ...LEASE, title: `Part ${index + 1}`, excerpt: long }));
    const prompt = titlePrompt(many);
    expect(prompt).toContain('Current title: Part 40');
    const texts = prompt.split('\n').filter((line) => line.startsWith('Start of its text: '));
    expect(texts).toHaveLength(40);
    expect(texts.join('').length).toBeLessThanOrEqual(
      TITLE_SUGGESTION_DEFAULTS.textTotalMaxChars + 40 * 'Start of its text: '.length,
    );
  });

  it('budgets an even share of the total, never more than the per-document cap', () => {
    expect(excerptBudgetChars(1)).toBe(TITLE_SUGGESTION_DEFAULTS.textPerDocumentMaxChars);
    expect(excerptBudgetChars(40)).toBe(Math.floor(TITLE_SUGGESTION_DEFAULTS.textTotalMaxChars / 40));
  });
});

describe('sanitizeTitle', () => {
  it.each([
    ['Electricity bill March 2025', 'Electricity bill March 2025'],
    ['"Electricity bill March 2025"', 'Electricity bill March 2025'],
    ['“Lease agreement, 12 Harbour Road”', 'Lease agreement, 12 Harbour Road'],
    ['Title: Tax return 2024', 'Tax return 2024'],
    ['**Suggested title:** "Tax return 2024".', 'Tax return 2024'],
    ['# Tax return 2024', 'Tax return 2024'],
    ['- Tax return 2024', 'Tax return 2024'],
    ['*Tax return 2024*', 'Tax return 2024'],
    ['```\nTax return 2024\n```', 'Tax return 2024'],
    ['Here is a title for the merged document:\n\nTax return 2024\n\nIt names the year.', 'Tax return 2024'],
    ['Invoice 2024/25', 'Invoice 2024-25'],
    ['Lease / signed', 'Lease - signed'],
    ['  Lease​   agreement\t ', 'Lease agreement'],
    ['To be continued...', 'To be continued...'],
  ])('makes %j a title: %j', (reply, title) => {
    expect(sanitizeTitle(reply)).toBe(title);
  });

  it.each([[''], ['   \n\n'], ['```\n```'], ['""'], ['Title:'], ['/']])('finds no title in %j', (reply) => {
    expect(sanitizeTitle(reply)).toBeNull();
  });

  it('caps a long answer at a word break, without a dangling separator', () => {
    const title = sanitizeTitle(`Lease agreement, ${'Harbour Road '.repeat(20)}`, 40);
    expect(title).toBe('Lease agreement, Harbour Road Harbour');
    expect(sanitizeTitle('x'.repeat(200), 40)).toBe('x'.repeat(40));
  });

  it('always answers something the name rule accepts', () => {
    for (const reply of ['A/B/C', '"Title: a / b."', `${'word '.repeat(100)}`, '## Receipts / 2024 ##']) {
      const title = sanitizeTitle(reply);
      expect(title).not.toBeNull();
      expect(titleSchema.safeParse(title).success).toBe(true);
    }
  });
});
