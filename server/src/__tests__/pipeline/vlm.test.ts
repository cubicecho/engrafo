import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resetAll } from '@cubicecho/agent-core';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, describe, expect, it } from 'vitest';
import type { VlmConfig } from '../../core/config.ts';
import { pageInput, rasterArgs, vlmStep } from '../../pipeline/steps/vlm.ts';
import type { PipelineConfig } from '../../pipeline/types.ts';
import { createFakeStorage } from '../helpers.ts';

const exec = promisify(execFile);

/**
 * A real OpenAI-compatible server on an ephemeral port, rather than a mocked
 * `ask`. What is worth proving here is that a page reaches the wire as an
 * `image_url` part at all — which a stub standing in for the one function that
 * builds the request cannot say anything about.
 */
async function fakeEndpoint(reply: (body: OpenAIRequest) => string | { status: number }) {
  const bodies: OpenAIRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as OpenAIRequest;
      bodies.push(body);
      const answer = reply(body);
      if (typeof answer !== 'string') {
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'nope' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'test-vlm',
          choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const config: VlmConfig = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: '',
    model: 'test-vlm',
    requestTimeoutSeconds: 30,
  };
  return { config, bodies, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

interface OpenAIRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; image_url?: { url: string } }> }>;
}

const VLM: VlmConfig = { baseUrl: 'http://box/v1', apiKey: '', model: 'test-vlm', requestTimeoutSeconds: 30 };
const CONFIG: PipelineConfig = { ocrAvailable: true, ocrLanguages: 'eng', concurrency: 1, vlm: VLM };

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    title: 'Scan',
    originalFilename: 'scan.png',
    mimeType: 'image/png',
    sizeBytes: 1,
    checksumSha256: null,
    originalKey: 'originals/u/scan',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    ocrRequested: true,
    status: 'processing',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

/** A 1x1 PNG, enough to be a page as far as anything under test is concerned. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A run with the page already in the bucket and a scratch directory of its own. */
async function runStep(config: PipelineConfig, document: Document = doc()) {
  const storage = createFakeStorage();
  storage.files.objects.set(document.originalKey, { body: PIXEL, contentType: document.mimeType });
  const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-vlm-test-'));
  try {
    const patch = await vlmStep.run({ doc: document, db: null as never, storage, config, tmpDir });
    return { patch, storage };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetAll();
});

describe('vlm step', () => {
  it('runs only when OCR was asked for, an endpoint is configured, and the file is a PDF or image', () => {
    expect(vlmStep.enabled(doc(), CONFIG)).toBe(true);
    expect(vlmStep.enabled(doc({ ocrRequested: false }), CONFIG)).toBe(false);
    expect(vlmStep.enabled(doc(), { ...CONFIG, vlm: null })).toBe(false);
    expect(vlmStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
  });

  it('does not wait on ocrmypdf being installed', () => {
    // The two are independent: an endpoint can read pages on a host with no
    // ocrmypdf, it just leaves the document without a PDF/A archive.
    expect(vlmStep.enabled(doc(), { ...CONFIG, ocrAvailable: false })).toBe(true);
  });

  it('asks Ghostscript for one page more than the cap, so "at the cap" is distinguishable', () => {
    const args = rasterArgs('in.pdf', '/tmp/page-%04d.png', 201, 200);
    expect(args).toContain('-r200');
    expect(args).toContain('-dLastPage=201');
    expect(args).toContain('-sOutputFile=/tmp/page-%04d.png');
    expect(args.at(-1)).toBe('in.pdf');
  });

  it('sends the page as a data URL carrying its own media type', () => {
    const parts = pageInput(PIXEL, 'image/jpeg');
    expect(parts).toEqual([
      { type: 'text', text: 'Transcribe this page.' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PIXEL.toString('base64')}` } },
    ]);
  });
});

describe('vlm step against an OpenAI-compatible endpoint', () => {
  it('shows the page to the model and stores what comes back', async () => {
    const endpoint = await fakeEndpoint(() => 'INVOICE 4821\nDue on receipt');
    try {
      const { patch, storage } = await runStep({ ...CONFIG, vlm: endpoint.config });

      expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('INVOICE 4821\nDue on receipt');
      expect(patch?.contentBytes).toBe(27);

      // The image actually left the process, as a content part, on the user turn.
      const parts = endpoint.bodies[0].messages.at(-1)?.content;
      expect(Array.isArray(parts)).toBe(true);
      expect((parts as Array<{ type: string }>).map((part) => part.type)).toEqual(['text', 'image_url']);
      expect((parts as Array<{ image_url?: { url: string } }>)[1].image_url?.url).toBe(
        `data:image/png;base64,${PIXEL.toString('base64')}`,
      );
    } finally {
      await endpoint.close();
    }
  });

  it('leaves the ocrmypdf text alone when the endpoint refuses', async () => {
    const endpoint = await fakeEndpoint(() => ({ status: 500 }));
    try {
      const { patch, storage } = await runStep({ ...CONFIG, vlm: endpoint.config });

      // No patch at all, so the runner writes nothing and contentKey keeps
      // pointing at the text ocrmypdf produced.
      expect(patch).toBeUndefined();
      expect(storage.text.objects.size).toBe(0);
    } finally {
      await endpoint.close();
    }
  });

  it('treats a blank answer as a model that did not read, not as a blank page', async () => {
    const endpoint = await fakeEndpoint(() => '   ');
    try {
      const { patch, storage } = await runStep({ ...CONFIG, vlm: endpoint.config });

      expect(patch).toBeUndefined();
      expect(storage.text.objects.size).toBe(0);
    } finally {
      await endpoint.close();
    }
  });
});

// Ghostscript renders the pages; the Docker image has it for ocrmypdf's PDF/A,
// and ImageMagick builds the multi-page PDF to feed it. A dev host usually has
// neither, and this reports as skipped there.
const areToolsMissing = await Promise.all([
  exec('gs', ['--version']).then(
    () => true,
    () => false,
  ),
  exec('magick', ['-version']).then(
    () => true,
    () => false,
  ),
]).then(([gs, magick]) => (gs && magick) === false);

describe.skipIf(areToolsMissing)('rasterising a PDF', () => {
  it('reads every page, in order', { timeout: 60_000 }, async () => {
    const endpoint = await fakeEndpoint((body) => {
      // The fake model reports the size of the page it was handed, which differs
      // per page here — so the joined transcript proves the order, not just the
      // count.
      const parts = body.messages.at(-1)?.content as Array<{ image_url?: { url: string } }>;
      const bytes = (parts[1].image_url?.url ?? '').length;
      return `page of ${bytes} chars`;
    });
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-vlm-pdf-'));
    try {
      // Two pages of visibly different sizes, so the transcripts are distinct.
      const pdf = join(tmpDir, 'pages.pdf');
      await exec('magick', ['-size', '600x800', 'xc:white', '-size', '600x400', 'xc:gray', pdf]);

      const storage = createFakeStorage();
      const document = doc({ mimeType: 'application/pdf', originalFilename: 'pages.pdf' });
      storage.files.objects.set(document.originalKey, {
        body: await readFile(pdf),
        contentType: 'application/pdf',
      });

      const patch = await vlmStep.run({
        doc: document,
        db: null as never,
        storage,
        config: { ...CONFIG, vlm: endpoint.config },
        tmpDir,
      });

      expect(endpoint.bodies).toHaveLength(2);
      const stored = storage.text.objects.get(patch?.contentKey ?? '')?.body.toString() ?? '';
      expect(stored.split('\n\n')).toHaveLength(2);
      // Page one is the taller image, so it is the larger data URL.
      const sizes = stored.split('\n\n').map((line) => Number(line.match(/(\d+)/)?.[1]));
      expect(sizes[0]).toBeGreaterThan(sizes[1]);
    } finally {
      await endpoint.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
