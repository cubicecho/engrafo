import { useMutation } from '@apollo/client/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { graphql } from '@/__generated__';
import type { DocumentStatusEnum } from '@/__generated__/graphql';
import { FolderInput, FolderPlus, Unplug } from '@/components/domain/app-icons';
import { MoveDialog } from '@/components/domain/move-dialog';
import { NameDialog } from '@/components/domain/name-dialog';
import { RenameDocumentDialog } from '@/components/domain/rename-document-dialog';
import { DocumentStatusBadge } from '@/components/domain/status-badge';
import { FileTree } from '@/components/file-tree';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, FolderPen, Pencil, Plug, Trash2, Upload } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { messageOf } from '@/lib/error-message';
import {
  type ArchiveEntry,
  archiveEntries,
  type FolderRow,
  folderAndDescendants,
  folderNameError,
  folderPaths,
  mcpSharedBy,
} from '@/lib/folder-tree';
import { formatBytes } from '@/lib/format';
import { documentPath } from '@/lib/routes';
import { TRASH_QUERY_NAMES } from '@/lib/trash';
import type { TreeNode } from '@/lib/tree';
import { cn } from '@/lib/utils';

const CreateFolder = graphql(`
  mutation CreateFolder($name: String!, $parentId: UUID) {
    createFolder(name: $name, parentId: $parentId) {
      id
      name
      parentId
    }
  }
`);

const RenameFolder = graphql(`
  mutation RenameFolder($id: UUID!, $name: String!) {
    renameFolder(id: $id, name: $name) {
      id
      name
    }
  }
`);

const MoveFolder = graphql(`
  mutation MoveFolder($id: UUID!, $parentId: UUID) {
    moveFolder(id: $id, parentId: $parentId) {
      id
      parentId
    }
  }
`);

const DeleteFolder = graphql(`
  mutation DeleteFolder($id: UUID!) {
    deleteFolder(id: $id)
  }
`);

const SetFolderMcp = graphql(`
  mutation SetFolderMcp($id: UUID!, $enabled: Boolean!) {
    setFolderMcp(id: $id, enabled: $enabled) {
      id
      mcpEnabled
    }
  }
`);

const MoveDocument = graphql(`
  mutation MoveDocument($id: UUID!, $folderId: UUID) {
    moveDocument(id: $id, folderId: $folderId) {
      id
      folderId
    }
  }
`);

const RenameTreeDocument = graphql(`
  mutation RenameTreeDocument($id: UUID!, $title: String!) {
    renameDocument(id: $id, title: $title) {
      id
      title
    }
  }
`);

const DeleteTreeDocument = graphql(`
  mutation DeleteTreeDocument($id: UUID!) {
    deleteDocument(id: $id)
  }
`);

/** One document, as the tree needs it. */
export interface TreeDocument {
  id: string;
  title: string;
  folderId?: string | null | undefined;
  sizeBytes: number;
  status: DocumentStatusEnum;
}

type Entry = ArchiveEntry<TreeDocument>;

/** The one dialog the tree has open, if any, and what it is about. */
type OpenDialog =
  | { kind: 'new-folder'; parentId: string }
  | { kind: 'rename-folder'; folder: FolderRow }
  | { kind: 'rename-document'; document: TreeDocument }
  | { kind: 'move'; entry: Entry }
  | { kind: 'delete-folder'; folder: FolderRow; path: string }
  | { kind: 'delete-document'; document: TreeDocument };

interface ArchiveTreeProps {
  folders: readonly FolderRow[];
  documents: readonly TreeDocument[];
  /** Called after anything changes, so the page refetches what the tree draws. */
  onChanged: () => Promise<unknown>;
  /** "Upload here" on a folder's menu: point the upload panel at it, or at the top level for null. */
  onUploadInto: (folderId: string | null) => void;
  /** The document open beside the tree, which the tree marks. */
  selectedDocumentId?: string | undefined;
  className?: string | undefined;
}

/** "3 documents and 1 folder", for what a folder delete takes with it. */
function contentsOf(folders: readonly FolderRow[], documents: readonly TreeDocument[], id: string): string {
  const inside = folderAndDescendants(folders, id);
  const folderCount = inside.size - 1;
  const documentCount = documents.filter((doc) => doc.folderId && inside.has(doc.folderId)).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(documentCount, 'document')} and ${plural(folderCount, 'folder')}`;
}

/**
 * The archive as folders and files: cubeui's `FileTree` over every folder and document, each
 * document a link to its page. A row is moved by dragging it onto a folder or with "Move to…" in
 * its menu, which is the way that needs no pointer; renames and the new folder are dialogs, and a
 * folder is only deleted once its name is typed.
 */
export function ArchiveTree({
  folders,
  documents,
  onChanged,
  onUploadInto,
  selectedDocumentId,
  className,
}: ArchiveTreeProps) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [createFolder] = useMutation(CreateFolder);
  const [renameFolder] = useMutation(RenameFolder);
  const [moveFolder] = useMutation(MoveFolder);
  const [deleteFolder] = useMutation(DeleteFolder, { refetchQueries: [...TRASH_QUERY_NAMES] });
  const [moveDocument] = useMutation(MoveDocument);
  const [setFolderMcp] = useMutation(SetFolderMcp);
  const [renameDocument] = useMutation(RenameTreeDocument);
  const [deleteDocument] = useMutation(DeleteTreeDocument, { refetchQueries: [...TRASH_QUERY_NAMES] });

  const entries = useMemo(() => archiveEntries(folders, documents), [folders, documents]);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const paths = useMemo(() => folderPaths(folders), [folders]);
  /** The folder a drop lands in, by its path; `""`, the tree's own blank space, is the top level. */
  const folderAt = (path: string): string | null => {
    const entry = byPath.get(path);
    return entry?.kind === 'folder' ? entry.folder.id : null;
  };

  /** Moves a row into a folder: what a drag ends in, and what "Move to…" sends. */
  async function move(entry: Entry, folderId: string | null) {
    if (entry.kind === 'folder') {
      await moveFolder({ variables: { id: entry.folder.id, parentId: folderId } });
    } else {
      await moveDocument({ variables: { id: entry.document.id, folderId } });
    }
    await onChanged();
  }

  /** The tree has no error of its own to show, so a drag the server refuses is said above it. */
  async function moveByDrag(from: string, into: string) {
    const entry = byPath.get(from);
    if (!entry) {
      return;
    }
    setFailure(null);
    try {
      await move(entry, folderAt(into));
    } catch (error) {
      setFailure({
        title: `Could not move “${entry.kind === 'folder' ? entry.folder.name : entry.document.title}”`,
        message: messageOf(error) ?? 'The server refused it',
      });
    }
  }

  async function shareWithMcp(folder: FolderRow, enabled: boolean) {
    setFailure(null);
    try {
      await setFolderMcp({ variables: { id: folder.id, enabled } });
      await onChanged();
    } catch (error) {
      setFailure({
        title: `Could not ${enabled ? 'share' : 'stop sharing'} “${folder.name}”`,
        message: messageOf(error) ?? 'The server refused it',
      });
    }
  }

  /** The menu row that turns MCP access on or off, or says which folder above already shares it. */
  function mcpItem(folder: FolderRow) {
    const sharedBy = mcpSharedBy(folders, folder.id);
    if (sharedBy && sharedBy.id !== folder.id) {
      return <MenuItem iconSlot={<Plug />} label={`Shared with MCP through “${sharedBy.name}”`} disabled />;
    }
    return sharedBy ? (
      <MenuItem iconSlot={<Unplug />} label="Stop sharing with MCP" onSelect={() => void shareWithMcp(folder, false)} />
    ) : (
      <MenuItem iconSlot={<Plug />} label="Share with MCP" onSelect={() => void shareWithMcp(folder, true)} />
    );
  }

  async function runDelete(title: string, run: () => Promise<unknown>) {
    setFailure(null);
    try {
      await run();
      await onChanged();
    } catch (error) {
      setFailure({ title, message: messageOf(error) ?? 'The server refused it' });
    }
  }

  function rowMenu(node: TreeNode<Entry>) {
    const entry = node.entry;
    if (!entry) {
      return null;
    }
    const name = entry.kind === 'folder' ? entry.folder.name : entry.document.title;
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${name}`} iconSlot={<Ellipsis />} />
        </MenuTrigger>
        <MenuContent align="end">
          {entry.kind === 'folder' ? (
            <>
              <MenuItem
                iconSlot={<FolderPlus />}
                label="New folder inside"
                onSelect={() => setDialog({ kind: 'new-folder', parentId: entry.folder.id })}
              />
              <MenuItem iconSlot={<Upload />} label="Upload here" onSelect={() => onUploadInto(entry.folder.id)} />
              <MenuSeparator />
              <MenuItem
                iconSlot={<FolderPen />}
                label="Rename"
                onSelect={() => setDialog({ kind: 'rename-folder', folder: entry.folder })}
              />
              {mcpItem(entry.folder)}
            </>
          ) : (
            <MenuItem
              iconSlot={<Pencil />}
              label="Rename"
              onSelect={() => setDialog({ kind: 'rename-document', document: entry.document })}
            />
          )}
          <MenuItem iconSlot={<FolderInput />} label="Move to…" onSelect={() => setDialog({ kind: 'move', entry })} />
          <MenuSeparator />
          <MenuItem
            iconSlot={<Trash2 />}
            label="Delete"
            destructive
            onSelect={() =>
              setDialog(
                entry.kind === 'folder'
                  ? { kind: 'delete-folder', folder: entry.folder, path: entry.path }
                  : { kind: 'delete-document', document: entry.document },
              )
            }
          />
        </MenuContent>
      </Menu>
    );
  }

  const close = () => setDialog(null);
  const selected = entries.find((entry) => entry.kind === 'document' && entry.document.id === selectedDocumentId);

  return (
    <>
      {failure && <Alert variant="destructive" title={failure.title} description={failure.message} />}

      <FileTree
        label="Documents and folders"
        className={className}
        entries={entries}
        selected={selected?.path}
        linkSlot={(node) =>
          node.entry?.kind === 'document' ? <Link to={documentPath(node.entry.document.id)} /> : <span />
        }
        meta={(node) => {
          if (node.entry?.kind === 'folder') {
            // Only where the switch is on: a subfolder it covers says so in its menu, not with a
            // badge on every row under it.
            return node.entry.folder.mcpEnabled ? <Badge variant="info-soft">MCP</Badge> : null;
          }
          if (node.entry?.kind !== 'document') {
            return null;
          }
          const doc = node.entry.document;
          // Only a document that is not settled wears its status: a tree of "Ready" badges says nothing.
          return (
            <span className="flex items-center gap-2">
              {doc.status === 'ready' ? null : <DocumentStatusBadge status={doc.status} />}
              <span
                className={cn(
                  'text-xs tabular-nums',
                  // The tree inks the selected row's own text this way, on the `active` fill.
                  doc.id === selectedDocumentId ? 'text-active-foreground' : 'text-foreground/60',
                )}
              >
                {formatBytes(doc.sizeBytes)}
              </span>
            </span>
          );
        }}
        actionSlot={rowMenu}
        onMove={moveByDrag}
      />

      {dialog?.kind === 'new-folder' && (
        <NameDialog
          title={`New folder in ${paths.get(dialog.parentId) ?? 'this folder'}`}
          label="Name"
          submitLabel="Create"
          validate={folderNameError}
          onSave={async (name) => {
            await createFolder({ variables: { name, parentId: dialog.parentId } });
            await onChanged();
          }}
          onClose={close}
        />
      )}

      {dialog?.kind === 'rename-folder' && (
        <NameDialog
          title="Rename folder"
          label="Name"
          initial={dialog.folder.name}
          validate={folderNameError}
          onSave={async (name) => {
            await renameFolder({ variables: { id: dialog.folder.id, name } });
            await onChanged();
          }}
          onClose={close}
        />
      )}

      {dialog?.kind === 'rename-document' && (
        <RenameDocumentDialog
          title={dialog.document.title}
          onRename={async (title) => {
            await renameDocument({ variables: { id: dialog.document.id, title } });
            await onChanged();
          }}
          onClose={close}
        />
      )}

      {dialog?.kind === 'move' && (
        <MoveDialog
          name={dialog.entry.kind === 'folder' ? dialog.entry.folder.name : dialog.entry.document.title}
          folders={folders}
          currentFolderId={
            dialog.entry.kind === 'folder'
              ? (dialog.entry.folder.parentId ?? null)
              : (dialog.entry.document.folderId ?? null)
          }
          exclude={dialog.entry.kind === 'folder' ? folderAndDescendants(folders, dialog.entry.folder.id) : undefined}
          onMove={(folderId) => move(dialog.entry, folderId)}
          onClose={close}
        />
      )}

      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (open === false) {
              close();
            }
          }}
          title={`Delete “${dialog.folder.name}”?`}
          description={`The folder and every folder in it are deleted. What is in it (${contentsOf(folders, documents, dialog.folder.id)}) goes to the Trash, and is restored at the top level.`}
          confirmLabel="Delete folder"
          requireText={dialog.folder.name}
          requireTextLabel={`Type ${dialog.folder.name} to confirm`}
          onConfirm={() => {
            const { folder } = dialog;
            close();
            void runDelete(`Could not delete “${folder.name}”`, () => deleteFolder({ variables: { id: folder.id } }));
          }}
        />
      )}

      {dialog?.kind === 'delete-document' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (open === false) {
              close();
            }
          }}
          title={`Move “${dialog.document.title}” to the trash?`}
          description="It waits in the Trash, where it can be restored, until it is deleted for good."
          confirmLabel="Move to trash"
          onConfirm={() => {
            const { document } = dialog;
            close();
            void runDelete(`Could not delete “${document.title}”`, () =>
              deleteDocument({ variables: { id: document.id } }),
            );
          }}
        />
      )}
    </>
  );
}
