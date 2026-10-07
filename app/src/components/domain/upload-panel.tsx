import { useMutation } from '@apollo/client/react';
import { useRef, useState } from 'react';
import { graphql } from '@/__generated__';
import { ActionButton } from '@/components/action-button';
import { CardLayout } from '@/components/card-layout';
import { FormField } from '@/components/form-field';
import { ListItem } from '@/components/list-item';
import { Upload, X } from '@/components/ui/icons';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/format';
import { clientId } from '@/lib/id';
import { putFile } from '@/lib/upload';
import { cn } from '@/lib/utils';

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
  config: { maxUploadBytes: number; acceptedMimeTypes: string[]; ocrAvailable: boolean; ocrDefault: boolean };
  /** Called whenever a document changes state, so the list can refetch. */
  onChanged: () => void;
}

export function UploadPanel({ config, onChanged }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocr, setOcr] = useState(config.ocrAvailable && config.ocrDefault);
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [createUpload] = useMutation(CreateUpload);
  const [completeUpload] = useMutation(CompleteUpload);

  const update = (key: string, patch: Partial<Job>) =>
    setJobs((current) => current.map((job) => (job.key === key ? { ...job, ...patch } : job)));

  async function uploadOne(file: File, job: Job) {
    try {
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

      await putFile(uploadUrl, file, uploadHeaders, (progress) => update(job.key, { progress }));
      await completeUpload({ variables: { id: document.id } });
      update(job.key, { done: true, progress: 1 });
      onChanged();
    } catch (error) {
      update(job.key, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  function start(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const added = Array.from(files).map((file) => ({
      file,
      job: { key: clientId(), name: file.name, size: file.size, progress: 0, error: null, done: false },
    }));
    setJobs((current) => [...added.map(({ job }) => job), ...current.filter((job) => !job.done)]);
    for (const { file, job } of added) {
      void uploadOne(file, job);
    }
  }

  const dropZone = (
    // Hand-built rather than cubeui's `FilePicker`, which reads each file into
    // memory and hands back its bytes. These go straight to the bucket as the
    // browser's own `File`, so a 100 MB scan is streamed and never held.
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          start(event.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-md border border-foreground/15 border-dashed px-4 py-8 text-foreground/60 text-sm transition-colors hover:bg-hover',
          dragging && 'border-active bg-hover',
        )}
      >
        <Upload className="size-6" aria-hidden />
        <span>
          Drop files here, or <span className="font-medium text-foreground underline">choose files</span>
        </span>
        <span className="text-xs">PDF, images or text · up to {formatBytes(config.maxUploadBytes)} each</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={config.acceptedMimeTypes.join(',')}
        onChange={(event) => {
          start(event.target.files);
          event.target.value = '';
        }}
      />
    </>
  );

  return (
    <CardLayout
      // A card with no header has no top padding of its own (CardContent is `p-6 pt-0`).
      contentClassName="gap-4 pt-6"
      contentSlot={
        <>
          {dropZone}

          <FormField
            orientation="horizontal"
            label="Run OCR on new uploads"
            description={config.ocrAvailable ? undefined : 'ocrmypdf is not installed on the server.'}
            controlSlot={<Switch checked={ocr} onCheckedChange={setOcr} disabled={!config.ocrAvailable} />}
          />

          {jobs.length > 0 && (
            <ul className="flex flex-col gap-3">
              {jobs.map((job) => (
                <li key={job.key} className="flex flex-col gap-1">
                  <ListItem
                    className="p-0"
                    title={job.name}
                    meta={job.error ? 'Failed' : job.done ? 'Uploaded' : `${Math.round(job.progress * PERCENT)}%`}
                    actionSlot={
                      job.done || job.error ? (
                        <ActionButton
                          label={`Dismiss ${job.name}`}
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
                </li>
              ))}
            </ul>
          )}
        </>
      }
    />
  );
}
