import { useQuery } from '@apollo/client/react';
import { useMatch, useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { ArchiveTree } from '@/components/domain/archive-tree';
import { NewFolderButton } from '@/components/domain/new-folder-button';
import { EmptyState } from '@/components/empty-state';
import { QueryState } from '@/components/query-state';
import { SidebarSection } from '@/components/sidebar';
import { useArchive } from '@/lib/archive';
import { queryLike } from '@/lib/query';
import { ROUTES, uploadIntoPath } from '@/lib/routes';

// Whether a folder's menu offers the vision model. Its own query, so the archive's does not
// change shape for what the server can do.
const ArchiveReaders = graphql(`
  query ArchiveReaders {
    serverConfig {
      visionAvailable
    }
  }
`);

/**
 * The archive's tree as a section of the app's sidebar, under the places: on every signed-in
 * page, with the open document marked. It is the reader that polls (see `useArchive`), because it
 * is the one that is always mounted — the sidebar is hidden under `md` by CSS, not unmounted.
 */
export function ArchiveSidebarSection() {
  const { result, folders, documents } = useArchive({ poll: true });
  const readers = useQuery(ArchiveReaders);
  const navigate = useNavigate();
  const open = useMatch(ROUTES.document)?.params.id;
  const empty = folders.length === 0 && documents.length === 0;

  return (
    <SidebarSection
      title="Archive"
      actionSlot={<NewFolderButton look="icon" />}
      contentSlot={
        empty || result.data === undefined ? (
          <QueryState
            compact
            query={queryLike(result)}
            what="the archive"
            count={folders.length + documents.length}
            emptySlot={<EmptyState compact title="Nothing filed yet." />}
          />
        ) : (
          <ArchiveTree
            folders={folders}
            documents={documents}
            onChanged={() => result.refetch()}
            onUploadInto={(folderId) => void navigate(uploadIntoPath(folderId))}
            selectedDocumentId={open}
            visionAvailable={readers.data?.serverConfig.visionAvailable === true}
          />
        )
      }
    />
  );
}
