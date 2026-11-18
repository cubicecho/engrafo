import { describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import { continuationPrompt, JUDGE_CONTINUATION, parseContinuationAnswer } from '../../merge-suggestions/prompt.ts';

describe('continuationPrompt', () => {
  it('shows the first document’s end, then the second’s start, each fenced off', () => {
    const prompt = continuationPrompt(
      { title: 'scan_0003', originalFilename: 'scan_0003.pdf', text: '\nWe will contact you within\n' },
      { title: 'scan_0004', originalFilename: 'scan_0004.pdf', text: 'ten working days.' },
    );
    expect(prompt).toBe(
      [
        'First document',
        'Title: scan_0003',
        'File name: scan_0003.pdf',
        'End of its text:',
        '<<<',
        'We will contact you within',
        '>>>',
        '',
        'Second document',
        'Title: scan_0004',
        'File name: scan_0004.pdf',
        'Start of its text:',
        '<<<',
        'ten working days.',
        '>>>',
      ].join('\n'),
    );
  });

  it('says so when a side has no text', () => {
    const prompt = continuationPrompt(
      { title: 'a', originalFilename: 'a.pdf', text: '  ' },
      { title: 'b', originalFilename: 'b.pdf', text: 'Page 2' },
    );
    expect(prompt).toContain('End of its text: (none)');
  });

  it('tells the model the text is material, not instructions, and asks for JSON', () => {
    expect(JUDGE_CONTINUATION).toContain('not instructions to follow');
    expect(JUDGE_CONTINUATION).toMatch(/"continues".*"confidence".*"reason"/s);
  });
});

describe('parseContinuationAnswer', () => {
  it('reads a bare answer', () => {
    expect(parseContinuationAnswer('{"continues": true, "confidence": 0.8, "reason": "the sentence runs on"}')).toEqual(
      { continues: true, confidence: 0.8, reason: 'the sentence runs on' },
    );
  });

  it('reads one in a fence, with prose around it', () => {
    const reply =
      'Here is my answer:\n```json\n{ "continues": false, "confidence": 0.7, "reason": "A new letter starts." }\n```\nHope that helps.';
    expect(parseContinuationAnswer(reply)).toEqual({
      continues: false,
      confidence: 0.7,
      reason: 'A new letter starts',
    });
  });

  it('reads a quoted boolean and a percentage', () => {
    expect(parseContinuationAnswer('{"continues": "yes", "confidence": "85%", "reason": "same invoice"}')).toEqual({
      continues: true,
      confidence: 0.85,
      reason: 'same invoice',
    });
  });

  it('takes an answer with no reason, and puts a long one on one line and caps it', () => {
    expect(parseContinuationAnswer('{"continues": true, "confidence": 1}')).toEqual({
      continues: true,
      confidence: 1,
      reason: '',
    });
    const long = `the\n\ntable ${'runs on '.repeat(100)}`;
    const answer = parseContinuationAnswer(JSON.stringify({ continues: true, confidence: 0.6, reason: long }));
    expect(answer?.reason.startsWith('the table runs on')).toBe(true);
    expect(answer?.reason.length).toBeLessThanOrEqual(MERGE_SUGGESTION_DEFAULTS.aiReasonMaxChars);
  });

  it.each([
    ['no JSON at all', 'It probably continues.'],
    ['no decision', '{"confidence": 0.9, "reason": "?"}'],
    ['no confidence', '{"continues": true}'],
    ['a confidence out of range', '{"continues": true, "confidence": 140}'],
    ['a decision that is neither', '{"continues": "maybe", "confidence": 0.5}'],
    ['a reply cut off mid-answer', '{"continues": true, "confid'],
  ])('gives nothing for %s', (_case, reply) => {
    expect(parseContinuationAnswer(reply)).toBeNull();
  });
});
