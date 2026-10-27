import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resetAll } from '@cubicecho/agent-core';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pageInput,
  rasterArgs,
  TRANSCRIBE,
  TRANSCRIBE_MARKDOWN,
  unfence,
  visionStep,
} from '../../pipeline/steps/vision.ts';
import type { RunConfig } from '../../pipeline/types.ts';
import type { VisionConfig } from '../../vision/settings.ts';
import { createFakeEmbedder, createFakeStorage } from '../helpers.ts';

const exec = promisify(execFile);

interface OpenAIRequest {
  model: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; image_url?: { url: string; detail?: string } }>;
  }>;
}

/**
 * A real OpenAI-compatible server on an ephemeral port, rather than a mocked `ask`. What is worth
 * proving here is that a page reaches the wire as an `image_url` part at all, which a stub
 * standing in for the one function that builds the request cannot say anything about.
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
  const vision: VisionConfig = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: '',
    model: 'test-vlm',
    requestTimeoutSeconds: 30,
    maxResponseTokens: 8192,
    imageDetail: 'auto',
    temperature: 0.6,
    sampler: {},
    textFormat: 'plain',
    auto: true,
  };
  return { vision, bodies, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const VISION: VisionConfig = {
  baseUrl: 'http://box/v1',
  apiKey: '',
  model: 'test-vlm',
  requestTimeoutSeconds: 30,
  maxResponseTokens: 8192,
  imageDetail: 'auto',
  temperature: 0.6,
  sampler: {},
  textFormat: 'plain',
  auto: false,
};
const CONFIG: RunConfig = {
  ocrAvailable: true,
  pdfTextAvailable: true,
  thumbnailTools: { pdf: false, image: false },
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: VISION,
};

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Scan',
    originalFilename: 'scan.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1,
    checksumSha256: null,
    originalKey: 'originals/u/scan',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    contentFormat: 'plain',
    thumbnailKey: null,
    documentDate: null,
    documentDateSource: null,
    vendor: null,
    total: null,
    currency: null,
    receiptSource: null,
    ocrRequested: true,
    visionRequested: true,
    status: 'processing',
    error: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

/**
 * A 1x1 RGBA PNG. Sent as a JPEG's bytes where the step should pass an upload through untouched,
 * since nothing on the way decodes it; as a PNG it is one with an alpha channel.
 */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A run with the file already in the bucket and a scratch directory of its own. */
async function runStep(config: RunConfig, document: Document = doc(), body: Buffer = PIXEL) {
  const storage = createFakeStorage();
  // With an archive, the original is not something Ghostscript can read, so a test that passes
  // shows the archive was the one rendered.
  const original = document.archiveKey === null ? body : Buffer.from('not the archive');
  storage.files.objects.set(document.originalKey, { body: original, contentType: document.mimeType });
  if (document.archiveKey !== null) {
    storage.files.objects.set(document.archiveKey, { body, contentType: 'application/pdf' });
  }
  const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-vision-test-'));
  const progress: Array<[done: number, total: number]> = [];
  try {
    const run = visionStep.run({
      doc: document,
      db: null as never,
      storage,
      config,
      embedder: createFakeEmbedder(),
      tmpDir,
      reportProgress: async (done, total) => {
        progress.push([done, total]);
      },
    });
    return { patch: await run, storage, progress };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** The image the model was shown on request `index`, as a data URL. */
function shownImage(body: OpenAIRequest | undefined): string {
  const parts = body?.messages.at(-1)?.content as Array<{ image_url?: { url: string } }>;
  return parts[1]?.image_url?.url ?? '';
}

afterEach(() => {
  resetAll();
  vi.restoreAllMocks();
});

describe('vision step', () => {
  it('runs on a document someone asked for, or on "auto" one OCR runs on, when a model is set up', () => {
    const auto = { ...CONFIG, vision: { ...VISION, auto: true } };
    expect(visionStep.enabled(doc(), CONFIG)).toBe(true);
    expect(visionStep.enabled(doc({ visionRequested: false }), CONFIG)).toBe(false);
    expect(visionStep.enabled(doc({ visionRequested: false }), auto)).toBe(true);
    expect(visionStep.enabled(doc({ visionRequested: false, ocrRequested: false }), auto)).toBe(false);
    expect(visionStep.enabled(doc(), { ...CONFIG, vision: null })).toBe(false);
    expect(visionStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
    expect(visionStep.enabled(doc({ mimeType: 'application/epub+zip' }), auto)).toBe(false);
  });

  it('does not wait on ocrmypdf being installed', () => {
    // The two are independent: a model can read pages on a host with no ocrmypdf, which only
    // leaves the document without a PDF/A archive.
    expect(visionStep.enabled(doc(), { ...CONFIG, ocrAvailable: false })).toBe(true);
  });

  it('asks Ghostscript for one page more than the cap, so "at the cap" is distinguishable', () => {
    const args = rasterArgs('in.pdf', '/tmp/page-%04d.png', 201, 200);
    expect(args).toContain('-r200');
    expect(args).toContain('-dLastPage=201');
    expect(args).toContain('-sOutputFile=/tmp/page-%04d.png');
    expect(args.at(-1)).toBe('in.pdf');
  });

  it('sends the page as a data URL carrying its own media type', () => {
    expect(pageInput(PIXEL, 'image/jpeg')).toEqual([
      { type: 'text', text: 'Transcribe this page.' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PIXEL.toString('base64')}` } },
    ]);
  });

  it('sends the image detail the admin chose, and none at all for auto', () => {
    const image = (detail?: 'auto' | 'low' | 'high') =>
      (pageInput(PIXEL, 'image/png', detail)[1] as unknown as { image_url: Record<string, string> }).image_url;
    expect(image('low').detail).toBe('low');
    expect(image('high').detail).toBe('high');
    expect(image('auto')).not.toHaveProperty('detail');
    expect(image()).not.toHaveProperty('detail');
  });
});

describe('unfence', () => {
  it('takes the fence off an answer that is one fenced block', () => {
    expect(unfence('```markdown\n# Invoice\n\nDue now.\n```')).toBe('# Invoice\n\nDue now.');
    expect(unfence('```\n# Invoice\n```')).toBe('# Invoice');
  });

  it('leaves a page that has a code block among its text alone', () => {
    const page = 'Run this:\n\n```\nmake\n```';
    expect(unfence(page)).toBe(page);
    expect(unfence('# Plain heading')).toBe('# Plain heading');
  });
});

describe('vision step against an OpenAI-compatible endpoint', () => {
  it('shows the page to the model as uploaded, at the set temperature, and stores what comes back', async () => {
    const endpoint = await fakeEndpoint(() => 'INVOICE 4821\nDue on receipt');
    try {
      const { patch, storage, progress } = await runStep({ ...CONFIG, vision: endpoint.vision });
      expect(progress).toEqual([
        [0, 1],
        [1, 1],
      ]);

      expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('INVOICE 4821\nDue on receipt');
      expect(patch?.contentBytes).toBe(27);

      const [request] = endpoint.bodies;
      expect(request.model).toBe('test-vlm');
      expect(request.temperature).toBe(0.6);
      expect(request.messages[0]).toMatchObject({ role: 'system', content: TRANSCRIBE });
      const parts = request.messages.at(-1)?.content as Array<{ type: string }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(shownImage(request)).toBe(`data:image/jpeg;base64,${PIXEL.toString('base64')}`);
    } finally {
      await endpoint.close();
    }
  });

  it('stores plain text by default, said as plain', async () => {
    const endpoint = await fakeEndpoint(() => '# 4711');
    try {
      const { patch } = await runStep({ ...CONFIG, vision: endpoint.vision });
      expect(patch?.contentFormat).toBe('plain');
    } finally {
      await endpoint.close();
    }
  });

  it('asks for Markdown when the admin chose it, takes a fence off, and stores it as Markdown', async () => {
    const endpoint = await fakeEndpoint(
      () => '```markdown\n# Invoice 4821\n\n| Item | Total |\n| --- | --- |\n| Kettle | 12.50 |\n```',
    );
    try {
      const { patch, storage } = await runStep({
        ...CONFIG,
        vision: { ...endpoint.vision, textFormat: 'markdown' },
      });

      expect(endpoint.bodies[0]?.messages[0]).toMatchObject({ role: 'system', content: TRANSCRIBE_MARKDOWN });
      expect(patch?.contentFormat).toBe('markdown');
      const stored = storage.text.objects.get(patch?.contentKey ?? '');
      expect(stored?.body.toString()).toBe('# Invoice 4821\n\n| Item | Total |\n| --- | --- |\n| Kettle | 12.50 |');
      expect(stored?.contentType).toBe('text/markdown; charset=utf-8');
    } finally {
      await endpoint.close();
    }
  });

  it('caps the reply, sets the detail and the temperature as the admin set them', async () => {
    const endpoint = await fakeEndpoint(() => 'INVOICE 4821');
    try {
      await runStep({
        ...CONFIG,
        vision: { ...endpoint.vision, maxResponseTokens: 1024, imageDetail: 'low', temperature: 0 },
      });
      const [request] = endpoint.bodies;
      expect(request.max_tokens ?? request.max_completion_tokens).toBe(1024);
      expect(request.temperature).toBe(0);
      const parts = request.messages.at(-1)?.content as Array<{ image_url?: { detail?: string } }>;
      expect(parts[1].image_url?.detail).toBe('low');
    } finally {
      await endpoint.close();
    }
  });

  it('on "auto", keeps the text it had when the endpoint refuses, and still succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const endpoint = await fakeEndpoint(() => ({ status: 400 }));
    try {
      const { patch, storage } = await runStep(
        { ...CONFIG, vision: endpoint.vision },
        doc({ visionRequested: false, contentKey: 'text/u/scan.txt' }),
      );

      // No patch at all, so the runner writes nothing and contentKey keeps pointing at the text
      // the steps before produced.
      expect(patch).toBeUndefined();
      expect(storage.text.objects.size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[vision\] .*page 1 of 1/));
    } finally {
      await endpoint.close();
    }
  });

  it('fails the step with the reason when someone asked for the read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const endpoint = await fakeEndpoint(() => ({ status: 400 }));
    try {
      await expect(runStep({ ...CONFIG, vision: endpoint.vision })).rejects.toThrow(/page 1 of 1/);
    } finally {
      await endpoint.close();
    }
  });

  it('treats a blank answer as a model that did not read, not as a blank page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const endpoint = await fakeEndpoint(() => '   ');
    try {
      const { patch, storage } = await runStep({ ...CONFIG, vision: endpoint.vision }, doc({ visionRequested: false }));
      expect(patch).toBeUndefined();
      expect(storage.text.objects.size).toBe(0);

      await expect(runStep({ ...CONFIG, vision: endpoint.vision })).rejects.toThrow(/returned nothing/);
    } finally {
      await endpoint.close();
    }
  });
});

const has = (command: string, args: string[]) =>
  exec(command, args).then(
    () => true,
    () => false,
  );
// Pillow, as the image is given it for ocrmypdf; Ghostscript renders PDFs, and ImageMagick builds
// the multi-page inputs. The Docker test stage has all three; a dev host may not, and these then
// report as skipped.
const [hasPillow, hasGhostscript, hasMagick] = await Promise.all([
  has('python3', ['-c', 'import PIL']),
  has('gs', ['--version']),
  has('magick', ['-version']),
]);

describe.skipIf(hasPillow === false)('an image the model may not read as it is', () => {
  it('shows a see-through PNG as an opaque one', { timeout: 30_000 }, async () => {
    const endpoint = await fakeEndpoint(() => 'text');
    try {
      await runStep({ ...CONFIG, vision: endpoint.vision }, doc({ mimeType: 'image/png' }));
      const url = shownImage(endpoint.bodies[0]);
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
      expect(url).not.toBe(`data:image/png;base64,${PIXEL.toString('base64')}`);
    } finally {
      await endpoint.close();
    }
  });
});

describe.skipIf((hasPillow && hasGhostscript && hasMagick) === false)('documents of many pages', () => {
  it('reads every page of a PDF, in order, from the archive when there is one', { timeout: 60_000 }, async () => {
    const endpoint = await fakeEndpoint((body) => `page of ${shownImage(body).length} chars`);
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-vision-pdf-'));
    try {
      // Two pages of visibly different sizes, so the transcripts are distinct.
      const pdf = join(tmpDir, 'pages.pdf');
      await exec('magick', ['-size', '600x800', 'xc:white', '-size', '600x400', 'xc:gray', pdf]);
      const document = doc({ mimeType: 'application/pdf', archiveKey: 'archives/u/scan.pdf' });

      const { patch, storage, progress } = await runStep(
        { ...CONFIG, vision: endpoint.vision },
        document,
        await readFile(pdf),
      );

      expect(endpoint.bodies).toHaveLength(2);
      // Said before each page is sent, then once all are read.
      expect(progress).toEqual([
        [0, 2],
        [1, 2],
        [2, 2],
      ]);
      const stored = storage.text.objects.get(patch?.contentKey ?? '')?.body.toString() ?? '';
      const sizes = stored.split('\n\n').map((line) => Number(line.match(/(\d+)/)?.[1]));
      expect(sizes).toHaveLength(2);
      // Page one is the taller image, so it is the larger data URL.
      expect(sizes[0]).toBeGreaterThan(sizes[1]);
    } finally {
      await endpoint.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reads every frame of a TIFF as a page', { timeout: 60_000 }, async () => {
    const endpoint = await fakeEndpoint(() => 'frame');
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-vision-tiff-'));
    try {
      const tiff = join(tmpDir, 'pages.tiff');
      await exec('magick', ['-size', '60x80', 'xc:white', '-size', '60x40', 'xc:gray', tiff]);

      const { patch, storage } = await runStep(
        { ...CONFIG, vision: endpoint.vision },
        doc({ mimeType: 'image/tiff' }),
        await readFile(tiff),
      );

      expect(endpoint.bodies).toHaveLength(2);
      expect(shownImage(endpoint.bodies[0]).startsWith('data:image/png;base64,')).toBe(true);
      expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('frame\n\nframe');
    } finally {
      await endpoint.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
