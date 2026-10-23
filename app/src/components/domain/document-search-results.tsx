import { useQuery } from '@apollo/client/react';
import { useNavigate } from 'react-router';
import { graphql } from '@/__generated__';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { QueryState } from '@/components/query-state';
import { Search } from '@/components/ui/icons';
import { formatCalendarDay } from '@/lib/calendar-day';
import { formatDate, joinStats } from '@/lib/format';
import { queryLike } from '@/lib/query';
import { documentPath } from '@/lib/routes';

export const SearchDocuments = graphql(`
  query SearchDocuments($query: String!) {
    searchDocuments(query: $query) {
      snippet
      document {
        id
        title
        originalFilename
        createdAt
        documentDate
      }
    }
  }
`);

interface DocumentSearchResultsProps {
  /** What was typed, trimmed and not empty. */
  query: string;
}

/**
 * What a search found, best match first: each document with the passage that matched under its
 * title. Pressing one opens it.
 */
export function DocumentSearchResults({ query }: DocumentSearchResultsProps) {
  const navigate = useNavigate();
  const result = useQuery(SearchDocuments, { variables: { query } });
  const hits = result.data?.searchDocuments ?? [];

  return (
    <>
      <QueryState
        query={queryLike(result)}
        what="search results"
        count={hits.length}
        emptySlot={
          <EmptyState
            iconSlot={<Search />}
            title="Nothing matches"
            description={`No document's title or text matches “${query}”.`}
          />
        }
      />
      <List
        label={`Documents matching “${query}”`}
        contentSlot={hits.map(({ document, snippet }) => (
          <ListItem
            key={document.id}
            title={document.title}
            // Only the title matched, or the text is one line: the file name says which file it is.
            description={snippet || document.originalFilename}
            // The date on the document when there is one, which is the date a person searches by.
            meta={joinStats(formatCalendarDay(document.documentDate) || formatDate(document.createdAt))}
            onClick={() => navigate(documentPath(document.id))}
          />
        ))}
      />
    </>
  );
}
