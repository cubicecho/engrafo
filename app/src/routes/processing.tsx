import { useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { graphql } from '@/__generated__';
import { type ProcessingQuery, ProcessingState } from '@/__generated__/graphql';
import { Activity } from '@/components/domain/app-icons';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Section } from '@/components/section';
import { StatTile } from '@/components/stat-tile';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleCheck, LoaderCircle, RefreshCw } from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';
import { ARCHIVE_QUERY_NAME, useArchive } from '@/lib/archive';
import { messageOf } from '@/lib/error-message';
import { folderPaths, TOP_LEVEL_LABEL } from '@/lib/folder-tree';
import { formatCount } from '@/lib/format';
import { FULL_WIDTH_BODY } from '@/lib/page';
import {
  entryLine,
  entryTime,
  PROCESSING_STATES,
  pollInterval,
  runningStep,
  type StateInfo,
  stateFromView,
  VIEW_PARAM,
} from '@/lib/processing';
import { queryLike } from '@/lib/query';
import { documentPath } from '@/lib/routes';
import { cn } from '@/lib/utils';

export const ProcessingPageQuery = graphql(`
  query Processing($state: ProcessingState!) {
    processing {
      concurrency
      finishedWithinHours
      listLimit
      counts {
        running
        queued
        failed
        finished
      }
      entries(state: $state) {
        finishedAt
        document {
          id
          title
          folderId
          status
          error
          updatedAt
        }
        steps {
          step
          status
          error
          progressDone
          progressTotal
          startedAt
        }
      }
    }
  }
`);

const RetryProcessing = graphql(`
  mutation RetryProcessing($id: UUID!) {
    retryDocumentProcessing(id: $id) {
      id
      status
      error
    }
  }
`);

type Row = ProcessingQuery['processing']['entries'][number];

// How often "For 2m" and "5m ago" are worked out again between polls.
const CLOCK_TICK_MS = 1000;

/** A clock that ticks, so the times on the rows move while the page sits open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// A step's progress is a fraction; the bar is in percent.
const PERCENT = 100;

/**
 * What the pipeline is doing with the caller's documents: a tile per state, and the list of the
 * one chosen, kept in `?view=` so it can be linked and survives a reload. Every row is a document
 * and opens its page. Polls quickly while something is running or queued, and slowly otherwise,
 * so work started elsewhere still shows up.
 */
export function ProcessingRoute() {
  const [params, setParams] = useSearchParams();
  const shown = stateFromView(params.get(VIEW_PARAM));
  const result = useQuery(ProcessingPageQuery, { variables: { state: shown.state } });
  const { startPolling, stopPolling } = result;
  const processing = result.data?.processing;
  const counts = processing?.counts;
  const busy = counts === undefined ? 0 : counts.running + counts.queued;
  const now = useNow();
  // Folder paths from the tree's own query and cache, as the trash names them.
  const { folders } = useArchive();
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  // Which row's Retry is waiting, since the mutation's own state does not say which one it was for.
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retry] = useMutation(RetryProcessing, {
    refetchQueries: ['Processing', ARCHIVE_QUERY_NAME],
    awaitRefetchQueries: true,
  });

  useEffect(() => {
    startPolling(pollInterval(busy));
    return () => stopPolling();
  }, [busy, startPolling, stopPolling]);

  const rows = processing?.entries ?? [];
  const show = (info: StateInfo) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(VIEW_PARAM, info.key);
        return next;
      },
      { replace: true },
    );

  async function retryRow(row: Row) {
    setFailure(null);
    setRetrying(row.document.id);
    try {
      await retry({ variables: { id: row.document.id } });
    } catch (error) {
      setFailure({
        title: `Could not retry “${row.document.title}”`,
        message: messageOf(error) ?? 'The server refused it',
      });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <PageLayout
      iconSlot={<Activity />}
      title="Processing"
      description={
        processing === undefined
          ? 'What the pipeline is doing with your documents.'
          : `What the pipeline is doing with your documents, ${formatCount(processing.concurrency, 'document')} at a time.`
      }
      width="full"
      contentClassName={cn(FULL_WIDTH_BODY, 'gap-6')}
      actionSlot={
        <Button
          size="sm"
          variant="outline"
          iconSlot={<RefreshCw />}
          content="Refresh"
          loading={result.loading && result.data !== undefined}
          onClick={() => void result.refetch()}
        />
      }
      contentSlot={
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PROCESSING_STATES.map((info) => {
              const count = counts?.[info.key];
              return (
                <StatTile
                  key={info.key}
                  label={info.label}
                  value={formatCount(count ?? 0)}
                  hint={
                    info.key === 'finished' && processing ? `In the last ${processing.finishedWithinHours}h` : undefined
                  }
                  loading={counts === undefined}
                  selected={shown.key === info.key}
                  onClick={() => show(info)}
                  iconSlot={
                    info.key === 'running' && (count ?? 0) > 0 ? <LoaderCircle className="animate-spin" /> : undefined
                  }
                  valueClassName={info.key === 'failed' && (count ?? 0) > 0 ? 'text-negative' : undefined}
                />
              );
            })}
          </div>

          {failure && <Alert variant="destructive" title={failure.title} description={failure.message} />}

          <Section
            title={shown.label}
            description={shown.blurb}
            contentSlot={
              <div className="flex flex-col gap-2">
                <QueryState
                  query={queryLike(result)}
                  what="the pipeline"
                  count={rows.length}
                  emptySlot={<EmptyState compact iconSlot={<CircleCheck />} title={shown.empty} />}
                />
                <List
                  label={shown.label}
                  contentSlot={rows.map((row) => (
                    <ProcessingRow
                      key={row.document.id}
                      row={row}
                      info={shown}
                      now={now}
                      folder={
                        row.document.folderId ? (paths.get(row.document.folderId) ?? 'Its folder') : TOP_LEVEL_LABEL
                      }
                      retrying={retrying === row.document.id}
                      onRetry={() => void retryRow(row)}
                    />
                  ))}
                />
                {processing && counts && rows.length < counts[shown.key] ? (
                  <p className="text-foreground/60 text-xs">
                    Showing the first {formatCount(processing.listLimit)} of {formatCount(counts[shown.key])}.
                  </p>
                ) : null}
              </div>
            }
          />
        </>
      }
    />
  );
}

interface ProcessingRowProps {
  row: Row;
  info: StateInfo;
  now: number;
  /** The folder it is filed in, by path. */
  folder: string;
  retrying: boolean;
  onRetry: () => void;
}

/** One document: where it is, how long it has been there, and Retry when it failed. */
function ProcessingRow({ row, info, now, folder, retrying, onRetry }: ProcessingRowProps) {
  const step = info.state === ProcessingState.Running ? runningStep(row) : undefined;
  const fraction =
    step?.progressDone != null && step.progressTotal ? Math.min(1, step.progressDone / step.progressTotal) : null;
  return (
    <div className="flex flex-col gap-1">
      <ListItem
        leadingSlot={<Badge variant={info.tone}>{info.label}</Badge>}
        title={row.document.title}
        linkSlot={<Link to={documentPath(row.document.id)} />}
        description={entryLine(info.state, row) ?? folder}
        meta={entryTime(info.state, row, now)}
        actionSlot={
          info.state === ProcessingState.Failed ? (
            <Button
              size="sm"
              variant="outline"
              iconSlot={<RefreshCw />}
              content="Retry"
              aria-label={`Retry “${row.document.title}”`}
              loading={retrying}
              onClick={onRetry}
            />
          ) : undefined
        }
      />
      {fraction !== null ? (
        <Progress value={fraction * PERCENT} label={`${row.document.title} progress`} className="mx-3" />
      ) : null}
    </div>
  );
}
