import { useMutation, useQuery } from '@apollo/client/react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import type { MergeSuggestionCardFragment } from '@/__generated__/graphql';
import {
  MergeDocumentsDialog,
  MergeDocumentsMutation,
  type MergeRequest,
  mergeRefetchQueries,
} from '@/components/domain/merge-documents-dialog';
import { MergeSuggestionCard } from '@/components/domain/merge-suggestion-card';
import { EmptyState } from '@/components/empty-state';
import { LoadState } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CircleCheck, Layers, RefreshCw } from '@/components/ui/icons';
import { useArchive } from '@/lib/archive';
import { messageOf } from '@/lib/error-message';
import { type FolderRow, folderPaths } from '@/lib/folder-tree';
import type { MergeCandidate } from '@/lib/merge';
import { MERGE_SUGGESTION_QUERY_NAMES } from '@/lib/merge-suggestions';
import { FULL_WIDTH_BODY } from '@/lib/page';
import { queryLike } from '@/lib/query';
import { documentPath, REVIEW_PARAM } from '@/lib/routes';
import { useThumbnailUrls } from '@/lib/thumbnails';
import { cn } from '@/lib/utils';

export const MergeSuggestionsPage = graphql(`
  query MergeSuggestions {
    serverConfig {
      visionAvailable
      mergeAvailable
    }
    mergeSuggestions {
      suggestions {
        ...MergeSuggestionCard
      }
    }
  }
`);

const DismissMergeSuggestion = graphql(`
  mutation DismissMergeSuggestion($id: UUID!) {
    dismissMergeSuggestion(id: $id)
  }
`);

const RescoreMergeSuggestions = graphql(`
  mutation RescoreMergeSuggestions {
    rescoreMergeSuggestions {
      count
    }
  }
`);

/** Every write here changes which suggestions are shown, and the badge with them. */
const REFETCH = { refetchQueries: [...MERGE_SUGGESTION_QUERY_NAMES], awaitRefetchQueries: true };

interface ReviewMergeDialogProps {
  suggestion: MergeSuggestionCardFragment;
  folders: readonly FolderRow[];
  visionAvailable: boolean;
  onMerge: (request: MergeRequest) => Promise<unknown>;
  onClose: () => void;
}

/**
 * The merge dialog, filled in with a suggestion's documents in the order it suggests. The order
 * and the set are the dialog's to change from there: what is merged is what the dialog sends.
 */
function ReviewMergeDialog({ suggestion, folders, visionAvailable, onMerge, onClose }: ReviewMergeDialogProps) {
  const [documents, setDocuments] = useState<MergeCandidate[]>(() =>
    suggestion.documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      folderId: doc.folderId,
      sizeBytes: doc.sizeBytes,
      archiveKey: doc.archiveKey,
    })),
  );
  return (
    <MergeDocumentsDialog
      documents={documents}
      folders={folders}
      visionAvailable={visionAvailable}
      onDocumentsChange={setDocuments}
      onMerge={onMerge}
      onClose={onClose}
    />
  );
}

/**
 * Suggested merges: sets of documents that look like one scan filed as several, the surest first,
 * each a card with its pages, how sure and why. Review merge opens the merge dialog filled in
 * (`?review=<id>` opens it from a link, as the document page's alert does); Dismiss says not to
 * suggest that set again; Check again scores everything now instead of after the next upload.
 */
export function MergeSuggestionsRoute() {
  const [params, setParams] = useSearchParams();
  const result = useQuery(MergeSuggestionsPage);
  // The sidebar's query, answered from the cache, for each document's folder path.
  const { folders } = useArchive();
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const suggestions = result.data?.mergeSuggestions.suggestions ?? [];
  const server = result.data?.serverConfig;
  const thumbnails = useThumbnailUrls(suggestions.flatMap((suggestion) => suggestion.documents.map((doc) => doc.id)));

  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [merged, setMerged] = useState<{ id: string; title: string } | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismiss] = useMutation(DismissMergeSuggestion, REFETCH);
  const [rescore, rescoreState] = useMutation(RescoreMergeSuggestions, REFETCH);
  const [mergeDocuments] = useMutation(MergeDocumentsMutation);

  const reviewId = params.get(REVIEW_PARAM);
  // A link to one that has gone since (merged, dismissed, a page trashed) opens nothing.
  const reviewing = suggestions.find((suggestion) => suggestion.id === reviewId);
  const setReviewId = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id === null) {
          next.delete(REVIEW_PARAM);
        } else {
          next.set(REVIEW_PARAM, id);
        }
        return next;
      },
      { replace: true },
    );

  async function run(title: string, write: () => Promise<unknown>) {
    setFailure(null);
    try {
      await write();
    } catch (error) {
      setFailure({ title, message: messageOf(error) ?? 'The server refused it' });
    }
  }

  async function dismissOne(id: string) {
    setDismissingId(id);
    await run('Could not dismiss the suggestion', () => dismiss({ variables: { id } }));
    setDismissingId(null);
  }

  // Rejects for the dialog to say why; it closes on its own once this resolves.
  async function merge(request: MergeRequest) {
    setMerged(null);
    const { data } = await mergeDocuments({
      variables: { input: request },
      refetchQueries: mergeRefetchQueries(request),
      awaitRefetchQueries: true,
    });
    if (data) {
      setMerged(data.mergeDocuments);
    }
  }

  return (
    <>
      <PageLayout
        iconSlot={<Layers />}
        title="Suggested merges"
        description="Documents that look like one scan filed a page at a time. Nothing is merged until you review it."
        width="full"
        contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
        actionSlot={
          <Button
            size="sm"
            variant="outline"
            iconSlot={<RefreshCw />}
            content="Check again"
            loading={rescoreState.loading}
            loadingLabel="Checking…"
            hint="Score your recent documents now, and have the vision model check the unsure ones"
            onClick={() => void run('Could not check again', () => rescore())}
          />
        }
        contentSlot={
          <>
            {failure && <Alert variant="destructive" title={failure.title} description={failure.message} />}
            {merged && (
              <Alert
                iconSlot={<CircleCheck />}
                title="Merged"
                description={
                  <p>
                    The pages are filed as{' '}
                    <Link className="font-medium underline underline-offset-2" to={documentPath(merged.id)}>
                      {merged.title}
                    </Link>
                    , with the text already read from them.
                  </p>
                }
              />
            )}
            <LoadState
              query={queryLike(result)}
              what="your suggested merges"
              count={suggestions.length}
              emptySlot={
                <EmptyState
                  iconSlot={<Layers />}
                  title="Nothing to merge"
                  description="When documents look like one scan filed a page at a time, they are suggested here, about a minute after the last one is processed."
                />
              }
            />
            {suggestions.map((suggestion) => (
              <MergeSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                folderPaths={paths}
                thumbnails={thumbnails}
                mergeAvailable={server?.mergeAvailable === true}
                dismissing={dismissingId === suggestion.id}
                onReview={() => setReviewId(suggestion.id)}
                onDismiss={() => void dismissOne(suggestion.id)}
              />
            ))}
          </>
        }
      />
      {reviewing && server?.mergeAvailable === true && (
        <ReviewMergeDialog
          key={reviewing.id}
          suggestion={reviewing}
          folders={folders}
          visionAvailable={server.visionAvailable}
          onMerge={merge}
          onClose={() => setReviewId(null)}
        />
      )}
    </>
  );
}
