import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import type { Context } from '../core/context.ts';
import { badInput, requireAuth } from '../core/errors.ts';
import { mergeDocuments } from './merge.ts';

const MERGE_SDL = parse(`
  input MergeDocumentsInput {
    "The PDFs and images to merge, in the order their pages go in. At least two."
    ids: [UUID!]!
    "The merged document's title. Numbered, as an upload's is, when something in the folder has it."
    title: String!
    "The folder to file it in. Left out or null, the top level."
    folderId: UUID
    "Put the documents merged in the trash, where they can be restored until it is emptied."
    trashOriginals: Boolean
  }

  extend type ServerConfig {
    "Whether documents can be merged here: Python with pikepdf and img2pdf, which ocrmypdf brings."
    mergeAvailable: Boolean!
  }

  extend type Mutation {
    """
    Merges PDFs and images into one PDF, filed as a new document and processed like an upload.
    Each source's searchable PDF is used when it has one, so its text comes along.
    """
    mergeDocuments(input: MergeDocumentsInput!): Document!
  }
`);

/**
 * Adds `mergeDocuments` and `ServerConfig.mergeAvailable`.
 *
 * @param schema - The schema, already holding `ServerConfig` from the documents extension.
 * @returns The extended schema.
 */
export function applyMergeExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, MERGE_SDL);
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();
  const serverConfig = assertObjectType(extended.getType('ServerConfig')).getFields();

  serverConfig.mergeAvailable.resolve = (_parent: unknown, _args: unknown, context: Context) => context.mergeAvailable;

  mutations.mergeDocuments.resolve = async (_parent: unknown, args: { input: unknown }, context: Context) => {
    const userId = requireAuth(context);
    if (context.mergeAvailable === false) {
      throw badInput('Merging is not available on this server: Python with pikepdf and img2pdf was not found.');
    }
    return mergeDocuments(context, userId, args.input);
  };

  return extended;
}
