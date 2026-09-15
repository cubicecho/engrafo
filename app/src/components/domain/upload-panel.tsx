import { useMutation } from '@apollo/client/react';
import { Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { graphql } from '@/__generated__';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
  const ocrId = useId();
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
            // Browsers leave the type blank for extensions they do not know;
            // the server's allowlist says no with a clearer message than S3 would.
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            ocr,
          },
        },
      });
      if (!data) throw new Error('The server did not answer');
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
    if (!files || files.length === 0) return;
    const added = Array.from(files).map((file) => ({
      file,
      job: { key: clientId(), name: file.name, size: file.size, progress: 0, error: null, done: false },
    }));
    setJobs((current) => [...added.map(({ job }) => job), ...current.filter((job) => !job.done)]);
    for (const { file, job } of added) void uploadOne(file, job);
  }

  return (
    <Card className="gap-4 p-4">
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
          'flex w-full flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-muted-foreground text-sm transition-colors hover:bg-accent/50',
          dragging && 'border-primary bg-accent',
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

      <div className="flex items-center gap-2">
        <Switch id={ocrId} checked={ocr} onCheckedChange={setOcr} disabled={!config.ocrAvailable} />
        <Label htmlFor={ocrId}>Run OCR on new uploads</Label>
        {!config.ocrAvailable && (
          <span className="text-muted-foreground text-xs">(ocrmypdf is not installed on the server)</span>
        )}
      </div>

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.key} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{job.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                  {job.error ? 'Failed' : job.done ? 'Uploaded' : `${Math.round(job.progress * 100)}%`}
                  {(job.done || job.error) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Dismiss ${job.name}`}
                      onClick={() => setJobs((current) => current.filter((j) => j.key !== job.key))}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </span>
              </div>
              <Progress value={job.progress * 100} aria-label={`${job.name} upload progress`} />
              {job.error && <p className="text-destructive text-xs">{job.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
