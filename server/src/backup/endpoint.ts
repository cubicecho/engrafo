import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DB } from '@cubicecho/engrafo-db';
import type { Express } from 'express';
import { errorMessage } from '../core/errors.ts';
import { HttpStatus } from '../core/wire.ts';
import type { StorageSet } from '../storage/s3.ts';
import { planExport, streamExport } from './export.ts';
import type { ExportLinks } from './state.ts';

// `GET /export/<token>`: the one way an export leaves. A plain route rather than GraphQL because
// the browser has to stream it to disk itself, and a route the browser follows carries no bearer
// token, so the token in the path is the credential: minted by `createExportLink` for one user,
// spent on first use, dead after a few minutes. A token that is unknown, spent or expired is one
// 404, as every row that is not the caller's is.

/** Where export links point. */
export const EXPORT_PATH = '/export';

/** What the export route reads. */
export interface ExportEndpointDeps {
  db: DB;
  storage: StorageSet;
  links: ExportLinks;
}

/**
 * Mounts the export route. Before the static handler, whose SPA fallback would answer it.
 *
 * @param app - The Express app.
 * @param deps - The database, the buckets and the links minted by GraphQL.
 */
export function mountExport(app: Express, { db, storage, links }: ExportEndpointDeps): void {
  app.get(`${EXPORT_PATH}/:token`, async (req, res) => {
    const userId = links.redeem(req.params.token);
    if (userId === null) {
      res.status(HttpStatus.NotFound).type('text/plain').send('This export link has expired or was already used.');
      return;
    }
    const plan = await planExport({ db, storage }, userId, new Date());
    res.status(HttpStatus.Ok);
    res.set({
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="${plan.root}.tar"`,
      'Cache-Control': 'no-store',
    });
    try {
      await pipeline(Readable.from(streamExport(plan)), res);
    } catch (error) {
      // Headers are long gone, so the only way left to say it failed is to cut the download off:
      // the browser then reports it as failed rather than saving a tar that ends early.
      console.error(`[backup] export for ${userId} stopped: ${errorMessage(error)}`);
      res.destroy();
    }
  });
}
