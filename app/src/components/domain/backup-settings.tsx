import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useState } from 'react';
import { graphql } from '@/__generated__';
import { type ImportJobFieldsFragment, ImportState } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { Disclosure } from '@/components/disclosure';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { downloadUrl } from '@/components/ui/download-button';
import { FilePicker } from '@/components/ui/file-picker';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { Download } from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';
import { POLLING_DEFAULTS } from '@/defaults';
import { messageOf } from '@/lib/error-message';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';
import { putFile } from '@/lib/upload';

// Settings' Backup tab: the whole archive out as one tar, and an export back in. Neither passes
// the bytes through GraphQL. The export is a single-use link the browser follows and streams to
// disk itself, because a session is a bearer token a plain link cannot carry; the import is PUT
// straight to the bucket, then read there by the server in the background while this polls.

const ImportJobFields = graphql(`
  fragment ImportJobFields on ImportJob {
    id
    state
    total
    imported
    skipped {
      title
      reason
    }
    failed {
      title
      reason
    }
    error
    startedAt
    finishedAt
  }
`);

export const LatestImport = graphql(`
  query LatestImport {
    latestImport {
      ...ImportJobFields
    }
  }
`);

export const CreateExportLink = graphql(`
  mutation CreateExportLink {
    createExportLink {
      path
      expiresAt
    }
  }
`);

export const CreateImportUpload = graphql(`
  mutation CreateImportUpload($sizeBytes: Float!) {
    createImportUpload(sizeBytes: $sizeBytes) {
      key
      uploadUrl
      uploadHeaders {
        name
        value
      }
    }
  }
`);

export const StartImport = graphql(`
  mutation StartImport($key: String!) {
    importArchive(key: $key) {
      ...ImportJobFields
    }
  }
`);

const PERCENT = 100;

/** The name a download is saved as, matching what the server's own header says. */
export function exportFilename(now: Date): string {
  return `engrafo-export-${now.toISOString().slice(0, 10)}.tar`;
}

/** Hands a minted export link to the browser to save: `downloadUrl`, unless a story says otherwise. */
export type SaveExport = (path: string, filename: string) => Promise<void>;

interface ExportCardProps {
  /** Left out, the browser's own download. A story passes a spy: a real download ends its page. */
  saveExport?: SaveExport | undefined;
}

/** The export card: one button, which mints a link and hands it to the browser. */
export function ExportCard({ saveExport = downloadUrl }: ExportCardProps) {
  const [createLink, { loading }] = useMutation(CreateExportLink);
  const [error, setError] = useState<string | undefined>();

  async function download() {
    setError(undefined);
    try {
      const { data } = await createLink();
      if (!data) {
        throw new Error('The server returned no link');
      }
      await saveExport(data.createExportLink.path, exportFilename(new Date()));
    } catch (failure) {
      setError(messageOf(failure) ?? 'The server refused it');
    }
  }

  return (
    <CardLayout
      level={2}
      title="Export"
      description="Every original you uploaded, the searchable PDF and the text read from each, and a metadata.json with titles, folders, dates, receipts and checksums — one .tar, for a backup or for leaving."
      contentSlot={
        error ? <Alert variant="destructive" title="Could not start the export" description={error} /> : null
      }
      footerActionsSlot={
        <Button iconSlot={<Download />} content="Download export" loading={loading} onClick={() => void download()} />
      }
    />
  );
}

/** What an import did, as it stands. */
export function ImportSummary({ job }: { job: ImportJobFieldsFragment }) {
  const running = job.state === ImportState.Running;
  const done = job.imported + job.skipped.length + job.failed.length;
  return (
    <div className="flex flex-col gap-4">
      {running ? (
        <Progress
          value={job.total ? (done / job.total) * PERCENT : null}
          label="Import progress"
          valueLabel={job.total ? `${done} of ${job.total} documents` : undefined}
        />
      ) : null}
      {job.error ? <Alert variant="destructive" title="The import stopped" description={job.error} /> : null}
      <DescriptionList
        contentSlot={
          <>
            <PropertyRow
              label="Status"
              value={running ? 'Importing…' : job.state === ImportState.Done ? 'Finished' : 'Stopped'}
            />
            <PropertyRow label="Started" value={formatDateTime(job.startedAt)} />
            <PropertyRow label="Imported" value={formatCount(job.imported, 'document')} />
            <PropertyRow
              label="Skipped"
              value={formatCount(job.skipped.length, 'document')}
              hint="Already in your archive, by checksum."
            />
            <PropertyRow label="Failed" value={formatCount(job.failed.length, 'item')} />
          </>
        }
      />
      {job.failed.length > 0 ? <ImportItems title={`Failed (${job.failed.length})`} items={job.failed} /> : null}
      {job.skipped.length > 0 ? <ImportItems title={`Skipped (${job.skipped.length})`} items={job.skipped} /> : null}
    </div>
  );
}

function ImportItems({ title, items }: { title: string; items: ImportJobFieldsFragment['failed'] }) {
  return (
    <Disclosure
      title={title}
      contentSlot={
        <List
          label={title}
          contentSlot={items.map((item, index) => (
            // Two documents may share a title in different folders, so the index keeps them apart.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
            <ListItem key={`${item.title}-${index}`} title={item.title} description={item.reason} />
          ))}
        />
      }
    />
  );
}

interface ImportCardProps {
  /** `serverConfig.maxImportBytes`. */
  maxImportBytes: number;
}

/** The import card: pick an export, watch it upload, then watch the server read it. */
export function ImportCard({ maxImportBytes }: ImportCardProps) {
  const client = useApolloClient();
  const latest = useQuery(LatestImport);
  const { startPolling, stopPolling } = latest;
  const [createUpload] = useMutation(CreateImportUpload);
  const [startImport] = useMutation(StartImport);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [error, setError] = useState<string | undefined>();

  const job = latest.data?.latestImport ?? null;
  const running = job?.state === ImportState.Running;
  useEffect(() => {
    if (running) {
      startPolling(POLLING_DEFAULTS.intervalMs);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [running, startPolling, stopPolling]);

  async function importFile(file: PickedFile) {
    setError(undefined);
    if (file.size > maxImportBytes) {
      setError(`${file.name} is ${formatBytes(file.size)}; an import takes up to ${formatBytes(maxImportBytes)}.`);
      return;
    }
    try {
      if (!file.blob) {
        throw new Error('The browser did not hand over the file');
      }
      setUpload({ name: file.name, progress: 0 });
      const { data } = await createUpload({ variables: { sizeBytes: file.size } });
      if (!data) {
        throw new Error('The server returned no upload');
      }
      const { key, uploadUrl, uploadHeaders } = data.createImportUpload;
      await putFile(uploadUrl, file.blob, uploadHeaders, (progress) => setUpload({ name: file.name, progress }));
      const started = await startImport({ variables: { key } });
      if (started.data) {
        client.writeQuery({ query: LatestImport, data: { latestImport: started.data.importArchive } });
      }
    } catch (failure) {
      setError(messageOf(failure) ?? 'The import could not start');
    } finally {
      setUpload(null);
    }
  }

  return (
    <CardLayout
      level={2}
      title="Import"
      description="Reads an export back in, from this instance or another. Folders are made where missing, a document already here is skipped, and each new one is processed like an upload."
      contentClassName="gap-4"
      contentSlot={
        <>
          {upload ? (
            <Progress
              value={upload.progress * PERCENT}
              label={`${upload.name} upload progress`}
              valueLabel={`${Math.round(upload.progress * PERCENT)}%`}
            />
          ) : running ? null : (
            <FilePicker
              label="Drop an export here, or click to choose"
              hint={`An Engrafo .tar (or .tar.gz) · up to ${formatBytes(maxImportBytes)}`}
              // No `accept`, as on the upload panel: the picker drops a file that does not match without
              // a word, where the server refuses anything that is not an export and says why.
              read="none"
              onPickMany={([file]) => {
                if (file) {
                  void importFile(file);
                }
              }}
            />
          )}
          {error ? <Alert variant="destructive" title="Could not import" description={error} /> : null}
          {job ? <ImportSummary job={job} /> : null}
        </>
      }
    />
  );
}

interface BackupSettingsProps {
  maxImportBytes: number;
  saveExport?: SaveExport | undefined;
}

/** Settings' Backup tab. */
export function BackupSettings({ maxImportBytes, saveExport }: BackupSettingsProps) {
  return (
    <>
      <ExportCard saveExport={saveExport} />
      <ImportCard maxImportBytes={maxImportBytes} />
    </>
  );
}

export { ImportJobFields };
