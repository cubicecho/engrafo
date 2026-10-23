import { useMutation } from '@apollo/client/react';
import { useId, useState } from 'react';
import { graphql } from '@/__generated__';
import { CardLayout } from '@/components/card-layout';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Button } from '@/components/ui/button';
import { FilePicker } from '@/components/ui/file-picker';
import type { PickedFile } from '@/components/ui/file-picker-base';
import { X } from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';
import { SwitchField } from '@/components/ui/switch-field';
import { formatBytes } from '@/lib/format';
import { clientId } from '@/lib/id';
import { putFile } from '@/lib/upload';

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

// Browsers leave the type blank for extensions they do not know; the server's
// allowlist says no with a clearer message than S3 would.
const UNKNOWN_MIME_TYPE = 'application/octet-stream';

// A job's progress is a fraction; the bar and its label are in percent.
const PERCENT = 100;

interface Job {
  key: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  done: boolean;
}

interface UploadPanelProps {
  /** What the server will accept, as `serverConfig` reports it. */
  config: { maxUploadBytes: number; acceptedMimeTypes: string[]; ocrAvailable: boolean; ocrDefault: boolean };
  /** Called whenever a document changes state, so the list can refetch. */
  onChanged: () => void;
}

/**
 * The dropzone, the OCR switch and a row per file being uploaded.
 *
 * Each file is signed for, PUT straight to the bucket and then confirmed, and a
 * failure at any of the three is shown on that file's row.
 */
export function UploadPanel({ config, onChanged }: UploadPanelProps) {
  const ocrId = useId();
  const [ocr, setOcr] = useState(config.ocrAvailable && config.ocrDefault);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [createUpload] = useMutation(CreateUpload);
  const [completeUpload] = useMutation(CompleteUpload);

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
            mimeType: file.type || UNKNOWN_MIME_TYPE,
            sizeBytes: file.size,
            ocr,
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
      update(job.key, { done: true, progress: 1 });
      onChanged();
    } catch (error) {
      update(job.key, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function start(files: PickedFile[]) {
    const added = files.map((file) => ({
      file,
      job: { key: clientId(), name: file.name, size: file.size, progress: 0, error: null, done: false },
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
            hint={`PDF, images or text · up to ${formatBytes(config.maxUploadBytes)} each`}
            // No `accept`: the picker skips a file that does not match without a word, where the
            // server's allowlist refuses it on the file's own row and says why.
            multiple
            read="none"
            onPickMany={start}
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
            contentSlot={jobs.map((job) => (
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
              </div>
            ))}
          />
        </>
      }
    />
  );
}
