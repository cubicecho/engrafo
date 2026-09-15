import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index.ts';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

// biome-ignore lint/suspicious/noExplicitAny: the driver union is compatible at runtime
await migrate(db as any, { migrationsFolder });

console.log('Migration complete.');
process.exit(0);
