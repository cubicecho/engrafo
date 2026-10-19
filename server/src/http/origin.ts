import type { Request } from 'express';
import { configuredAppUrl } from '../core/config.ts';

/**
 * Names the origin a request should be answered with.
 *
 * @param req - The Express request.
 * @returns `APP_URL` when it is set, otherwise the scheme and host the browser used.
 *
 * @remarks
 * Express reads X-Forwarded-Proto and X-Forwarded-Host only from a hop `trust proxy` allows,
 * so behind an untrusted hop this is the address the server itself was reached at.
 */
export function publicOrigin(req: Request): string {
  return configuredAppUrl() ?? `${req.protocol}://${req.host}`;
}
