import { useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { ArchiveTree } from '@/components/domain/archive-tree';
import { DocumentSearchResults } from '@/components/domain/document-search-results';
import { ExportReceiptsButton } from '@/components/domain/export-receipts';
import { FilteredDocuments } from '@/components/domain/filtered-documents';
import { MergeDocumentsDialog, type MergeRequest } from '@/components/domain/merge-documents-dialog';
import type { MergeSelection } from '@/components/domain/merge-select';
import { NewFolderButton } from '@/components/domain/new-folder-button';
import { SaveSearchButton } from '@/components/domain/saved-searches';
import { SearchFilterBar } from '@/components/domain/search-filter-bar';
import { UploadPanel } from '@/components/domain/upload-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { FileText, Layers, X } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { ARCHIVE_QUERY_NAME, useArchive } from '@/lib/archive';
import { type MergeCandidate, setCandidates, toggleCandidate } from '@/lib/merge';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { documentPath, UPLOAD_INTO_PARAM } from '@/lib/routes';
import {
  readSearchFilters,
  SEARCH_PARAM,
  type SearchFilters,
  toSearchFilterInput,
  writeSearchFilters,
} from '@/lib/search-filters';
import { TRASH_QUERY_NAMES } from '@/lib/trash';
import { cn } from '@/lib/utils';

const DocumentsPage = graphql(`
  query DocumentsPage {
    serverConfig {
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
      visionAvailable
      mergeAvailable
    }
  }
`);

const MergeDocuments = graphql(`
  mutation MergeDocuments($input: MergeDocumentsInput!) {
    mergeDocuments(input: $input) {
      id
    }
  }
`);

/**
 * The archive's front page: the upload panel, and a search box and filters that swap it for what
 * they found. Filters with no search list every document that matches them.
 * The tree of folders and documents is in the sidebar (`ArchiveSidebarSection`), which is also
 * what polls while a document is being processed; under `md`, where the sidebar is a bar, the
 * tree is drawn here instead.
 *
 * Each result has a box that picks it to merge, and the picks outlast the search that found them,
 * so documents from several searches can be merged. The order they were picked in is the page order
 * until the merge dialog changes it.
 */
export function DocumentsRoute() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = (params.get(SEARCH_PARAM) ?? '').trim();
  // The search box holds its own text and is only given where to start. When the text in the URL
  // changes from outside it — a saved search opened from the sidebar, Back — it is drawn afresh
  // from the URL; when the change is its own, it is left alone, or it would lose the caret.
  const typed = useRef(search);
  const [searchBoxKey, setSearchBoxKey] = useState(0);
  useEffect(() => {
    if (search !== typed.current) {
      typed.current = search;
      setSearchBoxKey((key) => key + 1);
    }
  }, [search]);
  const setSearch = (text: string) => {
    typed.current = text.trim();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (text.trim() === '') {
          next.delete(SEARCH_PARAM);
        } else {
          next.set(SEARCH_PARAM, text.trim());
        }
        return next;
      },
      // One history entry per search, not one per pause in typing.
      { replace: true },
    );
  };

  // The search's filters sit beside its text in the URL, for the same reason.
  const filters = readSearchFilters(params);
  const filterInput = toSearchFilterInput(filters);
  const setFilters = (next: SearchFilters) =>
    setParams((current) => writeSearchFilters(current, next), { replace: true });

  const page = useQuery(DocumentsPage);
  const { result, folders, documents } = useArchive();

  const [selected, setSelected] = useState<MergeCandidate[]>([]);
  const [merging, setMerging] = useState(false);
  const selection: MergeSelection | undefined =
    page.data?.serverConfig.mergeAvailable === true
      ? {
          selectedIds: new Set(selected.map((doc) => doc.id)),
          onToggle: (candidate) => setSelected((current) => toggleCandidate(current, candidate)),
          onSetMany: (candidates, picked) => setSelected((current) => setCandidates(current, candidates, picked)),
        }
      : undefined;
  const [mergeDocuments] = useMutation(MergeDocuments);
  const merge = async (request: MergeRequest) => {
    const { data } = await mergeDocuments({
      variables: { input: request },
      // The new document is in the tree and the lists; trashed originals leave them for the trash.
      refetchQueries: [
        ARCHIVE_QUERY_NAME,
        'BrowseDocuments',
        'SearchDocuments',
        ...(request.trashOriginals ? TRASH_QUERY_NAMES : []),
      ],
      awaitRefetchQueries: true,
    });
    setSelected([]);
    if (data) {
      navigate(documentPath(data.mergeDocuments.id));
    }
  };
  // Where the upload panel files what it is given, kept in the URL so a folder's "Upload here"
  // in the sidebar's tree, on any page, can point it there.
  const uploadFolderId = params.get(UPLOAD_INTO_PARAM);
  const setUploadFolderId = (folderId: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (folderId === null) {
          next.delete(UPLOAD_INTO_PARAM);
        } else {
          next.set(UPLOAD_INTO_PARAM, folderId);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageLayout
        width="full"
        iconSlot={<FileText />}
        title="Documents"
        description="Upload into a folder, or search and filter everything you have uploaded. The folders are in the sidebar."
        actionSlot={
          <>
            {selection && selected.length > 0 && (
              <>
                <Button
                  size="sm"
                  iconSlot={<Layers />}
                  content={`Merge documents (${selected.length})`}
                  onClick={() => setMerging(true)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconSlot={<X />}
                  content="Clear selection"
                  onClick={() => setSelected([])}
                />
              </>
            )}
            <ExportReceiptsButton folders={folders} />
            {(search !== '' || filterInput !== null) && <SaveSearchButton query={search} filter={filterInput} />}
            <NewFolderButton />
          </>
        }
        headerContentSlot={
          <>
            <SearchInput
              key={searchBoxKey}
              label="Search documents"
              placeholder="Search by meaning or by exact words"
              defaultValue={search}
              onSettledText={setSearch}
            />
            <SearchFilterBar folders={folders} value={filters} onValueChange={setFilters} />
          </>
        }
        contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
        contentSlot={
          search !== '' ? (
            <DocumentSearchResults query={search} filter={filterInput} selection={selection} />
          ) : filterInput !== null ? (
            <FilteredDocuments filter={filterInput} selection={selection} />
          ) : (
            <>
              {page.data?.serverConfig && (
                <UploadPanel
                  config={page.data.serverConfig}
                  folders={folders}
                  folderId={uploadFolderId}
                  onFolderChange={setUploadFolderId}
                  onChanged={() => void result.refetch()}
                />
              )}

              <LoadState
                query={queryLike(result)}
                what="your documents"
                count={documents.length + folders.length}
                emptySlot={
                  <EmptyState
                    iconSlot={<FileText />}
                    title="No documents yet"
                    description="Upload a PDF, a scan or a text file to get started, or make a folder to file them in."
                  />
                }
              />

              {/* From \`md\` up the tree is in the sidebar; below it the sidebar is a bar, so it is here. */}
              {documents.length + folders.length > 0 && (
                <ArchiveTree
                  className="md:hidden"
                  folders={folders}
                  documents={documents}
                  onChanged={() => result.refetch()}
                  onUploadInto={setUploadFolderId}
                  visionAvailable={page.data?.serverConfig.visionAvailable === true}
                />
              )}
            </>
          )
        }
      />
      {merging && selected.length > 0 && (
        <MergeDocumentsDialog
          documents={selected}
          folders={folders}
          onDocumentsChange={setSelected}
          onMerge={merge}
          onClose={() => setMerging(false)}
        />
      )}
    </>
  );
}
