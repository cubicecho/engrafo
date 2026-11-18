import { describe, expect, it } from 'vitest';
import { type MergeSuggestionSettings, MERGE_SUGGESTION_DEFAULTS as SETTINGS } from '../../core/defaults.ts';
import type { MergeCandidate } from '../../merge-suggestions/features.ts';
import { confidenceBand, type MergeBand, scorePair } from '../../merge-suggestions/score.ts';
import { frontAndBack, invoicePages, letterAndEnvelope, phonePhotos, twoReceipts } from './fixtures.ts';

const [invoice1, invoice2, invoice3] = invoicePages;
const [front, back] = frontAndBack;
const [envelope, letter] = letterAndEnvelope;
const [rewe, hardware] = twoReceipts;
const [photo1, photo2] = phonePhotos;

// Each pair in the order it was scanned, and the band its score should land in.
const FIXTURE_BANDS: ReadonlyArray<[string, MergeCandidate, MergeCandidate, MergeBand]> = [
  ['invoice page 1 to page 2', invoice1, invoice2, 'high'],
  ['invoice page 2 to page 3', invoice2, invoice3, 'high'],
  ['phone photos of a two-page letter', photo1, photo2, 'high'],
  ['front and back of a form', front, back, 'medium'],
  ['an envelope and the letter in it', envelope, letter, 'low'],
  ['two receipts scanned back to back', rewe, hardware, 'low'],
];

describe('scorePair', () => {
  it.each(FIXTURE_BANDS)('scores %s in its band', (_name, a, b, band) => {
    expect(confidenceBand(scorePair(a, b).confidence)).toBe(band);
  });

  it('keeps the envelope and the hard negative under minConfidence, either way round', () => {
    for (const [a, b] of [
      [envelope, letter],
      [rewe, hardware],
    ] as const) {
      expect(scorePair(a, b).confidence).toBeLessThan(SETTINGS.minConfidence);
      expect(scorePair(b, a).confidence).toBeLessThan(SETTINGS.minConfidence);
    }
  });

  it('scores pages in page order above the same pages reversed', () => {
    expect(scorePair(invoice1, invoice2).confidence).toBeGreaterThan(scorePair(invoice2, invoice1).confidence);
  });

  it('gives the reasons for and against, strongest for first', () => {
    const { reasons } = scorePair(rewe, hardware);
    const points = reasons.map((reason) => reason.points);
    expect(points).toEqual([...points].sort((x, y) => y - x));
    expect(reasons.at(0)).toMatchObject({ signal: 'filename', text: 'named in sequence' });
    expect(reasons.at(-1)).toMatchObject({ signal: 'vendor', text: 'from REWE Markt GmbH and from Baumarkt Müller' });
  });

  it('says why in words a person reads', () => {
    const texts = scorePair(invoice1, invoice2).reasons.map((reason) => reason.text);
    expect(texts).toEqual(
      expect.arrayContaining(['scanned 20 s apart', 'same invoice no. 10432', 'page 2 of 3 follows page 1']),
    );
    for (const text of FIXTURE_BANDS.flatMap(([, a, b]) => scorePair(a, b).reasons.map((reason) => reason.text))) {
      expect(text).toMatch(/^[a-z]|^[\w-]+\.(pdf|jpg)\b/i);
      expect(text).not.toMatch(/undefined|null|NaN/);
    }
  });

  it('leaves out a signal whose weight is zero', () => {
    // The last invoice page names the vendor; the page before it names none, which weighs nothing.
    const signals = scorePair(invoice3, invoice2).reasons.map((reason) => reason.signal);
    expect(signals).not.toContain('vendor');
  });

  it('turns the bias plus every reason into a confidence through the logistic', () => {
    for (const [, a, b] of FIXTURE_BANDS) {
      const score = scorePair(a, b);
      const sum = score.reasons.reduce((total, reason) => total + reason.points, SETTINGS.weights.bias);
      expect(score.points).toBeCloseTo(sum);
      expect(score.confidence).toBeCloseTo(1 / (1 + Math.exp(-sum)));
    }
  });

  it('reads its weights from the settings', () => {
    const doubtful: MergeSuggestionSettings = { ...SETTINGS, weights: { ...SETTINGS.weights, bias: -10 } };
    expect(scorePair(invoice1, invoice2, doubtful).confidence).toBeLessThan(SETTINGS.minConfidence);
  });
});

describe('confidenceBand', () => {
  it('bands at highBand and mediumBand, inclusive', () => {
    expect(confidenceBand(SETTINGS.highBand)).toBe('high');
    expect(confidenceBand(SETTINGS.highBand - 0.01)).toBe('medium');
    expect(confidenceBand(SETTINGS.mediumBand)).toBe('medium');
    expect(confidenceBand(SETTINGS.mediumBand - 0.01)).toBe('low');
  });
});
