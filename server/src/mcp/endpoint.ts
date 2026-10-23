import type { DB } from '@cubicecho/engrafo-db';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express, type Request, type Response } from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import { API_KEY_PREFIX } from '../auth/better-auth.ts';
import { MCP_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { HttpStatus } from '../core/wire.ts';
import type { Embedder } from '../search/embedder.ts';
import type { StorageSet } from '../storage/s3.ts';
import { createMcpServer } from './tools.ts';

// `/mcp`: Streamable HTTP, stateless, one server per request, as mcp-ragdown serves it. An MCP
// client authenticates with one of the user's API keys, never a session: a session expires and
// lives in memory by default, and a key can be revoked on its own. SECURE_LOCAL_NET does not
// waive the key, because the key is what says whose archive this is.

/** Where agents connect. */
export const MCP_PATH = '/mcp';

/** What the MCP endpoint reads requests against. */
export interface McpEndpointDeps {
  db: DB;
  authHost: AuthHost;
  storage: StorageSet;
  embedder: Embedder;
}

/** JSON-RPC's code for a request the server will not serve; the SDK uses it for its own refusals. */
const JSON_RPC_SERVER_ERROR = -32_000;

const UNAUTHORIZED_MESSAGE = `Send one of your Engrafo API keys (Settings → MCP) as "Authorization: Bearer ${API_KEY_PREFIX}…" or "x-api-key".`;

/**
 * The key a request carries, from `x-api-key` or `Authorization: Bearer`.
 *
 * @param req - The request.
 * @returns The key, or undefined when it carries none that looks like one.
 */
function keyOf(req: Request): string | undefined {
  const header = req.get('x-api-key') ?? req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const key = header?.trim();
  // A session token here is a mistake, not a credential: say so without asking better-auth.
  return key?.startsWith(API_KEY_PREFIX) ? key : undefined;
}

/**
 * Who a key belongs to.
 *
 * @param authHost - The current auth instance, which checks the key and records its use.
 * @param key - The key as sent.
 * @returns The owner's id, or null for a key that is unknown, revoked or expired.
 */
async function ownerOf(authHost: AuthHost, key: string): Promise<string | null> {
  const { valid, key: verified } = await authHost.current().api.verifyApiKey({ body: { key } });
  return valid && verified ? verified.referenceId : null;
}

function refuse(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code: JSON_RPC_SERVER_ERROR, message }, id: null });
}

/**
 * Mounts `/mcp` on the app. Before the static handler, whose SPA fallback would answer it.
 *
 * @param app - The Express app.
 * @param deps - The database, the auth host, the buckets and the embedder.
 */
export function mountMcp(app: Express, { db, authHost, storage, embedder }: McpEndpointDeps): void {
  // `all`, not `post`: clients also send GET (for a stream) and DELETE (to end a session), and
  // the transport answers both itself rather than Express's HTML 404.
  app.all(MCP_PATH, express.json({ limit: MCP_DEFAULTS.bodyLimit }), async (req, res) => {
    const key = keyOf(req);
    const userId = key === undefined ? null : await ownerOf(authHost, key);
    if (userId === null) {
      refuse(res, HttpStatus.Unauthorized, UNAUTHORIZED_MESSAGE);
      return;
    }
    const server = createMcpServer({ db, storage, embedder, userId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[mcp] ${req.method} ${MCP_PATH}: ${errorMessage(error)}`);
      if (res.headersSent === false) {
        refuse(res, HttpStatus.InternalServerError, 'The server failed to answer.');
      }
    }
  });
}
