import { DocumentStatus, documents, FieldSource, folders } from '@cubicecho/engrafo-db/schema';
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { dateOrder } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { METADATA_DEFAULTS } from '../core/defaults.ts';
import { badInput, conflict, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { loadOwned } from '../documents/resolvers.ts';
import { folderAndDescendants, folderPaths } from '../folders/names.ts';
import { readMetadata } from '../pipeline/steps/metadata.ts';
import { notTrashed } from '../trash/trash.ts';
import { csvCell, csvText } from './csv.ts';
import { calendarDaySchema } from './schemas.ts';

// The fields read from a document's content, as the user corrects them, and the receipts export.
// Each write marks its field `user`, which is what keeps the pipeline's metadata step off it on
// every later run; `resetDocumentMetadata` is the way back.

const METADATA_SDL = parse(`
  "A field read from a document's content that the user can take over, and hand back."
  enum DocumentMetadataField {
    "The date printed on the document."
    DATE
    "The vendor, total and currency, which are one field: an edit to any of them is to all three."
    RECEIPT
  }

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
    """
    Hands the fields named back to the pipeline: each is read again from the document's stored
    text, now, and processing the document again reads it too. A field not named is left as it
    is. Only a document that is ready or failed; one being processed answers CONFLICT.
    """
    resetDocumentMetadata(id: UUID!, fields: [DocumentMetadataField!]!): Document!
  }
`);

/** What `resetDocumentMetadata` takes, as the SDL's enum values. */
export const DocumentMetadataField = { Date: 'DATE', Receipt: 'RECEIPT' } as const;
export type DocumentMetadataField = (typeof DocumentMetadataField)[keyof typeof DocumentMetadataField];

/** Why a reset waits: the run in progress reads the fields itself when it gets there. */
const BEING_PROCESSED = 'This document is being processed. Its fields will be read when it finishes.';

/** The columns of the export, in order. */
export const RECEIPTS_CSV_HEADER = ['date', 'vendor', 'total', 'currency', 'title', 'folder'] as const;

const setDateSchema = z.object({ date: calendarDaySchema.nullish() });

/** Empty and absent are the same answer from a form: nothing. */
const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

// A total is never negative (a refund is its own document) and is kept as written, to the
// cent or the fils: up to twelve digits before the point and three after.
const TOTAL_PATTERN = /^\d{1,12}(?:[.,]\d{1,3})?$/;

/** A receipt as a client or a backup gives it: each field checked, a blank one null. */
export const receiptSchema = z.object({
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

  mutations.resetDocumentMetadata.resolve = async (
    _parent: unknown,
    args: { id: string; fields: readonly DocumentMetadataField[] },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    if (args.fields.length === 0) {
      throw badInput('Name at least one field to reset.');
    }
    if (doc.status === DocumentStatus.PendingUpload) {
      throw badInput('The upload has not finished yet.');
    }
    const isSettled = doc.status === DocumentStatus.Ready || doc.status === DocumentStatus.Failed;
    if (isSettled === false) {
      throw conflict(BEING_PROCESSED);
    }

    // The same rule the pipeline runs, on a copy of the row: a field being reset loses its
    // source, so `metadataPatch` reads it again, and one that is not is marked the user's, so the
    // patch leaves it out exactly as it leaves out an edit. An extracted field not named stays as
    // it was rather than being read again behind the caller's back.
    const resets = new Set(args.fields);
    const handedBack = {
      ...doc,
      documentDateSource: resets.has(DocumentMetadataField.Date) ? null : FieldSource.User,
      receiptSource: resets.has(DocumentMetadataField.Receipt) ? null : FieldSource.User,
    };
    const patch = await readMetadata(handedBack, context.storage, { dateOrder: dateOrder() });

    // Conditional on the status it was read with: a reprocess claimed since then will read the
    // fields itself, and its metadata step must not race this write.
    const [updated] = await context.db
      .update(documents)
      .set(patch)
      .where(and(eq(documents.id, doc.id), inArray(documents.status, [DocumentStatus.Ready, DocumentStatus.Failed])))
      .returning();
    if (!updated) {
      throw conflict(BEING_PROCESSED);
    }
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
