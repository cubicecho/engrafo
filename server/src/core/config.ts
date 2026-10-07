// Everything is read at call time so a test — or a reload — sees the current
// environment.

import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@cubicecho/engrafo-db/defaults';
import {
  AUTH_DEFAULTS,
  type AuthSettings,
  DOCUMENT_DEFAULTS,
  HTTP_DEFAULTS,
  OCR_DEFAULTS,
  STORAGE_DEFAULTS,
} from './defaults.ts';

/** Signs sessions when `BETTER_AUTH_SECRET` is unset. Preflight refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-in-production-0123456789';
/** The value `.env.example` ships, which preflight refuses in production. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';
/** The `SESSION_STORE` value that keeps sessions in process memory. */
export const SESSION_STORE_MEMORY = 'memory';
/** The `SESSION_STORE` value that keeps sessions in the `sessions` table. */
export const SESSION_STORE_DATABASE = 'database';
/** The `TRUST_PROXY` word for trusting no hop, as opposed to a hop count or a subnet list. */
const TRUST_PROXY_OFF = 'false';
/** The `TRUST_PROXY` word for trusting every hop. */
const TRUST_PROXY_ON = 'true';
/** A whole number of proxy hops. */
const HOP_COUNT = /^\d+$/;
/** What `NODE_ENV` is on a deployed instance. */
const PRODUCTION = 'production';

// The exception to "read at call time": this is stamped into the build, not
// configured. The root package.json is the one semantic-release bumps, and the
// Dockerfile copies it to /app alongside the workspaces — so `../../../` finds the
// released version in the image and the working tree's version in development.
const VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../../../package.json').version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

/**
 * Names the release this instance is running, for the settings screen and bug reports.
 *
 * @returns The version in the root package.json, or `unknown` when it cannot be read.
 */
export function version(): string {
  return VERSION;
}

/**
 * Reads a truthy env-var value.
 *
 * @param value - The variable as set, if it is. "1", "true" and "yes" count, in any case.
 * @returns false when unset or anything else.
 */
export function envFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

/** Falsy env-var values: "0", "false", "no" (case-insensitive). */
function envDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'no'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Reads a switch that has a default.
 *
 * @param value - The variable as set, if it is.
 * @param fallback - What the switch is when the variable says neither yes nor no.
 * @returns Whether the switch is on.
 */
function envSwitch(value: string | undefined, fallback: boolean): boolean {
  if (envFlag(value)) {
    return true;
  }
  return envDisabled(value) ? false : fallback;
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether this is a deployed instance rather than a development or test one.
 *
 * @returns true when `NODE_ENV` is `production`.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === PRODUCTION;
}

/**
 * How long boot waits for Postgres before exiting.
 *
 * @returns `DB_CONNECT_TIMEOUT_MS`, or `DATABASE_DEFAULTS.connectTimeoutMs`, in milliseconds.
 */
export function dbConnectTimeoutMs(): number {
  return envNumber(process.env.DB_CONNECT_TIMEOUT_MS, DATABASE_DEFAULTS.connectTimeoutMs);
}

/**
 * Reads the Postgres connection string, which preflight has already refused to boot without.
 *
 * @returns `DATABASE_URL`, or an empty string when unset.
 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? '';
}

/**
 * Reads what better-auth signs sessions and hashes magic-link tokens with.
 *
 * @returns `BETTER_AUTH_SECRET`, or `DEV_SECRET` when unset.
 */
export function authSecret(): string {
  return process.env.BETTER_AUTH_SECRET || DEV_SECRET;
}

/**
 * Reads where better-auth keeps sessions.
 *
 * @returns `SESSION_STORE` when it is one of the two known values, otherwise the default.
 *
 * @remarks
 * In memory, a restart signs everyone out; in the database they survive one, and more than one
 * replica can share them.
 */
export function sessionStore(): AuthSettings['sessionStore'] {
  const value = (process.env.SESSION_STORE ?? '').trim().toLowerCase();
  if (value === SESSION_STORE_MEMORY || value === SESSION_STORE_DATABASE) {
    return value;
  }
  return AUTH_DEFAULTS.sessionStore;
}

/**
 * Reads what Express trusts `X-Forwarded-For` from, which decides whose address `req.ip` is.
 *
 * @returns false or true, a hop count, or a subnet list passed through as written.
 *
 * @remarks
 * The sign-in throttle counts by `req.ip`: wrong, every client shares the proxy's address and
 * is locked out together.
 */
export function trustProxy(): boolean | number | string {
  const value = (process.env.TRUST_PROXY ?? '').trim();
  if (value === '') {
    return HTTP_DEFAULTS.trustProxy;
  }
  if (value === TRUST_PROXY_OFF) {
    return false;
  }
  if (value === TRUST_PROXY_ON) {
    return true;
  }
  return HOP_COUNT.test(value) ? Number(value) : value;
}

/**
 * Whether this instance trusts the network it is on.
 *
 * @returns `SECURE_LOCAL_NET`, or `AUTH_DEFAULTS.secureLocalNet`.
 *
 * @remarks
 * `SECURE_LOCAL_NET` is the ecosystem-wide spelling of "there is nothing hostile between the
 * browser and this port, so do not make people prove who they are". Here that means sign-in
 * needs no link.
 */
export function secureLocalNet(): boolean {
  return envSwitch(process.env.SECURE_LOCAL_NET, AUTH_DEFAULTS.secureLocalNet);
}

/**
 * Whether signing in requires following a magic link at all.
 *
 * @returns false when `SECURE_LOCAL_NET` is on or the narrower `AUTH_MAGIC_LINK` is off.
 *
 * @remarks
 * Off, `requestSignIn` hands back a live session for whatever address it is given. That is a
 * deliberate convenience for a private self-hosted instance, and must never be set on one
 * exposed to the internet: the email address becomes the entire credential.
 */
export function magicLinkRequired(): boolean {
  const isLinkSwitchedOn = envSwitch(process.env.AUTH_MAGIC_LINK, AUTH_DEFAULTS.magicLink);
  return secureLocalNet() === false && isLinkSwitchedOn;
}

/**
 * Whether the magic link is returned in the API response rather than only logged.
 *
 * @returns true outside production, or when `EXPOSE_MAGIC_LINK` is on.
 */
export function magicLinkExposed(): boolean {
  return isProduction() === false || envSwitch(process.env.EXPOSE_MAGIC_LINK, AUTH_DEFAULTS.exposeMagicLink);
}

/**
 * Reads the port the server listens on.
 *
 * @returns `PORT`, or `HTTP_DEFAULTS.port`.
 */
export function port(): number {
  return envNumber(process.env.PORT, HTTP_DEFAULTS.port);
}

/**
 * Reads where this instance is reached.
 *
 * @returns `APP_URL`, or this server's own origin on `localhost`.
 *
 * @remarks
 * In production the server serves the client itself, so its own origin is the right default,
 * but only for someone browsing from this machine. Set APP_URL to the address users actually
 * type: magic links are built from it, and a link to `localhost` is useless in an inbox.
 */
export function appUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${port()}`;
}

/**
 * Reads the largest upload accepted.
 *
 * @returns `MAX_UPLOAD_BYTES`, or `DOCUMENT_DEFAULTS.maxUploadBytes`, in bytes.
 *
 * @remarks
 * The browser uploads straight to S3, so this is enforced by the signature, not a body parser.
 */
export function maxUploadBytes(): number {
  return envNumber(process.env.MAX_UPLOAD_BYTES, DOCUMENT_DEFAULTS.maxUploadBytes);
}

/**
 * Whether OCR is allowed on this instance.
 *
 * @returns `OCR_ENABLED`, or `OCR_DEFAULTS.enabled`.
 *
 * @remarks
 * Whether it can actually run is `detectOcr`'s question.
 */
export function ocrEnabled(): boolean {
  return envSwitch(process.env.OCR_ENABLED, OCR_DEFAULTS.enabled);
}

/**
 * Whether the upload form's OCR toggle starts on.
 *
 * @returns `OCR_DEFAULT`, or `OCR_DEFAULTS.requestedByDefault`.
 */
export function ocrDefault(): boolean {
  return envSwitch(process.env.OCR_DEFAULT, OCR_DEFAULTS.requestedByDefault);
}

/**
 * Reads the languages OCR recognises.
 *
 * @returns Tesseract language codes joined with `+`, as ocrmypdf's `-l` takes them.
 */
export function ocrLanguages(): string {
  return process.env.OCR_LANGUAGES?.trim() || OCR_DEFAULTS.languages;
}

/**
 * Reads how many documents are processed at once.
 *
 * @returns `OCR_CONCURRENCY`, or `OCR_DEFAULTS.concurrency`.
 *
 * @remarks
 * OCR is CPU-bound, so one is the safe default.
 */
export function pipelineConcurrency(): number {
  return envNumber(process.env.OCR_CONCURRENCY, OCR_DEFAULTS.concurrency);
}

/** How to reach the two buckets and sign for them. */
export interface S3Config {
  /** Where the server reaches the buckets. */
  endpoint: string;
  /** Where the browser reaches them, and the host presigned URLs are signed against. */
  publicEndpoint: string;
  region: string;
  /** Holds what the user uploaded and what OCR produced. */
  bucket: string;
  /** Where extracted text goes. Postgres holds the metadata; the text itself is an object. */
  textBucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Reads how to reach the buckets.
 *
 * @returns The settings, with `publicEndpoint` falling back to `endpoint` and `textBucket` to the bucket's name plus a suffix.
 *
 * @remarks
 * Two endpoints because two parties talk to the bucket. The server reaches it however the
 * deployment wires it (`http://minio:9000` on a compose network); the browser needs an address
 * it can resolve, and a presigned URL's signature covers the host, so it has to be signed
 * against that public address, not rewritten afterwards.
 */
export function s3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT ?? '';
  const bucket = process.env.S3_BUCKET ?? '';
  return {
    endpoint,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || endpoint,
    region: process.env.S3_REGION || STORAGE_DEFAULTS.region,
    bucket,
    textBucket: process.env.S3_TEXT_BUCKET || `${bucket}${STORAGE_DEFAULTS.textBucketSuffix}`,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  };
}
