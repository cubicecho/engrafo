import { describe, expect, it } from 'vitest';
import { chunkRows, chunkSections, chunkText, embeddingText, headingLine } from '../../search/chunk.ts';

describe('chunkText', () => {
  it('packs short paragraphs together up to the limit, in order', () => {
    const text = 'First paragraph.\n\nSecond one.\n  \nThird.';
    expect(chunkText(text, 1000)).toEqual(['First paragraph.\n\nSecond one.\n\nThird.']);
    expect(chunkText(text, 30)).toEqual(['First paragraph.\n\nSecond one.', 'Third.']);
  });

  it('joins the lines of a paragraph, which are only the page width', () => {
    expect(chunkText('This lease is\nmade between\r\nthe parties.', 1000)).toEqual([
      'This lease is made between the parties.',
    ]);
  });

  it('cuts a long paragraph at sentence ends, and a long sentence at a space', () => {
    const sentences = 'One two three. Four five six. Seven eight nine.';
    expect(chunkText(sentences, 20)).toEqual(['One two three.', 'Four five six.', 'Seven eight nine.']);

    const words = 'alpha beta gamma delta epsilon zeta';
    const chunks = chunkText(words, 12);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
    expect(chunks.join(' ')).toBe(words);
  });

  it('cuts a word longer than the limit rather than looping', () => {
    expect(chunkText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });

  it('gives nothing for empty or blank text', () => {
    expect(chunkText('', 100)).toEqual([]);
    expect(chunkText(' \n\n \t\n', 100)).toEqual([]);
  });

  it('puts the title in front of what is embedded', () => {
    expect(embeddingText('Lease', 'Rent is due on the 1st.')).toBe('Lease\n\nRent is due on the 1st.');
  });
});

describe('chunkSections', () => {
  it('never packs two chapters into one passage, and keeps the name on every piece of a long one', () => {
    const text = '# One\n\nShort.\n\n# Two\n\nAlpha beta.\n\nGamma delta.';
    expect(chunkSections(text, 1000)).toEqual([
      { heading: 'One', content: 'Short.' },
      { heading: 'Two', content: 'Alpha beta.\n\nGamma delta.' },
    ]);
    expect(chunkSections(text, 12)).toEqual([
      { heading: 'One', content: 'Short.' },
      { heading: 'Two', content: 'Alpha beta.' },
      { heading: 'Two', content: 'Gamma delta.' },
    ]);
  });

  it('drops a section with no text', () => {
    expect(chunkSections('# Empty\n\n# Full\n\nText.', 1000)).toEqual([{ heading: 'Full', content: 'Text.' }]);
  });

  it('gives a Markdown passage the breadcrumb of headings above it', () => {
    const markdown = [
      '# Backups',
      'Nightly at two.',
      '## Restore',
      'Run it twice.',
      '### Gotchas ###',
      'Stop the app first.',
      '## Retention',
      'Thirty days.',
      '# Other',
      'Elsewhere.',
    ].join('\n');
    expect(chunkSections(markdown, 1000)).toEqual([
      { heading: 'Backups', content: 'Nightly at two.' },
      { heading: 'Backups › Restore', content: 'Run it twice.' },
      { heading: 'Backups › Restore › Gotchas', content: 'Stop the app first.' },
      { heading: 'Backups › Retention', content: 'Thirty days.' },
      { heading: 'Other', content: 'Elsewhere.' },
    ]);
  });

  it('skips a level without leaving a gap in the breadcrumb', () => {
    expect(chunkSections('# Top\n### Deep\nText.', 1000)).toEqual([{ heading: 'Top › Deep', content: 'Text.' }]);
  });

  it('reads no heading inside a code block, and leaves front matter out', () => {
    const markdown = [
      '---',
      'title: Server notes',
      'tags: [ops]',
      '---',
      '# Setup',
      '```bash',
      '# install it',
      'apt install foo',
      '```',
      'Then reboot.',
      '#hashtag is not a heading',
    ].join('\n');
    expect(chunkSections(markdown, 1000)).toEqual([
      {
        heading: 'Setup',
        content: '```bash # install it apt install foo ``` Then reboot. #hashtag is not a heading',
      },
    ]);
  });
});

describe('embeddingText with a chapter', () => {
  it('puts the chapter under the title', () => {
    expect(embeddingText('Novel', 'Rain fell.', 'The Storm')).toBe('Novel\nThe Storm\n\nRain fell.');
  });
});

describe('chunkRows', () => {
  const HEADER = 'Date,Description,Amount';
  const ROWS = ['2024-01-02,COFFEE SHOP,-3.50', '2024-01-03,AMAZON MKTP. US,-23.40', '2024-01-05,PAYROLL,2100.00'];

  it('packs whole rows, each passage under the header row', () => {
    const csv = `${HEADER}\r\n${ROWS.join('\r\n')}\r\n`;
    expect(chunkRows(csv, 1000)).toEqual([{ heading: HEADER, content: ROWS.join('\n') }]);
    // Never mid-row, wherever the limit falls: the full stop in a description is not a sentence end.
    expect(chunkRows(csv, 70)).toEqual([
      { heading: HEADER, content: `${ROWS[0]}\n${ROWS[1]}` },
      { heading: HEADER, content: ROWS[2] },
    ]);
  });

  it('keeps a quoted line break in its row, and a stray quote does not swallow the file', () => {
    const quoted = '2024-01-04,"Refund\nsee ""note""",12.00';
    expect(chunkRows(`${HEADER}\n${quoted}\n${ROWS[0]}`, 1000)).toEqual([
      { heading: HEADER, content: `${quoted}\n${ROWS[0]}` },
    ]);
    const stray = '2024-01-06,24" MONITOR,-199.00';
    expect(chunkRows(`${HEADER}\n${stray}\n${ROWS[0]}`, 40)).toEqual([
      { heading: HEADER, content: stray },
      { heading: HEADER, content: ROWS[0] },
    ]);
  });

  it('reads a semicolon-separated file the same way', () => {
    expect(chunkRows('Datum;Betrag\n02.01.2024;"-3,50"\n03.01.2024;"-23,40"', 1000)).toEqual([
      { heading: 'Datum;Betrag', content: '02.01.2024;"-3,50"\n03.01.2024;"-23,40"' },
    ]);
  });

  it('gives nothing for an empty file, and one row is just that row', () => {
    expect(chunkRows('\n\n', 1000)).toEqual([]);
    expect(chunkRows(HEADER, 1000)).toEqual([{ heading: null, content: HEADER }]);
  });

  it('cuts a row longer than the limit at spaces', () => {
    const long = `2024-01-07,${'word '.repeat(10).trim()},1.00`;
    const passages = chunkRows(`${HEADER}\n${long}`, 20);
    expect(passages.every((passage) => passage.content.length <= 20)).toBe(true);
    expect(passages.map((passage) => passage.content.replaceAll('\n', ' ')).join(' ')).toBe(long);
  });
});

describe('headingLine', () => {
  it('writes a heading at the depth it is given, top-level by default', () => {
    expect(headingLine('Order 1234')).toBe('# Order 1234');
    expect(headingLine('Items', 3)).toBe('### Items');
  });
});
