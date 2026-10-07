// Every value someone might tune, as plain data. Nothing here computes, reads the environment or imports.

/** Settings for the HTTP door. */
export interface HttpSettings {
  /** Port the server listens on. `PORT` overrides it. */
  port: number;
  /** How long shutdown lets open requests finish before it cuts them. */
  drainSeconds: number;
  /** How long shutdown may take in all before a hard exit. Keep it under Docker's 10 s. */
  shutdownDeadlineSeconds: number;
  /** How long a browser may keep a hashed bundle without asking again. */
  assetCacheDays: number;
  /** Express `trust proxy`: which hops may set X-Forwarded-For. False trusts none. `TRUST_PROXY` overrides it. */
  trustProxy: boolean | number | string;
}

/** The shipped values of `HttpSettings`. */
export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3004,
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
  assetCacheDays: 365,
  trustProxy: false,
});

/** The sign-in throttle. */
export interface RateLimitSettings {
  /** Attempts allowed per key inside one window. */
  maxAttempts: number;
  /** How long an attempt counts against its key. */
  windowMinutes: number;
  /** Past this many keys, a hit sweeps out the ones whose window has passed. */
  sweepAtKeys: number;
}

/** The shipped values of `RateLimitSettings`. */
export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 10,
  windowMinutes: 15,
  sweepAtKeys: 10_000,
});

/** Sign-in and credential settings. */
export interface AuthSettings {
  /** How long a sign-in link works. */
  magicLinkTtlMinutes: number;
  /** Shortest signing secret production accepts, in characters. */
  minSecretLength: number;
  /** Where better-auth keeps sessions. `SESSION_STORE` overrides it. */
  sessionStore: 'memory' | 'database';
  /** Whether the network is trusted, so an address alone signs in. `SECURE_LOCAL_NET` overrides it. */
  secureLocalNet: boolean;
  /** Whether signing in means following a link. `AUTH_MAGIC_LINK` overrides it. */
  magicLink: boolean;
  /** Whether the link comes back in the API response outside development. `EXPOSE_MAGIC_LINK` overrides it. */
  exposeMagicLink: boolean;
}

/** The shipped values of `AuthSettings`. */
export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  magicLinkTtlMinutes: 15,
  minSecretLength: 32,
  sessionStore: 'memory',
  secureLocalNet: false,
  magicLink: true,
  exposeMagicLink: false,
});

/** What an upload may be and how its row is filled in. */
export interface DocumentSettings {
  /** Largest file accepted, in bytes. `MAX_UPLOAD_BYTES` overrides it. */
  maxUploadBytes: number;
  /** Longest title, in characters. */
  titleMaxLength: number;
  /** Longest original filename kept, in characters. */
  filenameMaxLength: number;
}

/** The shipped values of `DocumentSettings`. */
export const DOCUMENT_DEFAULTS: Readonly<DocumentSettings> = Object.freeze({
  // 100 MiB.
  maxUploadBytes: 104_857_600,
  titleMaxLength: 500,
  filenameMaxLength: 1000,
});

/** The ocr step and the pipeline around it. */
export interface OcrSettings {
  /** Whether OCR is allowed on this instance. `OCR_ENABLED` overrides it. */
  enabled: boolean;
  /** Whether the upload form's toggle starts on. `OCR_DEFAULT` overrides it. */
  requestedByDefault: boolean;
  /** Tesseract language codes joined with `+`. `OCR_LANGUAGES` overrides it. */
  languages: string;
  /** How many documents are processed at once. `OCR_CONCURRENCY` overrides it. */
  concurrency: number;
  /** When a run is given up on as wedged. A long scan on one core takes minutes, so this is not an estimate. */
  timeoutMinutes: number;
  /** Resolution assumed for an image, which usually carries none and img2pdf refuses to guess. */
  imageDpi: number;
  /** How much of ocrmypdf's output is buffered before the run is abandoned, in bytes. */
  maxOutputBytes: number;
  /** How many lines from the end of stderr become the failure message. */
  errorTailLines: number;
}

/** The shipped values of `OcrSettings`. */
export const OCR_DEFAULTS: Readonly<OcrSettings> = Object.freeze({
  enabled: true,
  requestedByDefault: true,
  languages: 'eng',
  concurrency: 1,
  timeoutMinutes: 30,
  imageDpi: 300,
  // 16 MiB.
  maxOutputBytes: 16_777_216,
  errorTailLines: 5,
});

/** The buckets and the URLs signed for them. */
export interface StorageSettings {
  /** S3 region. `S3_REGION` overrides it. */
  region: string;
  /** What `S3_BUCKET` gains to name the text bucket. `S3_TEXT_BUCKET` overrides the whole name. */
  textBucketSuffix: string;
  /** How long a presigned upload URL works. */
  uploadUrlTtlMinutes: number;
  /** How long a presigned download URL works. */
  downloadUrlTtlMinutes: number;
}

/** The shipped values of `StorageSettings`. */
export const STORAGE_DEFAULTS: Readonly<StorageSettings> = Object.freeze({
  region: 'us-east-1',
  textBucketSuffix: '-text',
  uploadUrlTtlMinutes: 15,
  downloadUrlTtlMinutes: 5,
});
