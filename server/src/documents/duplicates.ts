import { type Document, documents } from '@cubicecho/engrafo-db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { DOCUMENT_DEFAULTS } from '../core/defaults.ts';
import { requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';

// Which of the caller's documents hold the same bytes as another of theirs. A warning, never a
// refusal: the same file filed twice is sometimes meant, and the pipeline processes both.
//
// A root query over a list of ids rather than a field on `Document`. drizzle-graphql reads only
// the columns a selection names, so a field resolver on a generated `Document` cannot count on
// having its id or checksum, and a field would also be one query per row in a list. Here the
// upload panel asks about every file it sent in one request, and the detail page about one.

const DUPLICATES_SDL = parse(`
  type DocumentDuplicates {
    "The document asked about."
    document: Document!
    """
    Whether its checksum is known yet. False until the pipeline's first step has read the stored
    file, and for good if that step failed, so \`duplicates\` is only an answer once this is true.
    """
    checked: Boolean!
    """
    The caller's other documents with the same SHA-256, oldest first. Never anyone else's.
    Relation fields such as \`folder\` are not loaded on these; use \`folderId\`.
    """
    duplicates: [Document!]!
  }

  extend type Query {
    "For each of the caller's documents among \`ids\`, the others of theirs with the same contents. Unknown ids are left out."
    documentDuplicates(ids: [UUID!]!): [DocumentDuplicates!]!
  }
`);

const argsSchema = z.object({
  ids: z
    .array(z.string())
    .max(
      DOCUMENT_DEFAULTS.duplicateLookupMaxIds,
      `Ask about at most ${DOCUMENT_DEFAULTS.duplicateLookupMaxIds} documents at once.`,
    ),
});

export interface DocumentDuplicates {
  document: Document;
  checked: boolean;
  duplicates: Document[];
}

/**
 * The caller's documents among `ids`, each with the caller's other documents of the same checksum.
 *
 * @param db - The database.
 * @param userId - The caller. Both reads are filtered by it, so nothing of another user's is
 * asked about or answered with: a match across users would tell one that the other has the file.
 * @param ids - The documents to ask about. Ids that are not the caller's, or not ids, are dropped.
 * @returns One entry per document found, in the order of `ids`.
 */
export async function findDuplicates(
  db: Context['db'],
  userId: string,
  ids: readonly string[],
): Promise<DocumentDuplicates[]> {
  const wanted = [...new Set(ids)].filter((id) => z.uuid().safeParse(id).success);
  if (wanted.length === 0) {
    return [];
  }
  const asked = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), inArray(documents.id, wanted)));

  const checksums = [...new Set(asked.map((doc) => doc.checksumSha256).filter((sum): sum is string => Boolean(sum)))];
  // Served by idx_documents_user_checksum.
  const matches =
    checksums.length === 0
      ? []
      : await db
          .select()
          .from(documents)
          .where(and(eq(documents.userId, userId), inArray(documents.checksumSha256, checksums)))
          .orderBy(asc(documents.createdAt), asc(documents.id));

  const byChecksum = new Map<string, Document[]>();
  for (const doc of matches) {
    if (doc.checksumSha256) {
      byChecksum.set(doc.checksumSha256, [...(byChecksum.get(doc.checksumSha256) ?? []), doc]);
    }
  }
  const byId = new Map(asked.map((doc) => [doc.id, doc]));
  return wanted.flatMap((id) => {
    const doc = byId.get(id);
    if (doc === undefined) {
      return [];
    }
    const same = doc.checksumSha256 ? (byChecksum.get(doc.checksumSha256) ?? []) : [];
    return [
      {
        document: doc,
        checked: doc.checksumSha256 !== null,
        duplicates: same.filter((other) => other.id !== doc.id),
      },
    ];
  });
}

/**
 * Adds `documentDuplicates` to the schema.
 *
 * @param schema - The schema, which must already have the generated `Document` type.
 * @returns The extended schema.
 */
export function applyDuplicatesExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, DUPLICATES_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();

  queries.documentDuplicates.resolve = async (_parent: unknown, args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const { ids } = parseOrThrow(argsSchema, args);
    return findDuplicates(context.db, userId, ids);
  };

  return extended;
}
