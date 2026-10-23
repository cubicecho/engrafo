import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it } from 'vitest';

// The folders migration rewrites titles before it can make them unique, so it
// is run here against rows an older release wrote, not only against an empty
// schema the way every other test builds one.

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/drizzle');
const FOLDERS_MIGRATION = /_folders$/;

let workDir: string | undefined;

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

/** The migrations folder as it stood just before folders, then the whole of it. */
async function stagedMigrations(): Promise<{ before: string; all: string }> {
  workDir = await mkdtemp(path.join(tmpdir(), 'engrafo-migrations-'));
  const before = path.join(workDir, 'before');
  await cp(MIGRATIONS, before, { recursive: true });
  for (const entry of await readdir(before)) {
    if (FOLDERS_MIGRATION.test(entry)) {
      await rm(path.join(before, entry), { recursive: true });
    }
  }
  return { before, all: MIGRATIONS };
}

describe('the folders migration', () => {
  it('makes existing titles unique per user and takes the slashes out of them', async () => {
    const { before, all } = await stagedMigrations();
    const client = new PGlite('memory://', { extensions: { vector } });
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: before });

    await client.exec(`
      INSERT INTO users (id, email) VALUES
        ('00000000-0000-4000-8000-0000000000a1', 'a@example.com'),
        ('00000000-0000-4000-8000-0000000000b2', 'b@example.com');
      INSERT INTO documents (id, user_id, title, original_filename, mime_type, size_bytes, original_key, created_at) VALUES
        ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Scan', 's.pdf', 'application/pdf', 1, 'k1', '2026-01-01'),
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'scan', 's.pdf', 'application/pdf', 1, 'k2', '2026-01-02'),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'Scan (2)', 's.pdf', 'application/pdf', 1, 'k3', '2026-01-03'),
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'a/b', 'a.pdf', 'application/pdf', 1, 'k4', '2026-01-04'),
        ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000b2', 'Scan', 's.pdf', 'application/pdf', 1, 'k5', '2026-01-05');
    `);

    await migrate(db, { migrationsFolder: all });

    const { rows } = await client.query<{ id: string; title: string }>('SELECT id, title FROM documents ORDER BY id');
    expect(rows.map((row) => row.title)).toEqual([
      // The oldest keeps its title; the next skips "(2)", which a title already has.
      'Scan',
      'scan (3)',
      'Scan (2)',
      'a-b',
      // Another user's titles are theirs: no clash.
      'Scan',
    ]);
    await client.close();
  });
});
