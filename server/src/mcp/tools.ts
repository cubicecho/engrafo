import { text } from 'node:stream/consumers';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus } from '@cubicecho/engrafo-db/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { version } from '../core/config.ts';
import { MCP_DEFAULTS, SEARCH_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { BYTES_PER_KIBIBYTE } from '../core/wire.ts';
import type { Embedder } from '../search/embedder.ts';
import { searchDocuments } from '../search/search.ts';
import type { StorageSet } from '../storage/s3.ts';
import { documentAt, loadMcpAccess, type McpAccess, sharedDocuments } from './access.ts';

// The MCP surface: four read-only tools over the folders the user shared, named `engrafo_*`
// after mcp-ragdown's `ragdown_*`. Every one reads `loadMcpAccess` afresh, so turning a
// folder off takes effect on the next call, not the next connection. Writes (upload, move,
// rename) are the app's alone for now.

/** The name the MCP server gives for itself. */
export const MCP_SERVER_NAME = 'engrafo';

/** RRF scores are small fractions; four places keep neighbours apart. */
const SCORE_DECIMALS = 4;
/** `YYYY-MM-DD`, the date part of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** What a tool says when the path it was given is not in a shared folder, whatever the reason. */
const NO_SUCH_DOCUMENT = 'No document at that path in a shared folder. engrafo_list names the ones there are.';
const NO_SUCH_FOLDER = 'No shared folder at that path. engrafo_folders names the ones there are.';
const NOTHING_SHARED =
  'No folders are shared. The user turns MCP access on for a folder in Engrafo, from its menu in the documents tree.';

/** What the tools are handed: the archive and whose it is. */
export interface McpDeps {
  db: DB;
  storage: StorageSet;
  embedder: Embedder;
  /** The API key's owner. Nothing an agent sends can change it. */
  userId: string;
}

/** The folder argument of the tools that can be narrowed to one. */
const onlyFolder = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Only this folder and the folders inside it, by its path in engrafo_folders. Left out: every shared folder',
  );

/**
 * Builds the MCP server for one request. Stateless: everything lives in Postgres and the buckets,
 * so a server per request costs only the tool list.
 *
 * @param deps - The database, the buckets, the embedder and the caller.
 * @returns The server, with its tools registered.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const { db, storage, embedder, userId } = deps;
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: version() },
    {
      instructions:
        "Read the user's document archive: scanned and uploaded files (PDFs, images, office documents) with the text extracted from them, filed in folders. Only the folders the user chose to share are here. Call engrafo_search before answering a question the documents might cover, then engrafo_read to read a document before relying on it. A document is named by its path, `<folder path>/<title>`.",
    },
  );

  /** The folders a call covers: one shared folder and those inside it, or every shared folder. */
  const scopeOf = (access: McpAccess, folder: string | undefined): string[] => {
    if (folder === undefined) {
      return access.ids;
    }
    const found = access.folderAt(folder);
    if (found === undefined) {
      throw new Error(NO_SUCH_FOLDER);
    }
    return access.within(found);
  };

  server.registerTool(
    'engrafo_folders',
    {
      title: 'List shared folders',
      description:
        'The folders the user has shared, one line each: its path, which is the folder argument of the other tools, and how many documents it holds directly. Sharing a folder shares every folder inside it.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const access = await loadMcpAccess(db, userId);
        if (access.folders.length === 0) {
          return NOTHING_SHARED;
        }
        const filed = await sharedDocuments(db, userId, access.ids);
        const counts = new Map<string, number>();
        for (const document of filed) {
          counts.set(document.folderId ?? '', (counts.get(document.folderId ?? '') ?? 0) + 1);
        }
        return access.folders
          .map(({ folder, path }) => `${path} (${plural(counts.get(folder.id) ?? 0, 'document')})`)
          .join('\n');
      }),
  );

  server.registerTool(
    'engrafo_search',
    {
      title: 'Search documents',
      description:
        'Hybrid (meaning + exact words) search over the text of the documents in shared folders, best match first. Each hit is a document path, the part of its text that matched, and a score whose order is all that means anything. Words can be quoted for a phrase, joined with `or`, or excluded with `-word`. Follow up with engrafo_read for the whole text.',
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(SEARCH_DEFAULTS.queryMaxChars)
          .describe('What to look for, as a question or keywords'),
        folder: onlyFolder,
        top_k: z.number().int().min(1).max(SEARCH_DEFAULTS.maxResults).default(MCP_DEFAULTS.defaultSearchResults),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const access = await loadMcpAccess(db, userId);
        if (access.folders.length === 0) {
          return NOTHING_SHARED;
        }
        const folderIds = scopeOf(access, args.folder);
        const hits = await searchDocuments({ db, embedder }, userId, args.query, args.top_k, { folderIds });
        if (hits.length === 0) {
          return 'No matches.';
        }
        return hits
          .map((hit, index) => {
            const head = `${index + 1}. ${access.pathOf(hit.document)} (score ${hit.score.toFixed(SCORE_DECIMALS)})`;
            return hit.snippet ? `${head}\n   ${hit.snippet.replace(/\s+/g, ' ')}` : head;
          })
          .join('\n');
      }),
  );

  server.registerTool(
    'engrafo_list',
    {
      title: 'List documents',
      description:
        'Browse the documents in shared folders rather than search them: one line each with its path, file type, size, when it was added, and its status. Only a `ready` document has all of its text; one still `processing` has none yet.',
      inputSchema: {
        folder: onlyFolder,
        limit: z.number().int().min(1).max(MCP_DEFAULTS.maxListDocuments).default(MCP_DEFAULTS.defaultListDocuments),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const access = await loadMcpAccess(db, userId);
        if (access.folders.length === 0) {
          return NOTHING_SHARED;
        }
        const filed = await sharedDocuments(db, userId, scopeOf(access, args.folder));
        if (filed.length === 0) {
          return 'No documents.';
        }
        const lines = filed
          .map((document) => ({ document, path: access.pathOf(document) ?? document.title }))
          .sort((a, b) => a.path.localeCompare(b.path))
          .slice(0, args.limit)
          .map(({ document, path }) => `${path} — ${describe(document)}`);
        const more =
          filed.length > args.limit ? `\n…and ${filed.length - args.limit} more. Pass a larger limit or a folder.` : '';
        return `${lines.join('\n')}${more}`;
      }),
  );

  server.registerTool(
    'engrafo_read',
    {
      title: 'Read a document',
      description: `The text extracted from a document (its own text layer, or what OCR recognised), from offset onward, at most ${MCP_DEFAULTS.readMaxChars} characters a call. The first line says which characters these are of how many; when there are more, call again with the offset it gives.`,
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('The document, as `<folder path>/<title>`, as engrafo_search and engrafo_list name it'),
        offset: z.number().int().min(0).default(0).describe('The first character to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const access = await loadMcpAccess(db, userId);
        const document = await documentAt(db, userId, access, args.path);
        if (document === undefined) {
          throw new Error(NO_SUCH_DOCUMENT);
        }
        const path = access.pathOf(document) ?? document.title;
        if (document.contentKey === null) {
          return document.status === DocumentStatus.Ready
            ? `${path} has no text: none was found in it.`
            : `${path} has no text yet: it is ${document.status}.`;
        }
        const content = await text(await storage.text.getStream(document.contentKey));
        const start = Math.min(args.offset, content.length);
        const end = Math.min(content.length, start + MCP_DEFAULTS.readMaxChars);
        const more = end < content.length ? ` Call again with offset ${end} for the rest.` : '';
        return `${path}: characters ${start}-${end} of ${content.length}.${more}\n${content.slice(start, end)}`;
      }),
  );

  return server;
}

/** "3 documents", "1 document". */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A document's line in engrafo_list, after its path. */
function describe(document: Document): string {
  const kilobytes = Math.max(1, Math.round(document.sizeBytes / BYTES_PER_KIBIBYTE));
  return `${document.mimeType}, ${kilobytes} KB, added ${document.createdAt.toISOString().slice(0, ISO_DATE_LENGTH)}, ${document.status}`;
}

/** A tool failure is a result the model can read, never a transport error. */
async function run(body: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: await body() }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: errorMessage(error) }] };
  }
}
