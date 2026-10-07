import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus, SECONDS_PER_DAY } from '../core/wire.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Where Vite puts its hashed bundles, whose names change whenever their bytes do. */
const ASSETS_PREFIX = '/assets/';
const IMMUTABLE = `public, max-age=${HTTP_DEFAULTS.assetCacheDays * SECONDS_PER_DAY}, immutable`;
const REVALIDATE = 'no-cache';

/**
 * Serves the built web client next to /graphql, so one container is the whole
 * deployment and a magic link needs no second origin. Unknown paths fall back to
 * index.html — the SPA owns routing, including /auth/verify?token=… . Vite's
 * hashed bundles under /assets get immutable caching; everything else revalidates.
 */
export function createStaticHandler(root: string) {
  const rootDir = resolve(root);
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(HttpStatus.MethodNotAllowed, { allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://host').pathname);
    } catch {
      res.writeHead(HttpStatus.BadRequest).end();
      return;
    }
    let filePath = resolve(join(rootDir, normalize(pathname)));
    // normalize() alone does not stop "..%2f" walking out of the root once the
    // path has been decoded — compare the resolved path instead.
    const isOutsideRoot = filePath !== rootDir && filePath.startsWith(rootDir + sep) === false;
    if (isOutsideRoot) {
      res.writeHead(HttpStatus.Forbidden).end();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(rootDir, 'index.html');
      if (!existsSync(filePath)) {
        res.writeHead(HttpStatus.NotFound).end();
        return;
      }
    }
    res.writeHead(HttpStatus.Ok, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': pathname.startsWith(ASSETS_PREFIX) ? IMMUTABLE : REVALIDATE,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  };
}
