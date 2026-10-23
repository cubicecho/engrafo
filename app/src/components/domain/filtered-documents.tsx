import { useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import type { DocumentSearchFilter } from '@/__generated__/graphql';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Search } from '@/components/ui/icons';
import { formatCalendarDay } from '@/lib/calendar-day';
import { formatDate, joinStats } from '@/lib/format';
import { queryLike } from '@/lib/query';
import { documentPath } from '@/lib/routes';

export const BrowseDocuments = graphql(`
  query BrowseDocuments($filter: DocumentSearchFilter!, $first: Int!, $offset: Int!) {
    browseDocuments(filter: $filter, first: $first, offset: $offset) {
      hasMore
      documents {
        id
        title
        originalFilename
        createdAt
        documentDate
      }
    }
  }
`);

/** How many rows a page of the list asks for. The server's own default, said here so paging agrees with it. */
const PAGE_SIZE = 50;

interface FilteredDocumentsProps {
  /** What the list is narrowed to. Never empty: with nothing narrowed the page shows the archive itself. */
  filter: DocumentSearchFilter;
}

/**
 * Every document that matches the filters, with no search to rank them: the newest by the date on
 * the document first, then the undated ones. A page at a time, with "Show more" under it.
 */
export function FilteredDocuments({ filter }: FilteredDocumentsProps) {
  const navigate = useNavigate();
  const result = useQuery(BrowseDocuments, { variables: { filter, first: PAGE_SIZE, offset: 0 } });
  const [loadingMore, setLoadingMore] = useState(false);
  const page = result.data?.browseDocuments;
  const rows = page?.documents ?? [];

  const showMore = async () => {
    setLoadingMore(true);
    try {
      await result.fetchMore({
        variables: { offset: rows.length },
        // The next page is appended to the first query's list, so the rows already drawn stay put.
        updateQuery: (previous, { fetchMoreResult }) => ({
          browseDocuments: {
            ...fetchMoreResult.browseDocuments,
            documents: [...previous.browseDocuments.documents, ...fetchMoreResult.browseDocuments.documents],
          },
        }),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <QueryState
        query={queryLike(result)}
        what="the documents that match"
        count={rows.length}
        emptySlot={
          <EmptyState iconSlot={<Search />} title="Nothing matches" description="No document matches these filters." />
        }
      />
      <List
        label="Documents that match the filters"
        contentSlot={rows.map((document) => (
          <ListItem
            key={document.id}
            title={document.title}
            description={document.originalFilename}
            // The date on the document when there is one, which is the date the list is ordered by.
            meta={joinStats(formatCalendarDay(document.documentDate) || formatDate(document.createdAt))}
            onClick={() => navigate(documentPath(document.id))}
          />
        ))}
      />
      {page?.hasMore && (
        <Button
          variant="outline"
          className="self-center"
          content="Show more"
          loading={loadingMore}
          onClick={showMore}
        />
      )}
    </>
  );
}
