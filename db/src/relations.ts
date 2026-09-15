import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

// This config — not the table list — is what drizzle-graphql reads, so a table
// with no entry here gets no relation fields in the API.
export const relations = defineRelations(schema, (r) => ({
  users: {
    documents: r.many.documents({ from: r.users.id, to: r.documents.userId }),
  },

  documents: {
    user: r.one.users({ from: r.documents.userId, to: r.users.id }),
    processingSteps: r.many.processingSteps({ from: r.documents.id, to: r.processingSteps.documentId }),
  },

  processingSteps: {
    user: r.one.users({ from: r.processingSteps.userId, to: r.users.id }),
    document: r.one.documents({ from: r.processingSteps.documentId, to: r.documents.id }),
  },
}));
