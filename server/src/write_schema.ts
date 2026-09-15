import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printSchema } from 'graphql';
import { schema } from './schema.ts';

// Prints the schema the server actually serves, so codegen (both here and in the
// app) reads the same SDL rather than a hand-maintained copy of it.

const __dirname = dirname(fileURLToPath(import.meta.url));

const outputDir = resolve(__dirname, '..', '__generated__');
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'schema.graphql'), printSchema(schema), 'utf-8');
