import { DocumentStatus, documents, FieldSource, type Folder, folders } from '@cubicecho/engrafo-db/schema';
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { METADATA_DEFAULTS } from '../core/defaults.ts';
import { badInput, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { loadOwned } from '../documents/resolvers.ts';
import { folderAndDescendants } from '../folders/names.ts';
import { notTrashed } from '../trash/trash.ts';
import { csvCell, csvText } from './csv.ts';
import { calendarDaySchema } from './schemas.ts';

// The fields read from a document's content, as the user corrects them, and the receipts export.
// Each write marks its field `user`, which is what keeps the pipeline's metadata step off it on
// every later run.

const METADATA_SDL = parse(`
  input DocumentReceiptInput {
    "Who it is from. Empty or null leaves it blank."
    vendor: String
    "What was paid, as an exact decimal such as \`12.50\`. A comma is read as the decimal point too."
    total: String
    "ISO 4217, such as \`EUR\`, in any case."
    currency: String
  }

  extend type Query {
    """
    The caller's receipts as CSV, one per line: \`date,vendor,total,currency,title,folder\`, with a
    header. A receipt is a document with a vendor or a total. \`from\` and \`to\` (\`YYYY-MM-DD\`,
    inclusive) keep only receipts dated in that range; \`folderId\` keeps only those filed in that
    folder or any folder inside it.
    """
    receiptsCsv(from: String, to: String, folderId: UUID): String!
  }

  extend type Mutation {
    """
    Sets the date on the document (\`YYYY-MM-DD\`), or clears it with null. Either way the date is
    then the caller's: processing the document again does not read one from its text.
    """
    setDocumentDate(id: UUID!, date: String): Document!
    """
    Sets the document's receipt fields, all three at once; a field left empty is cleared. They are
    then the caller's: processing the document again does not read them from its text.
    """
    setDocumentReceipt(id: UUID!, input: DocumentReceiptInput!): Document!
  }
`);

/** The columns of the export, in order. */
export const RECEIPTS_CSV_HEADER = ['date', 'vendor', 'total', 'currency', 'title', 'folder'] as const;

const setDateSchema = z.object({ date: calendarDaySchema.nullish() });

/** Empty and absent are the same answer from a form: nothing. */
const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

// A total is never negative (a refund is its own document) and is kept as written, to the
// cent or the fils: up to twelve digits before the point and three after.
const TOTAL_PATTERN = /^\d{1,12}(?:[.,]\d{1,3})?$/;

const receiptSchema = z.object({
  vendor: z.preprocess(
    blankToNull,
    z.string().trim().max(METADATA_DEFAULTS.vendorMaxLength, 'That vendor name is too long.').nullish(),
  ),
  total: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(TOTAL_PATTERN, 'A total is an amount such as 12.50.')
      .transform((total) => total.replace(',', '.'))
      .nullish(),
  ),
  currency: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'A currency is a three-letter code such as EUR.')
      .transform((code) => code.toUpperCase())
      .nullish(),
  ),
});

const exportSchema = z
  .object({
    from: z.preprocess(blankToNull, calendarDaySchema.nullish()),
    to: z.preprocess(blankToNull, calendarDaySchema.nullish()),
    folderId: z.string().nullish(),
  })
  .refine(({ from, to }) => (from && to ? from <= to : true), 'The range ends before it starts.');

/** Each folder's path from the top, `Taxes/2026`, for the export's folder column. */
function folderPaths(all: readonly Folder[]): Map<string, string> {
  const byId = new Map(all.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  for (const folder of all) {
    const names: string[] = [];
    const seen = new Set<string>();
    // Up to the top. `seen` guards a loop the server never makes.
    for (let at: Folder | undefined = folder; at && seen.has(at.id) === false; ) {
      seen.add(at.id);
      names.unshift(at.name);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    paths.set(folder.id, names.join('/'));
  }
  return paths;
}

/**
 * Adds the document-date and receipt writes, and the receipts export, to the schema.
 *
 * @param schema - The schema, which must already have the generated `Document` type.
 * @returns The extended schema.
 *
 * @remarks
 * Hand-written resolvers do not inherit `scope`: every one here reads through `loadOwned` or
 * filters by `requireAuth` itself.
 */
export function applyMetadataExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, METADATA_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  mutations.setDocumentDate.resolve = async (
    _parent: unknown,
    args: { id: string; date?: string | null },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    const { date } = parseOrThrow(setDateSchema, { date: args.date });
    const [updated] = await context.db
      .update(documents)
      .set({ documentDate: date ?? null, documentDateSource: FieldSource.User })
      .where(eq(documents.id, doc.id))
      .returning();
    return updated;
  };

  mutations.setDocumentReceipt.resolve = async (
    _parent: unknown,
    args: { id: string; input: unknown },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    const input = parseOrThrow(receiptSchema, args.input);
    const [updated] = await context.db
      .update(documents)
      .set({
        vendor: input.vendor ?? null,
        total: input.total ?? null,
        currency: input.currency ?? null,
        receiptSource: FieldSource.User,
      })
      .where(eq(documents.id, doc.id))
      .returning();
    return updated;
  };

  queries.receiptsCsv.resolve = async (_parent: unknown, args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const { from, to, folderId } = parseOrThrow(exportSchema, args);
    if (folderId && z.uuid().safeParse(folderId).success === false) {
      throw badInput('That is not a folder id.');
    }
    // Someone else's folder, or none, has no descendants of the caller's and matches nothing,
    // which is the same answer an empty folder of their own gives.
    const inFolder = folderId
      ? inArray(documents.folderId, await folderAndDescendants(context.db, userId, folderId))
      : undefined;

    const rows = await context.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          ne(documents.status, DocumentStatus.PendingUpload),
          notTrashed(),
          or(isNotNull(documents.vendor), isNotNull(documents.total)),
          from ? gte(documents.documentDate, from) : undefined,
          to ? lte(documents.documentDate, to) : undefined,
          inFolder,
        ),
      )
      .orderBy(sql`${documents.documentDate} asc nulls last`, asc(documents.title));
    const paths = folderPaths(await context.db.select().from(folders).where(eq(folders.userId, userId)));

    return csvText(
      RECEIPTS_CSV_HEADER,
      rows.map((doc) => [
        csvCell(doc.documentDate),
        csvCell(doc.vendor),
        csvCell(doc.total, { isNumber: true }),
        csvCell(doc.currency),
        csvCell(doc.title),
        csvCell(doc.folderId ? paths.get(doc.folderId) : null),
      ]),
    );
  };

  return extended;
}
