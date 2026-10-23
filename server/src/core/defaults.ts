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
  /** How long the token an OIDC callback hands the app works: the hop from the callback to `/auth/sso`. */
  oneTimeTokenTtlMinutes: number;
  /** What the login page's OIDC button calls the provider. `OIDC_NAME` overrides it. */
  oidcName: string;
  /** How a confidential OIDC client sends its secret. `OIDC_CLIENT_AUTH` overrides it. */
  oidcClientAuth: 'client_secret_basic' | 'client_secret_post';
  /** How long pairing waits on the provider before calling it unreachable. */
  oidcPairingTimeoutMs: number;
}

/** The shipped values of `AuthSettings`. */
export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  magicLinkTtlMinutes: 15,
  minSecretLength: 32,
  sessionStore: 'memory',
  secureLocalNet: false,
  magicLink: true,
  exposeMagicLink: false,
  oneTimeTokenTtlMinutes: 3,
  oidcName: 'SSO',
  // heautou's default, and the one the OIDC spec names as the default.
  oidcClientAuth: 'client_secret_basic',
  oidcPairingTimeoutMs: 10_000,
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

/** Folders and the names of what is filed in them. */
export interface FolderSettings {
  /** The longest folder name, in characters. Short enough to sit in a URL path later. */
  nameMaxLength: number;
}

/** The shipped values of `FolderSettings`. */
export const FOLDER_DEFAULTS: Readonly<FolderSettings> = Object.freeze({
  nameMaxLength: 64,
});

/** API keys, which MCP clients send instead of a session. */
export interface ApiKeySettings {
  /** Characters of a key kept after its prefix, so the settings page can tell keys apart. */
  shownCharacters: number;
  /** The longest name a key may be given, in characters. */
  nameMaxLength: number;
}

/** The shipped values of `ApiKeySettings`. */
export const API_KEY_DEFAULTS: Readonly<ApiKeySettings> = Object.freeze({
  shownCharacters: 8,
  nameMaxLength: 60,
});

/** The MCP door: what one tool call may hand an agent. */
export interface McpSettings {
  /** The largest JSON body `/mcp` accepts. Tool calls are small; this is only a ceiling. */
  bodyLimit: string;
  /** Documents `engrafo_search` returns when not told how many. */
  defaultSearchResults: number;
  /** Documents `engrafo_list` returns when not told how many. */
  defaultListDocuments: number;
  /** The most documents `engrafo_list` returns in one call. */
  maxListDocuments: number;
  /** The most characters of text `engrafo_read` returns in one call; the rest is a later call. */
  readMaxChars: number;
}

/** The shipped values of `McpSettings`. */
export const MCP_DEFAULTS: Readonly<McpSettings> = Object.freeze({
  bodyLimit: '1mb',
  defaultSearchResults: 8,
  defaultListDocuments: 100,
  maxListDocuments: 1000,
  readMaxChars: 20_000,
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
  /**
   * What ocrmypdf converts an unusual colour space to, so the PDF/A conversion does not refuse
   * the file with ColorConversionNeededError. Paperless-ngx's default.
   */
  colorConversionStrategy: 'RGB';
  /** How much of ocrmypdf's output is buffered before the run is abandoned, in bytes. */
  maxOutputBytes: number;
  /** How many lines from the end of stderr become the failure message. */
  errorTailLines: number;
  /**
   * The Python that turns a WebP or GIF into a PNG for ocrmypdf, with Pillow. Not a dependency of
   * its own: ocrmypdf is Python and needs Pillow, so wherever it runs this does too.
   */
  pngConverter: string;
  /** When turning an image into a PNG is given up on. It is one decode and one encode. */
  pngTimeoutMinutes: number;
}

/** The shipped values of `OcrSettings`. */
export const OCR_DEFAULTS: Readonly<OcrSettings> = Object.freeze({
  enabled: true,
  requestedByDefault: true,
  languages: 'eng',
  concurrency: 1,
  timeoutMinutes: 30,
  imageDpi: 300,
  colorConversionStrategy: 'RGB',
  // 16 MiB.
  maxOutputBytes: 16_777_216,
  errorTailLines: 5,
  pngConverter: 'python3',
  pngTimeoutMinutes: 5,
});

/** Reading the text layer a PDF already has, with pdftotext. */
export interface PdfTextSettings {
  /** When pdftotext is given up on. It reads a text layer and renders nothing, so this is generous. */
  timeoutMinutes: number;
  /** How much text is buffered before the run is abandoned, in bytes. */
  maxOutputBytes: number;
}

/** The shipped values of `PdfTextSettings`. */
export const PDF_TEXT_DEFAULTS: Readonly<PdfTextSettings> = Object.freeze({
  timeoutMinutes: 5,
  // 64 MiB.
  maxOutputBytes: 67_108_864,
});

/** Reading ebooks. */
export interface EbookSettings {
  /**
   * The most an EPUB's text files may unpack to, in bytes. A zip is small on the wire and can
   * be enormous inside it, and every chapter is held in memory while it is read.
   */
  maxUnpackedBytes: number;
}

/** The shipped values of `EbookSettings`. */
export const EBOOK_DEFAULTS: Readonly<EbookSettings> = Object.freeze({
  // 256 MiB.
  maxUnpackedBytes: 268_435_456,
});

/** The search index and the queries over it. The retrieval numbers are mcp-ragdown's, measured there. */
export interface SearchSettings {
  /** The longest passage embedded, in characters: about 400 tokens, inside the model's window. */
  chunkMaxChars: number;
  /** How many passages are embedded in one call. */
  embedBatchSize: number;
  /** How many passages each side (meaning, words) hands the fusion. */
  candidatePoolSize: number;
  /** Reciprocal rank fusion's constant: a hit at rank r scores 1 / (k + r). */
  rrfK: number;
  /**
   * The cosine under which a passage found only by meaning is dropped. Nearest neighbours always
   * exist, so without a floor a query about nothing returns the whole archive in some order.
   * granite-small's unrelated prompts topped out at 0.75 and on-topic questions sat above 0.86.
   */
  minCosine: number;
  /** How many documents a search returns when not told. */
  defaultResults: number;
  /** The most a search may ask for. */
  maxResults: number;
  /** The longest query accepted, in characters. */
  queryMaxChars: number;
  /** How much of the best passage a hit shows, in characters. */
  snippetChars: number;
  /** How much of a snippet comes before the first word that matched, as a fraction of it. */
  snippetLeadFraction: number;
}

/** The shipped values of `SearchSettings`. */
export const SEARCH_DEFAULTS: Readonly<SearchSettings> = Object.freeze({
  chunkMaxChars: 1500,
  embedBatchSize: 16,
  candidatePoolSize: 50,
  rrfK: 60,
  minCosine: 0.8,
  defaultResults: 20,
  maxResults: 50,
  queryMaxChars: 500,
  snippetChars: 240,
  snippetLeadFraction: 0.3,
});

/** The buckets and the URLs signed for them. */
export interface StorageSettings {
  /** S3 region. `S3_REGION` overrides it. */
  region: string;
  /** What `S3_BUCKET` gains to name the text bucket. `S3_TEXT_BUCKET` overrides the whole name. */
  textBucketSuffix: string;
  /** Address buckets as a path (`host/bucket`) rather than a subdomain. `S3_FORCE_PATH_STYLE` overrides it. */
  forcePathStyle: boolean;
  /** How long a presigned upload URL works. */
  uploadUrlTtlMinutes: number;
  /** How long a presigned download URL works. */
  downloadUrlTtlMinutes: number;
  /** The most keys one delete call names. S3's own limit is a thousand. */
  deleteBatchSize: number;
}

/** The shipped values of `StorageSettings`. */
export const STORAGE_DEFAULTS: Readonly<StorageSettings> = Object.freeze({
  region: 'us-east-1',
  textBucketSuffix: '-text',
  forcePathStyle: true,
  uploadUrlTtlMinutes: 15,
  downloadUrlTtlMinutes: 5,
  deleteBatchSize: 1000,
});
