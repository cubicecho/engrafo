import { EndpointProbeError, NO_KEY, normalizeBaseUrl, ProbeFailure, probeEndpoint } from '@cubicecho/agent-core';
import { VISION_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';

/** A model an endpoint lists. */
export interface VisionModel {
  id: string;
  /** How many tokens it takes in, or null when the listing does not say. */
  contextLength: number | null;
}

/**
 * Why a base URL cannot be stored or asked, in the settings form's words.
 *
 * @param baseUrl - The URL as typed.
 * @returns The sentence for the form, or null where agent-core's `normalizeBaseUrl` takes it.
 *
 * @remarks
 * agent-core's rule, worded per reason: the settings page said "not a URL" and "starts with
 * http://" before the rule was shared, and a URL with credentials or a query in it is the case
 * the shared rule added.
 */
export function baseUrlProblem(baseUrl: string): string | null {
  if (normalizeBaseUrl(baseUrl) !== null) {
    return null;
  }
  const trimmed = baseUrl.trim();
  if (URL.canParse(trimmed) === false) {
    return 'That base URL is not a URL.';
  }
  const { protocol } = new URL(trimmed);
  if (protocol !== 'http:' && protocol !== 'https:') {
    return 'A base URL starts with http:// or https://.';
  }
  return 'A base URL has no credentials, query or fragment in it.';
}

/**
 * Asks an OpenAI-compatible endpoint which models it serves.
 *
 * @param baseUrl - The endpoint's base URL, http or https.
 * @param apiKey - The bearer key; null or agent-core's `NO_KEY` sends none.
 * @returns The models, sorted by id, at most `VISION_DEFAULTS.maxModels`.
 * @throws BAD_USER_INPUT saying what went wrong: not a URL, unreachable, too slow, the key
 *   refused, a redirect, an error status, or an answer that is not a model listing.
 *
 * @remarks
 * agent-core's `probeEndpoint`, not its `listModels`: that one pools a client and remembers the
 * listing per endpoint, which is right for a configured endpoint and wrong for a form whose
 * "reload" has to ask again and whose URL may be half-typed. The probe refuses redirects, so the
 * key is never carried on to a host nobody typed, and reads Ollama's native listing as well as
 * OpenAI's. Its messages name the endpoint by origin only and are already this form's sentences,
 * so they pass through; only a refused URL is reworded, by `baseUrlProblem`, to say which rule.
 */
export async function listVisionModels(baseUrl: string, apiKey: string | null): Promise<VisionModel[]> {
  let models: Awaited<ReturnType<typeof probeEndpoint>>;
  try {
    models = await probeEndpoint(
      { baseUrl, apiKey: apiKey ?? NO_KEY, requestTimeoutSeconds: VISION_DEFAULTS.modelsTimeoutSeconds },
      { limit: VISION_DEFAULTS.maxModels },
    );
  } catch (error) {
    if (error instanceof EndpointProbeError) {
      const message = error.kind === ProbeFailure.InvalidUrl ? baseUrlProblem(baseUrl) : null;
      throw badInput(message ?? error.message);
    }
    throw error;
  }
  // The probe says zero for a window the listing left out; the form shows nothing for null.
  return models.map(({ id, contextLength }) => ({ id, contextLength: contextLength > 0 ? contextLength : null }));
}
