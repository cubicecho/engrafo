// Preload: load the repo-root .env before the main module initializes.
// Runs via --import so it executes ahead of hoisted ESM imports — engrafo-db
// reads DATABASE_URL at import time, so it has to be in place by then.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

try {
  process.loadEnvFile(envPath);
} catch {
  // .env not present — use the ambient environment as-is (Docker/CI)
}
