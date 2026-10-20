import { availableParallelism } from 'node:os';
import { EMBEDDING_DIMENSIONS } from '@cubicecho/engrafo-db/schema';

// Text to vectors, on this machine. The model and how it is called are
// mcp-ragdown's default: granite-embedding-small-english-r2, quantised, CLS
// pooling, normalised, no prefixes. Normalised vectors make a dot product the
// cosine, which is what pgvector's `<=>` turns into a distance.

/** What turns text into vectors. Tests pass a fake; the server loads the model once. */
export interface Embedder {
  /** Stored beside every vector, so vectors from another model are told apart. */
  readonly model: string;
  /** One vector per text, in order, each `EMBEDDING_DIMENSIONS` long. */
  embed(texts: string[]): Promise<number[][]>;
}

/** The model, as recorded on each passage. Change it when the weights or pooling change. */
export const EMBEDDING_MODEL = 'granite-embedding-small-english-r2-q8';
/** Where transformers.js finds the ONNX weights. The Dockerfile bakes the same repo in. */
export const EMBEDDING_REPO = 'onnx-community/granite-embedding-small-english-r2-ONNX';

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'cls'; normalize: true },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * The local model, loaded on first use rather than at boot.
 *
 * @param options.modelsDir - The model cache, or null for the library's default.
 * @param options.batchSize - How many texts go through the model at once.
 * @returns The embedder. The first call loads the model, about a second from a warm cache.
 *
 * @remarks
 * Lazy so a server that never indexes or searches never pays the memory (about 150 MB), and so
 * a model that cannot be loaded fails the step or the search that needed it, with the reason,
 * rather than the boot.
 */
export function createLocalEmbedder({
  modelsDir,
  batchSize,
}: {
  modelsDir: string | null;
  batchSize: number;
}): Embedder {
  let loading: Promise<FeatureExtractor> | null = null;

  function load(): Promise<FeatureExtractor> {
    loading ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (modelsDir !== null) {
        env.cacheDir = modelsDir;
      }
      return (await pipeline('feature-extraction', EMBEDDING_REPO, {
        dtype: 'q8',
        session_options: {
          // Half the logical cores: past the physical ones, more threads only
          // wait on the slowest (ragdown measured this). OCR shares the machine.
          intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
          interOpNumThreads: 1,
        },
      })) as unknown as FeatureExtractor;
    })().catch((error: unknown) => {
      // Not cached as a failure: the next call tries again, as after a network blip.
      loading = null;
      throw error;
    });
    return loading;
  }

  return {
    model: EMBEDDING_MODEL,
    async embed(texts) {
      const extract = await load();
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const { data } = await extract(batch, { pooling: 'cls', normalize: true });
        for (let row = 0; row < batch.length; row += 1) {
          vectors.push(Array.from(data.subarray(row * EMBEDDING_DIMENSIONS, (row + 1) * EMBEDDING_DIMENSIONS)));
        }
      }
      return vectors;
    },
  };
}
