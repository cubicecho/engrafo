import { useMutation, useQuery } from '@apollo/client/react';
import { useMemo, useState } from 'react';
import { graphql } from '@/__generated__';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Trash2, Undo2 } from '@/components/ui/icons';
import { ARCHIVE_QUERY_NAME, useArchive } from '@/lib/archive';
import { messageOf } from '@/lib/error-message';
import { folderPaths, TOP_LEVEL_LABEL } from '@/lib/folder-tree';
import { formatAgo, formatBytes, joinStats } from '@/lib/format';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { TRASH_QUERY_NAMES } from '@/lib/trash';
import { cn } from '@/lib/utils';

export const TrashQuery = graphql(`
  query Trash {
    trash {
      count
      retentionDays
      documents {
        id
        title
        folderId
        sizeBytes
        deletedAt
      }
    }
  }
`);

const RestoreDocument = graphql(`
  mutation RestoreDocument($id: UUID!) {
    restoreDocument(id: $id) {
      id
      title
      folderId
    }
  }
`);

const PurgeDocument = graphql(`
  mutation PurgeDocument($id: UUID!) {
    purgeDocument(id: $id)
  }
`);

const EmptyTrash = graphql(`
  mutation EmptyTrash {
    emptyTrash
  }
`);

/** Every write here changes the trash, and a restore changes the tree too. */
const REFETCH = { refetchQueries: [...TRASH_QUERY_NAMES, ARCHIVE_QUERY_NAME], awaitRefetchQueries: true };

/**
 * The trash: every document deleted from the archive, most recent first, until it is restored,
 * deleted for good, or purged by the server once it has sat here for the retention period.
 */
export function TrashRoute() {
  const result = useQuery(TrashQuery);
  // The folder names, from the tree's own query and cache: a trashed document's folder is still
  // there, unless it was deleted, and then the document is filed at the top level.
  const { folders } = useArchive();
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [restore] = useMutation(RestoreDocument, REFETCH);
  const [purge] = useMutation(PurgeDocument, REFETCH);
  const [empty, emptyState] = useMutation(EmptyTrash, REFETCH);

  const trash = result.data?.trash;
  const rows = trash?.documents ?? [];
  const days = trash?.retentionDays;

  async function run(title: string, write: () => Promise<unknown>) {
    setFailure(null);
    try {
      await write();
    } catch (error) {
      setFailure({ title, message: messageOf(error) ?? 'The server refused it' });
    }
  }

  return (
    <PageLayout
      iconSlot={<Trash2 />}
      title="Trash"
      description={
        days === undefined
          ? 'Deleted documents, until they are deleted for good.'
          : `Deleted documents stay here for ${days} days, then are deleted for good.`
      }
      width="full"
      contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
      actionSlot={
        <ConfirmButton
          size="sm"
          variant="destructive-outline"
          iconSlot={<Trash2 />}
          content="Empty trash"
          disabled={rows.length === 0}
          hint={rows.length === 0 ? 'Nothing to empty' : undefined}
          loading={emptyState.loading}
          title="Empty the trash?"
          description={`All ${rows.length} document(s) here, with their files, searchable PDFs and extracted text, are deleted from storage and cannot be recovered.`}
          confirmLabel="Delete forever"
          onConfirm={() => void run('Could not empty the trash', () => empty())}
        />
      }
      contentSlot={
        <>
          {failure && <Alert variant="destructive" title={failure.title} description={failure.message} />}
          <QueryState
            query={queryLike(result)}
            what="the trash"
            count={rows.length}
            emptySlot={
              <EmptyState
                iconSlot={<Trash2 />}
                title="The trash is empty"
                description="A document you delete waits here, so a misclick can be undone."
              />
            }
          />
          <List
            label="Deleted documents"
            contentSlot={rows.map((doc) => (
              <ListItem
                key={doc.id}
                title={doc.title}
                description={
                  doc.folderId === null || doc.folderId === undefined
                    ? `Restores to ${TOP_LEVEL_LABEL.toLowerCase()}`
                    : `Restores to ${paths.get(doc.folderId) ?? 'its folder'}`
                }
                meta={joinStats(doc.deletedAt && `Deleted ${formatAgo(doc.deletedAt)}`, formatBytes(doc.sizeBytes))}
                actionSlot={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      iconSlot={<Undo2 />}
                      content="Restore"
                      onClick={() =>
                        void run(`Could not restore “${doc.title}”`, () => restore({ variables: { id: doc.id } }))
                      }
                    />
                    <ConfirmButton
                      size="icon-sm"
                      variant="destructive-outline"
                      iconSlot={<Trash2 />}
                      aria-label={`Delete “${doc.title}” forever`}
                      hint="Delete forever"
                      title={`Delete “${doc.title}” forever?`}
                      description="The uploaded file, its searchable PDF and the text extracted from it are deleted from storage and cannot be recovered."
                      confirmLabel="Delete forever"
                      onConfirm={() =>
                        void run(`Could not delete “${doc.title}”`, () => purge({ variables: { id: doc.id } }))
                      }
                    />
                  </>
                }
              />
            ))}
          />
        </>
      }
    />
  );
}
