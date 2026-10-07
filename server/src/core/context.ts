import type { DB } from '@cubicecho/engrafo-db';
import type { Auth } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';

/** `Context.ip` when Express gave no address, as when a test runs an operation in-process. */
export const UNKNOWN_IP = 'unknown';

/**
 * What every resolver — generated or hand-written — is handed. `userId` is the
 * only thing that says who the caller is: it comes from the request's session
 * and nothing downstream may take it from an argument.
 */
export interface Context {
  db: DB;
  /** better-auth instance; the auth resolvers call `ctx.auth.api.*`. */
  auth: Auth;
  /** Sign-in throttle; the auth mutations call it. */
  limiter: RateLimiter;
  /** Client address, for rate-limit keys. Never an identity. */
  ip: string;
  /** Signed-in user, or null. Resolvers call requireAuth(ctx) rather than reading this. */
  userId: string | null;
  /** Request headers; sign-out needs them to find the session. */
  headers: Headers;
  storage: StorageSet;
  /** How a mutation tells the pipeline there is work, without waiting for it. */
  events: PipelineEvents;
  /** Whether the ocr step can run on this instance: allowed by config and ocrmypdf found at boot. */
  ocrAvailable: boolean;
}
