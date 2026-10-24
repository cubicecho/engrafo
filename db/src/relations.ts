import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

/**
 * How the tables relate. drizzle-graphql reads this config, not the table list, so a table
 * with no entry here gets no relation fields in the API.
 */
export const relations = defineRelations(schema, (r) => ({
  users: {
    documents: r.many.documents({ from: r.users.id, to: r.documents.userId }),
    folders: r.many.folders({ from: r.users.id, to: r.folders.userId }),
    savedSearches: r.many.savedSearches({ from: r.users.id, to: r.savedSearches.userId }),
  },

  folders: {
    user: r.one.users({ from: r.folders.userId, to: r.users.id }),
    documents: r.many.documents({ from: r.folders.id, to: r.documents.folderId }),
  },

  documents: {
    user: r.one.users({ from: r.documents.userId, to: r.users.id }),
    folder: r.one.folders({ from: r.documents.folderId, to: r.folders.id }),
    processingSteps: r.many.processingSteps({ from: r.documents.id, to: r.processingSteps.documentId }),
  },

  savedSearches: {
    user: r.one.users({ from: r.savedSearches.userId, to: r.users.id }),
  },

  processingSteps: {
    user: r.one.users({ from: r.processingSteps.userId, to: r.users.id }),
    document: r.one.documents({ from: r.processingSteps.documentId, to: r.documents.id }),
  },
}));
