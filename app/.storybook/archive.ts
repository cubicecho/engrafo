import { type ArchiveQuery, DocumentStatusEnum } from '@/__generated__/graphql';
import { clientId } from '@/lib/id';

// The archive as the stories serve it: fixtures, and a server that remembers, shared by the
// documents page's stories and the sidebar tree's, which read the same query.

export const SERVER_CONFIG = {
  version: '1.4.2',
  maxUploadBytes: 104_857_600,
  acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'],
  ocrAvailable: true,
  ocrDefault: true,
};

export type Document = ArchiveQuery['documents'][number];
export type Folder = ArchiveQuery['folders'][number];

export function document(overrides: Partial<Document>): Document {
  return {
    id: clientId(),
    title: 'Untitled',
    folderId: null,
    sizeBytes: 482_113,
    status: DocumentStatusEnum.Ready,
    ...overrides,
  };
}

export const TAXES: Folder = { id: clientId(), name: 'Taxes', parentId: null, mcpEnabled: false };
export const YEAR: Folder = { id: clientId(), name: '2026', parentId: TAXES.id, mcpEnabled: false };
export const EMPTY_FOLDER: Folder = { id: clientId(), name: 'Receipts', parentId: null, mcpEnabled: false };

/**
 * A server that remembers: the folder and document writes change what the next read returns,
 * as the real one does, so a story can make a change and then see it in the tree.
 */
export function archiveServer(start: { folders: Folder[]; documents: Document[] }) {
  const folders = start.folders.map((folder) => ({ ...folder }));
  const documents = start.documents.map((doc) => ({ ...doc }));
  const taken = (parentId: string | null, name: string) =>
    [
      ...folders.filter((f) => (f.parentId ?? null) === parentId).map((f) => f.name),
      ...documents.filter((d) => (d.folderId ?? null) === parentId).map((d) => d.title),
    ].some((n) => n.toLowerCase() === name.toLowerCase());
  return {
    Query: {
      serverConfig: () => SERVER_CONFIG,
      folders: () => folders,
      documents: () => documents,
    },
    Mutation: {
      createFolder: (_parent: unknown, args: { name: string; parentId?: string | null }) => {
        if (taken(args.parentId ?? null, args.name)) {
          throw new Error(`Something called "${args.name}" is already there.`);
        }
        const folder = { id: clientId(), name: args.name, parentId: args.parentId ?? null, mcpEnabled: false };
        folders.push(folder);
        return folder;
      },
      moveDocument: (_parent: unknown, args: { id: string; folderId?: string | null }) => {
        const doc = documents.find((d) => d.id === args.id);
        if (!doc) {
          throw new Error('Document not found');
        }
        doc.folderId = args.folderId ?? null;
        return doc;
      },
      setFolderMcp: (_parent: unknown, args: { id: string; enabled: boolean }) => {
        const folder = folders.find((f) => f.id === args.id);
        if (!folder) {
          throw new Error('Folder not found');
        }
        folder.mcpEnabled = args.enabled;
        return folder;
      },
      deleteFolder: (_parent: unknown, args: { id: string }) => {
        folders.splice(
          folders.findIndex((f) => f.id === args.id),
          1,
        );
        return true;
      },
    },
  };
}
