// Everything is read at call time so a test — or a reload — sees the current
// environment.

/** Truthy env-var values: "1", "true", "yes" (case-insensitive). */
export function envFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

/** Falsy env-var values: "0", "false", "no" (case-insensitive). */
function envDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'no'].includes((value ?? '').trim().toLowerCase());
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether signing in requires following a magic link at all.
 *
 * With `AUTH_MAGIC_LINK=false`, `requestMagicLink` hands back a live session for
 * whatever address it is given. That is a deliberate convenience for a private
 * self-hosted instance, and must never be set on one exposed to the internet.
 */
export function magicLinkRequired(): boolean {
  return !envDisabled(process.env.AUTH_MAGIC_LINK);
}

/** Whether the magic link is returned in the API response rather than only logged. */
export function magicLinkExposed(): boolean {
  return process.env.NODE_ENV !== 'production' || envFlag(process.env.EXPOSE_MAGIC_LINK);
}

export function port(): number {
  return envNumber(process.env.PORT, 3004);
}

/**
 * Where this instance is reached. In production the server serves the client
 * itself, so its own origin is the right default — but only for someone
 * browsing from this machine. Set APP_URL to the address users actually type;
 * magic links are built from it, and a link to `localhost` is useless in an
 * inbox.
 */
export function appUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${port()}`;
}

/** Default 100 MiB. The browser uploads straight to S3, so this is enforced by the signature, not a body parser. */
export function maxUploadBytes(): number {
  return envNumber(process.env.MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
}

/** Whether OCR is allowed on this instance. Whether it can actually run is `detectOcr`'s question. */
export function ocrEnabled(): boolean {
  return !envDisabled(process.env.OCR_ENABLED);
}

/** Whether the upload form's OCR toggle starts on. */
export function ocrDefault(): boolean {
  return !envDisabled(process.env.OCR_DEFAULT);
}

/** Tesseract language codes joined with `+`, as ocrmypdf's `-l` takes them. */
export function ocrLanguages(): string {
  return process.env.OCR_LANGUAGES?.trim() || 'eng';
}

/** How many documents are processed at once. OCR is CPU-bound; one is the safe default. */
export function pipelineConcurrency(): number {
  return envNumber(process.env.OCR_CONCURRENCY, 1);
}

export interface S3Config {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  /** Where extracted text goes. Postgres holds the metadata; the text itself is an object. */
  textBucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Two endpoints because two parties talk to the bucket. The server reaches it
 * however the deployment wires it (`http://minio:9000` on a compose network);
 * the browser needs an address it can resolve, and a presigned URL's signature
 * covers the host — so it has to be signed against that public address, not
 * rewritten afterwards.
 */
export function s3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT ?? '';
  const bucket = process.env.S3_BUCKET ?? '';
  return {
    endpoint,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    bucket,
    textBucket: process.env.S3_TEXT_BUCKET || `${bucket}-text`,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  };
}
