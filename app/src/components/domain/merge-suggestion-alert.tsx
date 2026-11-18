import { Fragment } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Layers } from '@/components/ui/icons';
import { formatPercent } from '@/lib/merge-suggestions';
import { documentPath, mergeSuggestionPath } from '@/lib/routes';

/** What the alert says about a suggestion: which, how sure, and who else is in it. */
export interface SuggestionOfDocument {
  id: string;
  confidence: number;
  /** In page order, this document among them. */
  documents: ReadonlyArray<{ id: string; title: string }>;
}

interface MergeSuggestionAlertProps {
  /** The document the page is about. */
  documentId: string;
  /** The suggestions it is in, the surest first, as `mergeSuggestions.suggestions(documentId)` answers. */
  suggestions: readonly SuggestionOfDocument[];
}

/** "a, b and c", each a link to its page. */
function DocumentLinks({ documents }: { documents: SuggestionOfDocument['documents'] }) {
  const last = documents.length - 1;
  return documents.map((doc, index) => (
    <Fragment key={doc.id}>
      {index === 0 ? null : index === last ? ' and ' : ', '}
      <Link className="font-medium underline underline-offset-2" to={documentPath(doc.id)}>
        {doc.title}
      </Link>
    </Fragment>
  ));
}

/**
 * Says the document may be one page of a scan filed as several, and links to the suggestion's
 * review. Only the surest suggestion is named: the suggester puts a document in one at a time, and
 * the page of suggestions lists the rest. Draws nothing when there is none.
 */
export function MergeSuggestionAlert({ documentId, suggestions }: MergeSuggestionAlertProps) {
  const [suggestion] = suggestions;
  if (suggestion === undefined) {
    return null;
  }
  const others = suggestion.documents.filter((doc) => doc.id !== documentId);
  return (
    <Alert
      variant="info"
      iconSlot={<Layers />}
      title="This may be one scan filed as several"
      // One <p>, so the links run inline: the description is a flex column.
      description={
        <p>
          It may be part of a {suggestion.documents.length}-page scan with <DocumentLinks documents={others} /> (
          {formatPercent(suggestion.confidence)} sure).
        </p>
      }
      actionSlot={
        <Button
          variant="outline"
          iconSlot={<Layers />}
          content="Review merge"
          linkSlot={<Link to={mergeSuggestionPath(suggestion.id)} />}
        />
      }
    />
  );
}
