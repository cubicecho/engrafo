import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index.ts';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

await migrate(db, { migrationsFolder });

console.log('[db] migration complete');
process.exit(0);
