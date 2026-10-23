import { describe, expect, it } from 'vitest';
import {
  archiveEntries,
  documentPathIn,
  folderAndDescendants,
  folderNameError,
  folderOptions,
  folderPaths,
  TOP_LEVEL,
  TOP_LEVEL_LABEL,
} from './folder-tree';

const FOLDERS = [
  { id: 'taxes', name: 'Taxes', parentId: null },
  { id: 'y2026', name: '2026', parentId: 'taxes' },
  { id: 'q1', name: 'Q1', parentId: 'y2026' },
  { id: 'bills', name: 'Bills', parentId: null },
];

describe('folderPaths', () => {
  it('names each folder by its path from the top', () => {
    expect(Object.fromEntries(folderPaths(FOLDERS))).toEqual({
      taxes: 'Taxes',
      y2026: 'Taxes/2026',
      q1: 'Taxes/2026/Q1',
      bills: 'Bills',
    });
  });

  it('puts a folder whose parent is missing at the top level, and survives a loop', () => {
    const paths = folderPaths([
      { id: 'orphan', name: 'Orphan', parentId: 'gone' },
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]);
    expect(paths.get('orphan')).toBe('Orphan');
    expect(paths.get('a')).toMatch(/A$/);
  });
});

describe('documentPathIn', () => {
  const paths = folderPaths(FOLDERS);

  it('puts the folder path before the title', () => {
    expect(documentPathIn(paths, { id: 'd', title: 'scan', folderId: 'y2026' })).toBe('Taxes/2026/scan');
  });

  it('is the bare title at the top level or in a folder it does not know', () => {
    expect(documentPathIn(paths, { id: 'd', title: 'scan', folderId: null })).toBe('scan');
    expect(documentPathIn(paths, { id: 'd', title: 'scan', folderId: 'gone' })).toBe('scan');
  });
});

describe('archiveEntries', () => {
  it('lists every folder, empty or not, and files each document under its folder', () => {
    const entries = archiveEntries(FOLDERS, [
      { id: 'd1', title: 'Return', folderId: 'y2026' },
      { id: 'd2', title: 'Lease', folderId: null },
    ]);
    expect(entries.map((entry) => [entry.type, entry.path])).toEqual([
      ['dir', 'Taxes'],
      ['dir', 'Taxes/2026'],
      ['dir', 'Taxes/2026/Q1'],
      ['dir', 'Bills'],
      ['file', 'Taxes/2026/Return'],
      ['file', 'Lease'],
    ]);
  });
});

describe('folderAndDescendants', () => {
  it('finds the folder and everything under it, at any depth', () => {
    expect([...folderAndDescendants(FOLDERS, 'taxes')].sort()).toEqual(['q1', 'taxes', 'y2026']);
    expect([...folderAndDescendants(FOLDERS, 'bills')]).toEqual(['bills']);
  });
});

describe('folderOptions', () => {
  it('offers the top level first, then folders by path, leaving out what is excluded', () => {
    expect(folderOptions(FOLDERS, folderAndDescendants(FOLDERS, 'y2026'))).toEqual([
      { value: TOP_LEVEL, label: TOP_LEVEL_LABEL },
      { value: 'bills', label: 'Bills' },
      { value: 'taxes', label: 'Taxes' },
    ]);
  });
});

describe('folderNameError', () => {
  it.each([
    ['', 'Give the folder a name'],
    ['.hidden', /letters/],
    ['a/b', /letters/],
    ['x'.repeat(65), /64/],
  ])('refuses %j', (name, message) => {
    expect(folderNameError(name)).toMatch(message);
  });

  it('accepts a name the server accepts', () => {
    expect(folderNameError('Taxes 2026_v1.final-copy')).toBeUndefined();
  });
});
