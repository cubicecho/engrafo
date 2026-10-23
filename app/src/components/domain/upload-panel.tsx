import { useMutation, useQuery } from '@apollo/client/react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { graphql } from '@/__generated__';
import { DocumentStatusEnum } from '@/__generated__/graphql';
import { CardLayout } from '@/components/card-layout';
import { Combobox } from '@/components/combobox';
import { DuplicateLinks } from '@/components/domain/duplicate-alert';
import { FormField } from '@/components/form-field';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Button } from '@/components/ui/button';
import { FilePicker } from '@/components/ui/file-picker';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { X } from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';
import { SwitchField } from '@/components/ui/switch-field';
import { POLLING_DEFAULTS } from '@/defaults';
import { type FolderRow, folderOptions, TOP_LEVEL } from '@/lib/folder-tree';
import { formatBytes } from '@/lib/format';
import { clientId } from '@/lib/id';
import { documentPath } from '@/lib/routes';
import { putFile, uploadMimeType } from '@/lib/upload';

const CreateUpload = graphql(`
  mutation CreateDocumentUpload($input: CreateDocumentUploadInput!) {
    createDocumentUpload(input: $input) {
      document {
        id
      }
      uploadUrl
      uploadHeaders {
        name
        value
      }
    }
  }
`);

const CompleteUpload = graphql(`
  mutation CompleteDocumentUpload($id: UUID!) {
    completeDocumentUpload(id: $id) {
      id
      status
    }
  }
`);

// Asked about every finished upload at once, so a dropped folder is one request per poll, not
// one per file. The checksum is the pipeline's first step and lands after the upload is done,
// so this is polled until each one is in.
const UploadDuplicates = graphql(`
  query UploadDuplicates($ids: [UUID!]!) {
    documentDuplicates(ids: $ids) {
      document {
        id
        status
      }
      checked
      duplicates {
        id
        title
        folderId
      }
    }
  }
`);

// A job's progress is a fraction; the bar and its label are in percent.
const PERCENT = 100;

interface Job {
  key: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  done: boolean;
  /** The document the upload made, once the server has made it. */
  documentId: string | null;
}

interface UploadPanelProps {
  /** What the server will accept, as `serverConfig` reports it. */
  config: { maxUploadBytes: number; acceptedMimeTypes: string[]; ocrAvailable: boolean; ocrDefault: boolean };
  /** Every folder the caller has, for the "Upload into" picker. */
  folders: readonly FolderRow[];
  /** The folder new uploads are filed in, or null for the top level. */
  folderId: string | null;
  onFolderChange: (folderId: string | null) => void;
  /** Called whenever a document changes state, so the list can refetch. */
  onChanged: () => void;
}

/**
 * The dropzone, the OCR switch and a row per file being uploaded.
 *
 * Each file is signed for, PUT straight to the bucket and then confirmed, and a
 * failure at any of the three is shown on that file's row.
 */
export function UploadPanel({ config, folders, folderId, onFolderChange, onChanged }: UploadPanelProps) {
  const ocrId = useId();
  const [ocr, setOcr] = useState(config.ocrAvailable && config.ocrDefault);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [createUpload] = useMutation(CreateUpload);
  const [completeUpload] = useMutation(CompleteUpload);

  const uploadedIds = jobs.flatMap((job) => (job.done && job.documentId ? [job.documentId] : []));
  const duplicatesResult = useQuery(UploadDuplicates, {
    variables: { ids: uploadedIds },
    skip: uploadedIds.length === 0,
  });
  const { startPolling, stopPolling } = duplicatesResult;
  const checks = duplicatesResult.data?.documentDuplicates ?? [];
  // Still waiting while a file has no checksum yet, unless the pipeline gave up on it before it had
  // one. A lookup that failed stops too: the warning is a courtesy, not worth asking for every 3s.
  const waiting =
    uploadedIds.length > 0 &&
    duplicatesResult.error === undefined &&
    uploadedIds.some((id) => {
      const check = checks.find((entry) => entry.document.id === id);
      return check === undefined || (check.checked === false && check.document.status !== DocumentStatusEnum.Failed);
    });
  useEffect(() => {
    if (waiting) {
      startPolling(POLLING_DEFAULTS.intervalMs);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [waiting, startPolling, stopPolling]);

  const update = (key: string, patch: Partial<Job>) =>
    setJobs((current) => current.map((job) => (job.key === key ? { ...job, ...patch } : job)));

  async function uploadOne(file: PickedFile, job: Job) {
    try {
      // `read="none"` hands back the browser's own handle, so a 100 MB scan is streamed and never held.
      if (!file.blob) {
        throw new Error('The browser did not hand over the file');
      }
      if (file.size > config.maxUploadBytes) {
        throw new Error(`Larger than the ${formatBytes(config.maxUploadBytes)} limit`);
      }
      const { data } = await createUpload({
        variables: {
          input: {
            filename: file.name,
            mimeType: uploadMimeType(file),
            sizeBytes: file.size,
            ocr,
            folderId,
          },
        },
      });
      if (!data) {
        throw new Error('The server did not answer');
      }
      const { document, uploadUrl, uploadHeaders } = data.createDocumentUpload;
      onChanged();

      await putFile(uploadUrl, file.blob, uploadHeaders, (progress) => update(job.key, { progress }));
      await completeUpload({ variables: { id: document.id } });
      update(job.key, { done: true, progress: 1, documentId: document.id });
      onChanged();
    } catch (error) {
      update(job.key, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function start(files: PickedFile[]) {
    const added = files.map((file) => ({
      file,
      job: {
        key: clientId(),
        name: file.name,
        size: file.size,
        progress: 0,
        error: null,
        done: false,
        documentId: null,
      },
    }));
    setJobs((current) => [...added.map(({ job }) => job), ...current.filter((job) => !job.done)]);
    for (const { file, job } of added) {
      void uploadOne(file, job);
    }
  }

  return (
    <CardLayout
      contentClassName="gap-4"
      contentSlot={
        <>
          <FilePicker
            label="Drop files here, or click to choose"
            hint={`PDF, images, text, Markdown, CSV, HTML or EPUB · up to ${formatBytes(config.maxUploadBytes)} each`}
            // No `accept`: the picker skips a file that does not match without a word, where the
            // server's allowlist refuses it on the file's own row and says why.
            multiple
            read="none"
            onPickMany={start}
          />

          <FormField
            label="Upload into"
            controlSlot={(props) => (
              <Combobox
                {...props}
                options={folderOptions(folders)}
                value={folderId ?? TOP_LEVEL}
                onValueChange={(value) => onFolderChange(value === TOP_LEVEL ? null : value)}
                searchable
                searchPlaceholder="Find a folder"
              />
            )}
          />

          <SwitchField
            id={ocrId}
            label="Run OCR on new uploads"
            description={config.ocrAvailable ? undefined : 'ocrmypdf is not installed on the server.'}
            checked={ocr}
            onCheckedChange={setOcr}
            disabled={!config.ocrAvailable}
          />

          <List
            label="Uploads"
            divided={false}
            contentSlot={jobs.map((job) => {
              const duplicates = checks.find((entry) => entry.document.id === job.documentId)?.duplicates ?? [];
              return (
                <div key={job.key} className="flex flex-col gap-1">
                  <ListItem
                    className="p-0"
                    title={job.name}
                    meta={job.error ? 'Failed' : job.done ? 'Uploaded' : `${Math.round(job.progress * PERCENT)}%`}
                    actionSlot={
                      job.done || job.error ? (
                        <Button
                          aria-label={`Dismiss ${job.name}`}
                          variant="outline"
                          size="icon-xs"
                          iconSlot={<X />}
                          onClick={() => setJobs((current) => current.filter((j) => j.key !== job.key))}
                        />
                      ) : null
                    }
                  />
                  <Progress value={job.progress * PERCENT} label={`${job.name} upload progress`} />
                  {job.error && <p className="text-negative text-xs">{job.error}</p>}
                  {job.documentId && duplicates.length > 0 ? (
                    // A warning, not a failure: the upload stands, and the reader decides which to keep.
                    <p className="text-warning text-xs">
                      Already in your archive as <DuplicateLinks duplicates={duplicates} folders={folders} />.{' '}
                      <Link className="underline underline-offset-2" to={documentPath(job.documentId)}>
                        Open this copy
                      </Link>{' '}
                      to delete it.
                    </p>
                  ) : null}
                </div>
              );
            })}
          />
        </>
      }
    />
  );
}
