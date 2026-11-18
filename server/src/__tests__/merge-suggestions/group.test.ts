import { describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS as SETTINGS } from '../../core/defaults.ts';
import { groupCandidates, orderGroup } from '../../merge-suggestions/group.ts';
import { scorePair } from '../../merge-suggestions/score.ts';
import { apartPair, at, candidate, frontAndBack, invoicePages, morning, phonePhotos } from './fixtures.ts';

const ids = (documents: ReadonlyArray<{ id: string }>) => documents.map((document) => document.id);

describe('groupCandidates', () => {
  it("suggests the morning's three split scans and nothing else", () => {
    const groups = groupCandidates(morning);
    expect(groups.map((group) => [group.documentIds, group.band])).toEqual([
      [ids(invoicePages), 'high'],
      [ids(phonePhotos), 'high'],
      [ids(frontAndBack), 'medium'],
    ]);
  });

  it('puts pages filed in any order into page order', () => {
    // A browser uploads a folder in whatever order it lists it, so page 3 may be filed first.
    const reversed = invoicePages.map((page, index) => ({ ...page, createdAt: at(60 - index * 20) })).reverse();
    expect(groupCandidates(reversed).map((group) => group.documentIds)).toEqual([ids(invoicePages)]);
  });

  it('is as sure as its weakest step, and says each step', () => {
    const [group] = groupCandidates(invoicePages);
    const steps = [scorePair(invoicePages[0], invoicePages[1]), scorePair(invoicePages[1], invoicePages[2])];
    expect(group?.confidence).toBe(Math.min(...steps.map((step) => step.confidence)));
    expect(group?.links.map((link) => [link.fromId, link.toId])).toEqual([
      ['invoice-1', 'invoice-2'],
      ['invoice-2', 'invoice-3'],
    ]);
  });

  it('gives each reason once, strongest first', () => {
    const [group] = groupCandidates(invoicePages);
    const texts = group?.reasons.map((reason) => reason.text) ?? [];
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((text) => text === 'named in sequence')).toHaveLength(1);
    expect(texts).toEqual(expect.arrayContaining(['page 2 of 3 follows page 1', 'page 3 of 3 follows page 2']));
    const points = group?.reasons.map((reason) => reason.points) ?? [];
    expect(points).toEqual([...points].sort((x, y) => y - x));
  });

  it('never groups documents in different folders or hours apart', () => {
    expect(groupCandidates(apartPair)).toEqual([]);
  });

  it('suggests nothing for one document or none', () => {
    expect(groupCandidates([])).toEqual([]);
    expect(groupCandidates(invoicePages.slice(0, 1))).toEqual([]);
  });

  it('keeps only groups at or above minConfidence', () => {
    const strict = { ...SETTINGS, minConfidence: 0.9 };
    expect(groupCandidates(morning, strict).map((group) => group.band)).toEqual(['high', 'high']);
  });
});

describe('orderGroup', () => {
  it('orders by page marker before file name and filing time', () => {
    const page = (id: string, name: string, seconds: number, text: string) =>
      candidate({ id, originalFilename: name, createdAt: at(seconds), text });
    const shuffled = [page('b', 'scan_0001.pdf', 0, 'Page 2 of 2'), page('a', 'scan_0002.pdf', 10, 'Page 1 of 2')];
    expect(ids(orderGroup(shuffled))).toEqual(['a', 'b']);
  });

  it('orders by file number when no page is numbered, then by filing time', () => {
    const byName = [
      candidate({ id: 'b', originalFilename: 'IMG_0010.jpg', createdAt: at(0) }),
      candidate({ id: 'a', originalFilename: 'IMG_0009.jpg', createdAt: at(5) }),
    ];
    expect(ids(orderGroup(byName))).toEqual(['a', 'b']);
    const byTime = [
      candidate({ id: 'b', originalFilename: 'front.jpg', createdAt: at(5) }),
      candidate({ id: 'a', originalFilename: 'back.jpg', createdAt: at(0) }),
    ];
    expect(ids(orderGroup(byTime))).toEqual(['a', 'b']);
  });
});
