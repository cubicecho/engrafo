import { documents, folders } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import type { Context } from '../core/context.ts';
import { badInput, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { deleteStoredFiles } from '../documents/resolvers.ts';
import {
  assertNameFree,
  folderAndDescendants,
  folderNameSchema,
  loadOwnedFolder,
  lockNames,
  ownedParent,
} from './names.ts';

// Every write to a folder. Reads — `folders`, `folder`, and the `documents` and
// `folder` relations — are generated and scoped in tenancy.ts. A folder is
// addressed by name the way a file is, so every write that names one checks the
// name is free beside it, under the caller's name lock (see names.ts).

const FOLDERS_SDL = parse(`
  extend type Mutation {
    "Makes a folder inside \`parentId\`, or at the top level when it is left out."
    createFolder(name: String!, parentId: UUID): Folder!
    "Renames a folder. Refused when something beside it already has the name."
    renameFolder(id: UUID!, name: String!): Folder!
    """
    Moves a folder, with everything in it, into \`parentId\`, or to the top level when it is null.
    Refused into itself or anything under it, and when something there already has its name.
    """
    moveFolder(id: UUID!, parentId: UUID): Folder!
    "Deletes the folder, every folder under it and every document in them, with their stored files."
    deleteFolder(id: UUID!): Boolean!
  }
`);

/**
 * Adds every folder write to the schema.
 *
 * @param schema - The generated schema, which must already have a Mutation type.
 * @returns The extended schema.
 *
 * @remarks
 * Hand-written resolvers do not inherit `scope`, so each one states ownership itself, through
 * `loadOwnedFolder` or `ownedParent`.
 */
export function applyFoldersExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, FOLDERS_SDL);
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  mutations.createFolder.resolve = async (
    _parent: unknown,
    args: { name: string; parentId?: string | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const name = parseOrThrow(folderNameSchema, args.name);
    return context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      const parentId = await ownedParent(tx, userId, args.parentId);
      await assertNameFree(tx, userId, parentId, name);
      const [created] = await tx.insert(folders).values({ userId, parentId, name }).returning();
      return created;
    });
  };

  mutations.renameFolder.resolve = async (_parent: unknown, args: { id: string; name: string }, context: Context) => {
    const userId = requireAuth(context);
    const name = parseOrThrow(folderNameSchema, args.name);
    return context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      const folder = await loadOwnedFolder(tx, userId, args.id);
      // Its own name does not count, so a change of case alone goes through.
      await assertNameFree(tx, userId, folder.parentId, name, { folderId: folder.id });
      const [updated] = await tx.update(folders).set({ name }).where(eq(folders.id, folder.id)).returning();
      return updated;
    });
  };

  mutations.moveFolder.resolve = async (
    _parent: unknown,
    args: { id: string; parentId?: string | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    return context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      const folder = await loadOwnedFolder(tx, userId, args.id);
      const parentId = await ownedParent(tx, userId, args.parentId);
      if (parentId === folder.parentId) {
        return folder;
      }
      // A folder inside itself, or inside its own subfolder, would leave the
      // top level and take everything under it out of reach.
      if (parentId !== null && (await folderAndDescendants(tx, userId, folder.id)).includes(parentId)) {
        throw badInput('A folder cannot be moved into itself or into a folder inside it.');
      }
      await assertNameFree(tx, userId, parentId, folder.name, { folderId: folder.id });
      const [updated] = await tx.update(folders).set({ parentId }).where(eq(folders.id, folder.id)).returning();
      return updated;
    });
  };

  mutations.deleteFolder.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    await context.db.transaction(async (tx) => {
      // Under the lock, so an upload into one of these folders either lands
      // before the list is read, and goes with the rest, or waits and finds
      // its folder gone.
      await lockNames(tx, userId);
      const folder = await loadOwnedFolder(tx, userId, args.id);
      const ids = await folderAndDescendants(tx, userId, folder.id);
      const filed = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.userId, userId), inArray(documents.folderId, ids)));
      await deleteStoredFiles(context.storage, filed);
      if (filed.length > 0) {
        await tx.delete(documents).where(
          inArray(
            documents.id,
            filed.map((doc) => doc.id),
          ),
        );
      }
      // Its subfolders go with it, by the parent's ON DELETE CASCADE.
      await tx.delete(folders).where(eq(folders.id, folder.id));
    });
    return true;
  };

  return extended;
}
