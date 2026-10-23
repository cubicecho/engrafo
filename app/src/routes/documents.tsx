import { useQuery } from '@apollo/client/react';
import { useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { ArchiveTree } from '@/components/domain/archive-tree';
import { DocumentSearchResults } from '@/components/domain/document-search-results';
import { ExportReceiptsButton } from '@/components/domain/export-receipts';
import { FilteredDocuments } from '@/components/domain/filtered-documents';
import { NewFolderButton } from '@/components/domain/new-folder-button';
import { SearchFilterBar } from '@/components/domain/search-filter-bar';
import { UploadPanel } from '@/components/domain/upload-panel';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { FileText } from '@/components/ui/icons';
import { SearchInput } from '@/components/ui/search-input';
import { useArchive } from '@/lib/archive';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { UPLOAD_INTO_PARAM } from '@/lib/routes';
import { readSearchFilters, type SearchFilters, toSearchFilterInput, writeSearchFilters } from '@/lib/search-filters';
import { cn } from '@/lib/utils';

const DocumentsPage = graphql(`
  query DocumentsPage {
    serverConfig {
      maxUploadBytes
      acceptedMimeTypes
      ocrAvailable
      ocrDefault
    }
  }
`);

/** The query string key the search box keeps its text in, so a search survives a reload and Back. */
const SEARCH_PARAM = 'q';

/**
 * The archive's front page: the upload panel, and a search box and filters that swap it for what
 * they found. Filters with no search list every document that matches them.
 * The tree of folders and documents is in the sidebar (`ArchiveSidebarSection`), which is also
 * what polls while a document is being processed; under `md`, where the sidebar is a bar, the
 * tree is drawn here instead.
 */
export function DocumentsRoute() {
  const [params, setParams] = useSearchParams();
  const search = (params.get(SEARCH_PARAM) ?? '').trim();
  const setSearch = (text: string) =>
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

  // The search's filters sit beside its text in the URL, for the same reason.
  const filters = readSearchFilters(params);
  const filterInput = toSearchFilterInput(filters);
  const setFilters = (next: SearchFilters) =>
    setParams((current) => writeSearchFilters(current, next), { replace: true });

  const page = useQuery(DocumentsPage);
  const { result, folders, documents } = useArchive();
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
    <PageLayout
      width="full"
      iconSlot={<FileText />}
      title="Documents"
      description="Upload into a folder, or search and filter everything you have uploaded. The folders are in the sidebar."
      actionSlot={
        <>
          <ExportReceiptsButton folders={folders} />
          <NewFolderButton />
        </>
      }
      headerContentSlot={
        <>
          <SearchInput
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
          <DocumentSearchResults query={search} filter={filterInput} />
        ) : filterInput !== null ? (
          <FilteredDocuments filter={filterInput} />
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

            <QueryState
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
              />
            )}
          </>
        )
      }
    />
  );
}
