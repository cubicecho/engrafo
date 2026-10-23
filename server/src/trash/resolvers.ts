import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { trashConfig } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { requireAuth } from '../core/errors.ts';
import { purgeTrash, restoreDocument, trashCount, trashedDocuments, trashedNotFound } from './trash.ts';

// The trash's reads and writes. `deleteDocument` and `deleteFolder` are what put a document here;
// these take it back out, one way or the other. The generated reads never see a trashed row
// (tenancy.ts), so the list is a root query of its own and states ownership itself.

const TRASH_SDL = parse(`
  type Trash {
    "The documents in the trash, the most recently deleted first. Their relation fields are not loaded."
    documents: [Document!]!
    "How many documents are in the trash."
    count: Int!
    "How many days a document stays in the trash before it is deleted for good."
    retentionDays: Int!
  }

  extend type Query {
    trash: Trash!
  }

  extend type Mutation {
    """
    Takes a document out of the trash, into the folder it was in, or the top level when that folder
    is gone. Its title is numbered when something there has taken it since.
    """
    restoreDocument(id: UUID!): Document!
    "Deletes a document in the trash for good, with its stored files."
    purgeDocument(id: UUID!): Boolean!
    "Deletes everything in the trash for good. Returns how many documents went."
    emptyTrash: Int!
  }
`);

/** The parent the `Trash` fields resolve from: only who is asking, so each field reads what it needs. */
interface TrashParent {
  userId: string;
}

/**
 * Adds the trash to the schema.
 *
 * @param schema - The generated schema, which must already have a Mutation type.
 * @returns The extended schema.
 */
export function applyTrashExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, TRASH_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();
  const trash = assertObjectType(extended.getType('Trash')).getFields();

  queries.trash.resolve = (_parent: unknown, _args: unknown, context: Context): TrashParent => ({
    userId: requireAuth(context),
  });
  trash.documents.resolve = (parent: TrashParent, _args: unknown, context: Context) =>
    trashedDocuments(context.db, parent.userId);
  // The sidebar polls this for its badge, so it does not drag every row along.
  trash.count.resolve = (parent: TrashParent, _args: unknown, context: Context) =>
    trashCount(context.db, parent.userId);
  trash.retentionDays.resolve = () => trashConfig().retentionDays;

  mutations.restoreDocument.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    if (z.uuid().safeParse(args.id).success === false) {
      throw trashedNotFound();
    }
    return restoreDocument(context, userId, args.id);
  };

  mutations.purgeDocument.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    if (z.uuid().safeParse(args.id).success === false) {
      throw trashedNotFound();
    }
    const purged = await purgeTrash(context, { userId, id: args.id });
    if (purged === 0) {
      throw trashedNotFound();
    }
    return true;
  };

  mutations.emptyTrash.resolve = (_parent: unknown, _args: unknown, context: Context) =>
    purgeTrash(context, { userId: requireAuth(context) });

  return extended;
}
