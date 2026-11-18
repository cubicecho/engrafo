import { describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import type { MergeLink } from '../../merge-suggestions/group.ts';
import { AI_SIGNAL, type MergeReason } from '../../merge-suggestions/score.ts';
import {
  addVerdict,
  combinedStepConfidence,
  combineScores,
  type MergeVerdict,
  ruleReasonsOf,
} from '../../merge-suggestions/verdicts.ts';

const link = (fromId: string, toId: string, heuristic: number): MergeLink => ({ fromId, toId, heuristic });

const verdict = (fromId: string, toId: string, answer: Partial<MergeVerdict> = {}): MergeVerdict => ({
  fromId,
  toId,
  continues: true,
  confidence: 0.9,
  reason: 'the sentence runs on',
  model: 'test-vlm',
  checkedAt: '2026-11-18T09:00:00.000Z',
  ...answer,
});

const timeGap: MergeReason = { signal: 'timeGap', text: 'scanned 40 s apart', points: 1.5 };
const { minConfidence, highBand, aiWeight } = MERGE_SUGGESTION_DEFAULTS;

describe('combinedStepConfidence', () => {
  it('leaves the rules’ confidence as it is with no verdict', () => {
    expect(combinedStepConfidence(0.7, undefined)).toBe(0.7);
  });

  it('moves the rules’ confidence by the verdict in logit space', () => {
    const logit = Math.log(0.7 / 0.3);
    const confirmed = combinedStepConfidence(0.7, { continues: true, confidence: 0.9 });
    expect(confirmed).toBeCloseTo(1 / (1 + Math.exp(-(logit + aiWeight * 0.9))), 10);
    expect(confirmed).toBeGreaterThanOrEqual(highBand);

    const rejected = combinedStepConfidence(0.7, { continues: false, confidence: 0.9 });
    expect(rejected).toBeCloseTo(1 / (1 + Math.exp(-(logit - aiWeight * 0.9))), 10);
    expect(rejected).toBeLessThan(minConfidence);
  });

  it('moves a step less the less sure the model is', () => {
    const hesitant = combinedStepConfidence(0.7, { continues: true, confidence: 0.2 });
    const sure = combinedStepConfidence(0.7, { continues: true, confidence: 1 });
    expect(hesitant).toBeGreaterThan(0.7);
    expect(hesitant).toBeLessThan(sure);
  });

  it('stays finite at a rules confidence of exactly 0 or 1', () => {
    expect(combinedStepConfidence(1, { continues: false, confidence: 1 })).toBeLessThan(1);
    expect(combinedStepConfidence(0, { continues: true, confidence: 1 })).toBeGreaterThan(0);
  });
});

describe('combineScores', () => {
  const documentIds = ['a', 'b', 'c'];
  const links = [link('a', 'b', 0.95), link('b', 'c', 0.7)];

  it('is the rules’ weakest step with no verdicts', () => {
    const scores = combineScores({ documentIds, links, ruleReasons: [timeGap], verdicts: [] });
    expect(scores).toEqual({ heuristicConfidence: 0.7, confidence: 0.7, reasons: [timeGap] });
  });

  it('lifts a suggestion the model confirms, and says so', () => {
    const scores = combineScores({ documentIds, links, ruleReasons: [timeGap], verdicts: [verdict('b', 'c')] });
    expect(scores.heuristicConfidence).toBe(0.7);
    expect(scores.confidence).toBeGreaterThan(0.7);
    expect(scores.reasons).toEqual([
      { signal: AI_SIGNAL, text: 'AI: page 3 continues page 2 (the sentence runs on)', points: aiWeight * 0.9 },
      timeGap,
    ]);
  });

  it('drops a suggestion the model rejects below minConfidence, and says why last', () => {
    const rejected = verdict('a', 'b', { continues: false, confidence: 1, reason: 'a new letter starts' });
    const scores = combineScores({ documentIds, links, ruleReasons: [timeGap], verdicts: [rejected] });
    expect(scores.heuristicConfidence).toBe(0.7);
    expect(scores.confidence).toBeLessThan(minConfidence);
    expect(scores.reasons.at(-1)).toEqual({
      signal: AI_SIGNAL,
      text: 'AI: page 2 does not continue page 1 (a new letter starts)',
      points: -aiWeight,
    });
  });

  it('takes the weakest step once each verdict has moved its own', () => {
    const verdicts = [verdict('a', 'b', { confidence: 0.2 }), verdict('b', 'c', { confidence: 1 })];
    const scores = combineScores({ documentIds, links, ruleReasons: [], verdicts });
    const first = combinedStepConfidence(0.95, verdicts[0]);
    const second = combinedStepConfidence(0.7, verdicts[1]);
    expect(second).toBeGreaterThan(first);
    expect(scores.confidence).toBe(first);
  });

  it('ignores a verdict about a step the suggestion does not have', () => {
    const scores = combineScores({ documentIds, links, ruleReasons: [], verdicts: [verdict('c', 'b')] });
    expect(scores).toEqual({ heuristicConfidence: 0.7, confidence: 0.7, reasons: [] });
  });

  it('writes reasons the rules’ side can be read back from', () => {
    const scores = combineScores({ documentIds, links, ruleReasons: [timeGap], verdicts: [verdict('a', 'b')] });
    expect(ruleReasonsOf(scores.reasons)).toEqual([timeGap]);
  });
});

describe('addVerdict', () => {
  const links = [link('a', 'b', 0.7)];

  it('adds an answer for a step the suggestion still has', () => {
    expect(addVerdict(links, [], verdict('a', 'b'))).toEqual([verdict('a', 'b')]);
  });

  it('refuses one for a step it no longer has, or one already answered', () => {
    expect(addVerdict(links, [], verdict('b', 'a'))).toBeNull();
    expect(addVerdict(links, [verdict('a', 'b')], verdict('a', 'b', { continues: false }))).toBeNull();
  });
});
