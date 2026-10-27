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
  /** Most documents one `documentDuplicates` call may ask about: an upload panel's worth. */
  duplicateLookupMaxIds: number;
}

/** The shipped values of `DocumentSettings`. */
export const DOCUMENT_DEFAULTS: Readonly<DocumentSettings> = Object.freeze({
  // 100 MiB.
  maxUploadBytes: 104_857_600,
  titleMaxLength: 500,
  filenameMaxLength: 1000,
  duplicateLookupMaxIds: 200,
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

/**
 * The vision step: an OpenAI-compatible vision model re-reading a PDF's or an image's pages. Where
 * the model is and which one it is are not here: the admin sets them in the app (vision/settings.ts).
 */
export interface VisionSettings {
  /**
   * How long one page may take, when the admin has not said. A page is a prefill of several
   * thousand image tokens: seconds on a GPU, minutes on a CPU build, and a timeout sized for chat
   * abandons the prefill just before it pays off.
   */
  requestTimeoutSeconds: number;
  /** The shortest per-page timeout the settings accept. */
  minRequestTimeoutSeconds: number;
  /** The longest per-page timeout the settings accept: an hour, past which a page is wedged. */
  maxRequestTimeoutSeconds: number;
  /**
   * Resolution pages are rasterised at. Not the 300 ocrmypdf hands Tesseract: a vision model is
   * billed and prefilled by pixel count, and 300 DPI on US Letter is 8.4 megapixels, which most
   * servers downscale back below this before the encoder sees it.
   */
  pageDpi: number;
  /**
   * The most a page's answer may run to. A dense page of prose or a long table is 1,000 to 2,600
   * tokens, so this leaves room over that and no more: a model that loops repeats itself all the
   * way to it, and at local speeds (~150 tokens/s) 8,192 was a minute a page and 35,000 nearly
   * four. The admin's "longest reply" replaces it when set.
   */
  pageMaxTokens: number;
  /** The shortest "longest reply" the admin may set, in tokens: below it a page of text cannot fit. */
  minPageMaxTokens: number;
  /**
   * The longest "longest reply" the admin may set, in tokens: a model's context, not advice. The
   * settings page suggests staying under 16,384, since a higher limit reads no dense page better
   * and only makes a loop slower.
   */
  maxPageMaxTokens: number;
  /**
   * The sampling temperature a page is read at, unless the admin sets one. Not 0: greedy decoding
   * on a reasoning model loops, repeating a line until the reply hits `pageMaxTokens`, and a little
   * randomness is what breaks the loop. The cost is that the same page may read slightly
   * differently twice.
   */
  temperature: number;
  /** The highest temperature the admin may set. OpenAI's ceiling; past it the output is noise. */
  maxTemperature: number;
  /**
   * Past this many pages the step declines rather than spending hours on one document. The
   * pipeline has no queue, so a 600-page scan at half a minute a page is the whole archive stalled
   * for an afternoon. It declines rather than truncating: half a document's text written over text
   * that was complete is worse than not running at all.
   */
  maxPages: number;
  /** When Ghostscript rasterising one document, or Pillow splitting a TIFF, is given up on as wedged. */
  rasterTimeoutMinutes: number;
  /** How long an endpoint has to answer the settings page's request for its models. */
  modelsTimeoutSeconds: number;
  /** The most models the settings page is offered from one listing. */
  maxModels: number;
}

/** The shipped values of `VisionSettings`. */
export const VISION_DEFAULTS: Readonly<VisionSettings> = Object.freeze({
  requestTimeoutSeconds: 600,
  minRequestTimeoutSeconds: 10,
  maxRequestTimeoutSeconds: 3600,
  pageDpi: 200,
  pageMaxTokens: 4096,
  minPageMaxTokens: 256,
  maxPageMaxTokens: 131_072,
  temperature: 0.6,
  maxTemperature: 2,
  maxPages: 200,
  rasterTimeoutMinutes: 10,
  modelsTimeoutSeconds: 5,
  maxModels: 500,
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

/** The thumbnail step: a small picture of a document's first page, for lists. */
export interface ThumbnailSettings {
  /** How wide a thumbnail is drawn, in pixels. Twice a list row's picture, for a sharp one on a dense screen. */
  widthPx: number;
  /**
   * The tallest a thumbnail may be, in pixels: a receipt roll or a long screenshot is cut to
   * this rather than drawn as a strip nobody can see in a row.
   */
  maxHeightPx: number;
  /** JPEG quality, 1-95 as Pillow and pdftoppm read it. */
  jpegQuality: number;
  /** When rendering one is given up on. One page, one decode, one encode. */
  timeoutMinutes: number;
  /**
   * The Python that resizes an image with Pillow. Not a dependency of its own: ocrmypdf is Python
   * and needs Pillow, so wherever OCR runs this does too.
   */
  resizer: string;
  /** The most an EPUB's cover image may unpack to, in bytes. */
  maxCoverBytes: number;
  /** How long a thumbnail's URL works. Longer than a download's, since a list is read for a while. */
  urlTtlMinutes: number;
  /** Most documents one `documentThumbnailUrls` call may ask about: a page of a list. */
  lookupMaxIds: number;
}

/** The shipped values of `ThumbnailSettings`. */
export const THUMBNAIL_DEFAULTS: Readonly<ThumbnailSettings> = Object.freeze({
  widthPx: 320,
  maxHeightPx: 640,
  jpegQuality: 80,
  timeoutMinutes: 2,
  resizer: 'python3',
  // 32 MiB.
  maxCoverBytes: 33_554_432,
  urlTtlMinutes: 60,
  lookupMaxIds: 200,
});

/** Saved searches, listed in the sidebar. */
export interface SavedSearchSettings {
  /** The longest name, in characters: it has to fit a sidebar row. */
  nameMaxLength: number;
}

/** The shipped values of `SavedSearchSettings`. */
export const SAVED_SEARCH_DEFAULTS: Readonly<SavedSearchSettings> = Object.freeze({
  nameMaxLength: 64,
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

/** How a text upload that is not UTF-8 is read. */
export interface TextSettings {
  /**
   * How many bytes from the start of a file the encoding is guessed from. The guess is
   * statistical and costs time in proportion; a file's first 64 KiB says as much as all of it.
   */
  encodingSampleBytes: number;
  /** The encoding taken when nothing else says: what Windows writes for Western languages. */
  fallbackEncoding: string;
}

/** The shipped values of `TextSettings`. */
export const TEXT_DEFAULTS: Readonly<TextSettings> = Object.freeze({
  encodingSampleBytes: 65_536,
  fallbackEncoding: 'windows-1252',
});

/** How a numeric date with nothing to tell its parts apart is read: `03/04/2025`. */
export type DateOrder = 'DMY' | 'MDY' | 'YMD';

/** The fields read from a document's text: its date, and a receipt's vendor, total and currency. */
export interface MetadataSettings {
  /**
   * How an ambiguous numeric date is read. `DATE_ORDER` overrides it. Day first is Paperless's
   * default and most of the world's; a US archive wants `MDY`.
   */
  dateOrder: DateOrder;
  /** A date before this year is not taken for the document's: a birth date, a founding year. */
  oldestYear: number;
  /**
   * How far past today a date may be and still be the document's, in days. One, for a receipt
   * printed in a zone ahead of the server's; a due date further out is not the document's date.
   */
  futureToleranceDays: number;
  /** How much of the text is read for a date, in characters. The date on a document is near its top. */
  dateScanChars: number;
  /** How much of the text is read for a receipt's fields, in characters. A receipt is short. */
  receiptScanChars: number;
  /** The longest vendor kept, in characters. A longer first line is a sentence, not a shop's name. */
  vendorMaxLength: number;
  /** How many of the first lines are looked at for a vendor's name. */
  vendorScanLines: number;
}

/** The shipped values of `MetadataSettings`. */
export const METADATA_DEFAULTS: Readonly<MetadataSettings> = Object.freeze({
  dateOrder: 'DMY',
  oldestYear: 1900,
  futureToleranceDays: 1,
  dateScanChars: 20_000,
  receiptScanChars: 20_000,
  vendorMaxLength: 80,
  vendorScanLines: 5,
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
  /** How many documents a filtered list with no search returns at a time when not told. */
  browsePageSize: number;
  /** The most a filtered list may ask for at a time. */
  browseMaxPageSize: number;
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
  browsePageSize: 50,
  browseMaxPageSize: 200,
});

/** The watched folder: a directory, such as a scanner's share, that files whatever lands in it. */
export interface WatchSettings {
  /** How often the directory is listed. `WATCH_POLL_SECONDS` overrides it. */
  pollSeconds: number;
  /**
   * How long a file's size and modification time must stay the same before it counts as written.
   * Scanners and SMB copies write slowly. `WATCH_STABLE_SECONDS` overrides it.
   */
  stableSeconds: number;
}

/** The shipped values of `WatchSettings`. */
export const WATCH_DEFAULTS: Readonly<WatchSettings> = Object.freeze({
  pollSeconds: 5,
  stableSeconds: 10,
});

/** The trash: where a deleted document waits, restorable, until it is purged. */
export interface TrashSettings {
  /** How long a document stays in the trash before it is deleted for good. `TRASH_RETENTION_DAYS` overrides it. */
  retentionDays: number;
  /** How often the trash is checked for documents past their time. Also once at boot. */
  purgeIntervalMinutes: number;
}

/** The shipped values of `TrashSettings`. */
export const TRASH_DEFAULTS: Readonly<TrashSettings> = Object.freeze({
  retentionDays: 30,
  purgeIntervalMinutes: 60,
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

/** Export and import: the whole archive as one tar, out and back in. */
export interface BackupSettings {
  /** How long a minted export link works. Long enough to click, short enough not to leak usefully. */
  exportLinkTtlMinutes: number;
  /**
   * The largest archive an import accepts, in bytes. `MAX_IMPORT_BYTES` overrides it. The archive
   * is PUT to the bucket in one request, and S3 takes at most 5 GiB that way.
   */
  maxImportBytes: number;
  /** The largest `metadata.json` read, in bytes: it is held in memory and parsed whole. */
  metadataMaxBytes: number;
  /** How long a finished import's summary stays to be read, in minutes. Only the latest is ever shown. */
  importRetentionMinutes: number;
}

/** The shipped values of `BackupSettings`. */
export const BACKUP_DEFAULTS: Readonly<BackupSettings> = Object.freeze({
  exportLinkTtlMinutes: 5,
  // 5 GiB.
  maxImportBytes: 5_368_709_120,
  // 64 MiB.
  metadataMaxBytes: 67_108_864,
  importRetentionMinutes: 1440,
});
