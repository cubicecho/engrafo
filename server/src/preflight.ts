// Environment checks that must run before anything opens a connection or signs a
// token. Imported for its side effects as the very first import of index.ts, so
// a misconfigured instance fails with a sentence rather than a stack trace.

const DEV_SECRET = 'dev-secret-change-in-production';

function fatal(message: string): never {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fatal('DATABASE_URL is required. Copy .env.example to .env, then run `npm run db:up` for a local Postgres.');
}

// Without these every upload would get as far as asking for a presigned URL and
// fail there, which reads as a bug in the upload form rather than a missing env var.
for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) {
    fatal(`${name} is required. Copy .env.example to .env, then run \`npm run db:up\` for a local MinIO.`);
  }
}

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_SECRET) {
    // Session tokens are signed with this and nothing else. A known secret means
    // anyone can mint a token for any account.
    fatal('JWT_SECRET must be set to a strong random value in production. Generate one with `openssl rand -hex 32`.');
  }
}
