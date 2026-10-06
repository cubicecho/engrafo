// Everything is read at call time so a test — or a reload — sees the current
// environment.

import { createRequire } from 'node:module';

// The exception to "read at call time": this is stamped into the build, not
// configured. The root package.json is the one semantic-release bumps, and the
// Dockerfile copies it to /app alongside the workspaces — so `../../` finds the
// released version in the image and the working tree's version in development.
const VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../../package.json').version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

/** The release this instance is running, for the settings screen and bug reports. */
export function version(): string {
  return VERSION;
}

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
 * Whether this instance trusts the network it is on.
 *
 * `SECURE_LOCAL_NET` is the ecosystem-wide spelling of "there is nothing hostile
 * between the browser and this port, so do not make people prove who they are".
 * Here that means sign-in needs no link.
 */
export function secureLocalNet(): boolean {
  return envFlag(process.env.SECURE_LOCAL_NET);
}

/**
 * Whether signing in requires following a magic link at all.
 *
 * Off — by `SECURE_LOCAL_NET=true` or the narrower `AUTH_MAGIC_LINK=false` —
 * `requestMagicLink` hands back a live session for whatever address it is given.
 * That is a deliberate convenience for a private self-hosted instance, and must
 * never be set on one exposed to the internet: the email address becomes the
 * entire credential.
 */
export function magicLinkRequired(): boolean {
  return !secureLocalNet() && !envDisabled(process.env.AUTH_MAGIC_LINK);
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

/** An OpenAI-compatible endpoint and the model on it that reads pages. */
export interface VlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** How long one page may take. Zero or less means no limit. */
  requestTimeoutSeconds: number;
}

/**
 * The vision endpoint that transcribes pages, or null where none is configured.
 *
 * Both the URL and the model are required and neither has a default worth
 * guessing: the same three variables point at a GPU box running vLLM, a CPU
 * build of PaddleOCR-VL, Ollama, or a hosted provider, and each of those names
 * its models differently. The key stays optional because a local server ignores
 * it.
 */
export function ocrVlm(): VlmConfig | null {
  const baseUrl = process.env.OCR_VLM_BASE_URL?.trim();
  const model = process.env.OCR_VLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    apiKey: process.env.OCR_VLM_API_KEY?.trim() ?? '',
    // One page is a prefill of several thousand image tokens. On a GPU that is
    // seconds; on the CPU build it is minutes, and a timeout sized for chat
    // abandons the prefill just before it pays off.
    requestTimeoutSeconds: envNumber(process.env.OCR_VLM_TIMEOUT_SECONDS, 600),
  };
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
