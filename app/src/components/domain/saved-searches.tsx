import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { Link, useLocation, useMatch } from 'react-router';
import { graphql } from '@/__generated__';
import type { DocumentSearchFilter } from '@/__generated__/graphql';
import { Bookmark, BookmarkPlus } from '@/components/domain/app-icons';
import { NameDialog } from '@/components/domain/name-dialog';
import { EmptyState } from '@/components/empty-state';
import { ListItem } from '@/components/list-item';
import { QueryState } from '@/components/query-state';
import { SidebarSection } from '@/components/sidebar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, Pencil, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { messageOf } from '@/lib/error-message';
import { queryLike } from '@/lib/query';
import { ROUTES } from '@/lib/routes';
import { isShowingSavedSearch, type SavedSearchRow, savedSearchNameError, savedSearchPath } from '@/lib/saved-searches';

export const SavedSearchesQuery = graphql(`
  query SavedSearches {
    savedSearches(orderBy: { name: { direction: asc, priority: 1 } }) {
      id
      name
      query
      filters
    }
  }
`);

/** The Apollo document saved searches are read with, for a mutation's `refetchQueries`. */
const SAVED_SEARCHES_QUERY_NAME = 'SavedSearches';

const SaveSearch = graphql(`
  mutation SaveSearch($name: String!, $query: String, $filter: DocumentSearchFilter) {
    saveSearch(name: $name, query: $query, filter: $filter) {
      id
    }
  }
`);

const RenameSavedSearch = graphql(`
  mutation RenameSavedSearch($id: UUID!, $name: String!) {
    renameSavedSearch(id: $id, name: $name) {
      id
      name
    }
  }
`);

const DeleteSavedSearch = graphql(`
  mutation DeleteSavedSearch($id: UUID!) {
    deleteSavedSearch(id: $id)
  }
`);

interface SaveSearchButtonProps {
  /** The search text, trimmed; empty for filters alone. */
  query: string;
  /** The filters as the page sends them, or null for none. */
  filter: DocumentSearchFilter | null;
}

/**
 * "Save search" on the documents page: names what the page is showing now, the text and the
 * filters, so the sidebar can open it again. Drawn only while there is something to save.
 */
export function SaveSearchButton({ query, filter }: SaveSearchButtonProps) {
  const [open, setOpen] = useState(false);
  const [saveSearch] = useMutation(SaveSearch, {
    refetchQueries: [SAVED_SEARCHES_QUERY_NAME],
    awaitRefetchQueries: true,
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        iconSlot={<BookmarkPlus />}
        content="Save search"
        onClick={() => setOpen(true)}
      />
      {open && (
        <NameDialog
          title="Save search"
          description="It is listed in the sidebar, with these filters, to open again."
          label="Name"
          // The search text as a first suggestion, which can be saved as it is.
          initial={query}
          requireChanges={false}
          submitLabel="Save"
          validate={savedSearchNameError}
          onSave={(name) => saveSearch({ variables: { name, query: query === '' ? null : query, filter } })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The one dialog the section has open, if any, and which saved search it is about. */
type OpenDialog = { kind: 'rename'; search: SavedSearchRow } | { kind: 'delete'; search: SavedSearchRow };

/**
 * The saved searches, as a section of the sidebar under the archive's tree. Each opens the
 * documents page with its text and filters, and is marked while the page shows it; its menu
 * renames or forgets it.
 */
export function SavedSearchesSidebarSection() {
  const result = useQuery(SavedSearchesQuery);
  const searches = result.data?.savedSearches ?? [];
  const location = useLocation();
  const onDocuments = useMatch({ path: ROUTES.documents, end: true }) !== null;
  const current = new URLSearchParams(location.search);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [renameSavedSearch] = useMutation(RenameSavedSearch);
  const [deleteSavedSearch] = useMutation(DeleteSavedSearch, {
    refetchQueries: [SAVED_SEARCHES_QUERY_NAME],
    awaitRefetchQueries: true,
  });
  const close = () => setDialog(null);

  // The dialogs sit beside the section, not in it: they draw in a portal, and a section's rows are
  // its list items.
  return (
    <>
      <SidebarSection
        title="Saved searches"
        status={
          <>
            {failure && <Alert variant="destructive" title="Could not delete the saved search" description={failure} />}
            <QueryState
              compact
              query={queryLike(result)}
              what="your saved searches"
              count={searches.length}
              emptySlot={<EmptyState compact title="Save a search to find it here." />}
            />
          </>
        }
        contentSlot={searches.map((search) => (
          <ListItem
            key={search.id}
            leadingSlot={<Bookmark className="size-4 text-foreground/60" aria-hidden />}
            title={search.name}
            linkSlot={<Link to={savedSearchPath(search)} />}
            selected={onDocuments && isShowingSavedSearch(current, search)}
            actionSlot={
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for ${search.name}`}
                    iconSlot={<Ellipsis />}
                  />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    iconSlot={<Pencil />}
                    label="Rename"
                    onSelect={() => setDialog({ kind: 'rename', search })}
                  />
                  <MenuItem
                    iconSlot={<Trash2 />}
                    label="Delete"
                    destructive
                    onSelect={() => setDialog({ kind: 'delete', search })}
                  />
                </MenuContent>
              </Menu>
            }
          />
        ))}
      />
      {dialog?.kind === 'rename' && (
        <NameDialog
          title="Rename saved search"
          label="Name"
          initial={dialog.search.name}
          validate={savedSearchNameError}
          onSave={(name) => renameSavedSearch({ variables: { id: dialog.search.id, name } })}
          onClose={close}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (open === false) {
              close();
            }
          }}
          title={`Delete “${dialog.search.name}”?`}
          description="Only the saved search goes. The documents it finds are not touched."
          confirmLabel="Delete"
          onConfirm={() => {
            const { search } = dialog;
            close();
            setFailure(null);
            deleteSavedSearch({ variables: { id: search.id } }).catch((error: unknown) =>
              setFailure(messageOf(error) ?? 'The server refused it'),
            );
          }}
        />
      )}
    </>
  );
}
