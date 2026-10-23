import { describe, expect, it } from 'vitest';
import { chunkSections, chunkText, embeddingText } from '../../search/chunk.ts';

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

  it('drops a chapter with no text, and reads a heading only as a paragraph of its own', () => {
    expect(chunkSections('# Empty\n\n# Full\n\nText.\n# not a heading', 1000)).toEqual([
      { heading: 'Full', content: 'Text. # not a heading' },
    ]);
  });
});

describe('embeddingText with a chapter', () => {
  it('puts the chapter under the title', () => {
    expect(embeddingText('Novel', 'Rain fell.', 'The Storm')).toBe('Novel\nThe Storm\n\nRain fell.');
  });
});
