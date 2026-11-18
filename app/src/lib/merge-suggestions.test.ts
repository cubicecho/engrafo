import { describe, expect, it } from 'vitest';
import { MergeSuggestionBand } from '@/__generated__/graphql';
import { AI_SIGNAL, bandLabel, formatPercent, modelSummary, ruleReasons } from './merge-suggestions';

describe('ruleReasons', () => {
  it('puts the rules’ reasons for and against apart, each strongest first, and leaves the model’s out', () => {
    const { supporting, opposing } = ruleReasons([
      { signal: 'time', text: 'scanned 40 s apart', points: 1.5 },
      { signal: 'letterhead', text: 'opens with a date', points: -0.5 },
      { signal: AI_SIGNAL, text: 'AI: page 2 continues page 1', points: 2.4 },
      { signal: 'pageMarker', text: 'page 2 of 3 follows page 1', points: 3 },
      { signal: 'metadata', text: 'a different vendor', points: -2 },
    ]);
    expect(supporting.map((reason) => reason.text)).toEqual(['page 2 of 3 follows page 1', 'scanned 40 s apart']);
    expect(opposing.map((reason) => reason.text)).toEqual(['a different vendor', 'opens with a date']);
  });
});

describe('modelSummary', () => {
  it('says nothing when the model checked nothing', () => {
    expect(modelSummary(0.72, [])).toBeNull();
  });

  it('gives one answer with its reason, either way', () => {
    expect(modelSummary(0.72, [{ continues: true, reason: 'the sentence runs on' }])).toBe(
      'rules 72% · AI confirmed: the sentence runs on',
    );
    expect(modelSummary(0.6, [{ continues: false, reason: 'page 2 starts a new letter' }])).toBe(
      'rules 60% · AI doubted: page 2 starts a new letter',
    );
    expect(modelSummary(0.6, [{ continues: true, reason: '' }])).toBe('rules 60% · AI confirmed');
  });

  it('counts several answers', () => {
    const yes = { continues: true, reason: 'runs on' };
    const no = { continues: false, reason: 'new letter' };
    expect(modelSummary(0.7, [yes, yes])).toBe('rules 70% · AI confirmed all 2 page breaks');
    expect(modelSummary(0.7, [yes, no, yes])).toBe('rules 70% · AI doubted 1 of 3 page breaks');
  });
});

describe('bandLabel', () => {
  it('names the band and rounds the confidence', () => {
    expect(bandLabel(MergeSuggestionBand.High, 0.926)).toBe('High · 93%');
    expect(bandLabel(MergeSuggestionBand.Low, 0.5)).toBe('Low · 50%');
    expect(formatPercent(0.874)).toBe('87%');
  });
});
