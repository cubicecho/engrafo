import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readTar, TAR_END, TarError, tarFileHeader, tarPadding } from '../../backup/tar.ts';

/** A tar of the files given, as the export writes one. */
function tarOf(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    parts.push(tarFileHeader(name, body.length, new Date('2026-01-02T03:04:05Z')), body, tarPadding(body.length));
  }
  parts.push(TAR_END);
  return Buffer.concat(parts);
}

/** Reads every file back, cut into awkward chunks the way a network delivers them. */
async function readAll(tar: Buffer, chunkBytes = 97): Promise<Record<string, string>> {
  async function* chunks() {
    for (let at = 0; at < tar.length; at += chunkBytes) {
      yield tar.subarray(at, at + chunkBytes);
    }
  }
  const files: Record<string, string> = {};
  for await (const entry of readTar(chunks())) {
    files[entry.name] = (await entry.read()).toString('utf8');
  }
  return files;
}

const LONG_NAME = `root/originals/${'Very long folder name/'.repeat(8)}Rechnung März ✓.pdf`;

describe('tar', () => {
  it('reads back what it writes, long and non-ASCII names included', async () => {
    const files = {
      'root/metadata.json': Buffer.from('{"a":1}'),
      [LONG_NAME]: Buffer.from('x'.repeat(1300)),
      'root/empty.txt': Buffer.alloc(0),
    };
    const read = await readAll(tarOf(files));
    expect(Object.keys(read)).toEqual(Object.keys(files));
    expect(read[LONG_NAME]).toBe('x'.repeat(1300));
    expect(read['root/empty.txt']).toBe('');
  });

  it('skips a body nobody reads', async () => {
    const tar = tarOf({ 'a.bin': Buffer.alloc(5000, 1), 'b.txt': Buffer.from('second') });
    const names: string[] = [];
    let second = '';
    for await (const entry of readTar(Readable.from([tar]))) {
      names.push(entry.name);
      if (entry.name === 'b.txt') {
        second = (await entry.read()).toString();
      }
    }
    expect(names).toEqual(['a.bin', 'b.txt']);
    expect(second).toBe('second');
  });

  it('refuses something that is not a tar, and one cut short', async () => {
    await expect(readAll(Buffer.alloc(1024, 7))).rejects.toThrow(TarError);
    const tar = tarOf({ 'a.txt': Buffer.from('y'.repeat(2000)) });
    await expect(readAll(tar.subarray(0, 1000))).rejects.toThrow(TarError);
  });

  it('is a tar that GNU or BSD tar extracts', async (context) => {
    let hasTar = true;
    try {
      execFileSync('tar', ['--version'], { stdio: 'ignore' });
    } catch {
      hasTar = false;
    }
    if (hasTar === false) {
      context.skip();
    }
    const dir = await mkdtemp(join(tmpdir(), 'engrafo-tar-'));
    try {
      await writeFile(join(dir, 'out.tar'), tarOf({ [LONG_NAME]: Buffer.from('hello') }));
      execFileSync('tar', ['-xf', 'out.tar'], { cwd: dir });
      expect(await readFile(join(dir, LONG_NAME), 'utf8')).toBe('hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
