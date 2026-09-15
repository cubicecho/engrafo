import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config.ts';

/**
 * Everything the app asks of object storage. An interface rather than the S3
 * client itself so tests hand in a map, and so nothing outside this file knows
 * which SDK is behind it.
 */
export interface Storage {
  /** A URL the browser can PUT exactly this object to — the type and length are part of the signature. */
  presignPut(key: string, options: { contentType: string; contentLength: number }): Promise<string>;
  presignGet(key: string, options: { filename: string; contentType: string; download: boolean }): Promise<string>;
  /** The stored object's size and type, or null when nothing is at the key. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  getStream(key: string): Promise<Readable>;
  download(key: string, path: string): Promise<void>;
  put(key: string, body: string | Uint8Array, contentType: string): Promise<void>;
  putFile(key: string, path: string, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

/**
 * Two buckets, because they hold two different things. `files` is what the user
 * uploaded and what OCR produced; `text` is the plain text extracted from it.
 * Postgres keeps only the metadata — a key and a byte count — so a document's
 * row stays small enough to list a thousand of them without dragging megabytes
 * of text along.
 */
export interface StorageSet {
  files: Storage;
  text: Storage;
}

const PUT_EXPIRY_SECONDS = 15 * 60;
const GET_EXPIRY_SECONDS = 5 * 60;

function createClient(endpoint: string, config: S3Config): S3Client {
  return new S3Client({
    endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // MinIO and most self-hosted S3s serve buckets as a path, not a subdomain.
    forcePathStyle: true,
    // The SDK now adds CRC32 checksums to every PUT by default. A presigned URL
    // would carry that checksum of an empty body, and the browser's real upload
    // would then fail it; older MinIO releases also reject the headers outright.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Content-Disposition's filename, quoted safely and with a UTF-8 form for non-ASCII names. */
function contentDisposition(filename: string, download: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createS3Storage(config: S3Config): StorageSet {
  const client = createClient(config.endpoint, config);
  // Signing makes no request, so this client never has to reach its endpoint —
  // it only has to be the host the browser will.
  const signer = config.publicEndpoint === config.endpoint ? client : createClient(config.publicEndpoint, config);

  return {
    files: bucketStorage(client, signer, config.bucket),
    text: bucketStorage(client, signer, config.textBucket),
  };
}

/** One bucket's worth of `Storage`. The clients are shared; only the bucket differs. */
function bucketStorage(client: S3Client, signer: S3Client, Bucket: string): Storage {
  return {
    presignPut(key, { contentType, contentLength }) {
      return getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
        { expiresIn: PUT_EXPIRY_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
      );
    },

    presignGet(key, { filename, contentType, download }) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDisposition(filename, download),
        }),
        { expiresIn: GET_EXPIRY_SECONDS },
      );
    },

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
        throw error;
      }
    },

    async getStream(key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return result.Body as Readable;
    },

    async download(key, path) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      await pipeline(result.Body as Readable, createWriteStream(path));
    },

    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async putFile(key, path, contentType) {
      // Archives are at most a few times the original, which is capped by
      // MAX_UPLOAD_BYTES, so buffering is simpler than a multipart upload.
      const body = await readFile(path);
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async delete(keys) {
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
      );
    },
  };
}

export function originalKey(userId: string, documentId: string): string {
  return `originals/${userId}/${documentId}`;
}

export function archiveKey(userId: string, documentId: string): string {
  return `archive/${userId}/${documentId}.pdf`;
}

/** In the text bucket, not beside the file it came from. */
export function textKey(userId: string, documentId: string): string {
  return `text/${userId}/${documentId}.txt`;
}
