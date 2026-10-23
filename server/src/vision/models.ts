import { VISION_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';

/** A model an endpoint lists. */
export interface VisionModel {
  id: string;
  /** How many tokens it takes in, or null when the listing does not say. */
  contextLength: number | null;
}

/**
 * A base URL as it is stored and compared: trimmed, without trailing slashes, so `…/v1/` and
 * `…/v1` are one endpoint when deciding whether the stored key may be sent to it.
 *
 * @param baseUrl - The URL as typed.
 * @returns The same URL, normalised.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * Asks an OpenAI-compatible endpoint which models it serves.
 *
 * @param baseUrl - The endpoint's base URL, http or https.
 * @param apiKey - The bearer key, or null to send none.
 * @returns The models, sorted by id, at most `VISION_DEFAULTS.maxModels`.
 * @throws BAD_USER_INPUT saying what went wrong: not a URL, unreachable, an error status, or an
 *   answer that is not a model listing.
 *
 * @remarks
 * A fetch of its own rather than agent-core's `listModels`, which caches a listing per endpoint:
 * the settings page's "reload" has to ask again. Redirects are refused, so the key is never
 * carried on to a host nobody typed. Only ids and context lengths come back, never the body, so
 * the call says nothing about a URL beyond whether it lists models.
 */
export async function listVisionModels(baseUrl: string, apiKey: string | null): Promise<VisionModel[]> {
  let url: URL;
  try {
    url = new URL(`${normalizeBaseUrl(baseUrl)}/models`);
  } catch {
    throw badInput('That base URL is not a URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badInput('A base URL starts with http:// or https://.');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(VISION_DEFAULTS.modelsTimeoutSeconds * MS_PER_SECOND),
      redirect: 'error',
    });
  } catch {
    throw badInput(`Could not reach ${url.origin}.`);
  }
  if (response.ok === false) {
    throw badInput(`${url.origin} answered ${response.status} when asked for its models.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw badInput(`${url.origin} did not answer with a list of models.`);
  }
  // OpenAI's shape is `{ data: [...] }`; Ollama's native one is `{ models: [...] }`.
  const listing = (body ?? {}) as { data?: unknown; models?: unknown };
  const rows = Array.isArray(listing.data) ? listing.data : Array.isArray(listing.models) ? listing.models : null;
  if (rows === null) {
    throw badInput(`${url.origin} did not answer with a list of models.`);
  }

  const models = new Map<string, VisionModel>();
  for (const row of rows) {
    if (row === null || typeof row !== 'object') {
      continue;
    }
    const entry = row as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : null;
    if (id === null || id === '') {
      continue;
    }
    const length = entry.context_length ?? entry.max_context_length ?? entry.context_window;
    const contextLength = typeof length === 'number' && length > 0 ? Math.floor(length) : null;
    models.set(id, { id, contextLength: contextLength ?? models.get(id)?.contextLength ?? null });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, VISION_DEFAULTS.maxModels);
}
