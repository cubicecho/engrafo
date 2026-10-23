import { useLazyQuery } from '@apollo/client/react';
import { useCallback, useRef, useState } from 'react';
import { graphql } from '@/__generated__';
import { messageOf } from '@/lib/error-message';

// The endpoint first, then its models, as telos asks for them: a base URL is
// typed (and a key, if it wants one), the endpoint is asked what it serves, and
// the model is picked from that rather than typed from memory.

export const VisionModelsQuery = graphql(`
  query VisionModels($baseUrl: String!, $apiKey: String) {
    visionModels(baseUrl: $baseUrl, apiKey: $apiKey) {
      id
      contextLength
    }
  }
`);

/** One endpoint and key, as last asked. */
export interface AskedEndpoint {
  baseUrl: string;
  apiKey: string;
}

/**
 * The models one OpenAI-compatible endpoint lists, asked for when told to.
 *
 * Never from the cache: a server that was down a minute ago may be up now, and
 * a stale "Connected" is worse than asking again.
 *
 * @returns What was asked, whether it is still being asked, and what came back.
 */
export function useEndpointModels() {
  const [load, query] = useLazyQuery(VisionModelsQuery, { fetchPolicy: 'network-only' });
  const [asked, setAsked] = useState<AskedEndpoint | null>(null);
  // The same answer as `asked`, readable at once: two blurs in one tick must not ask twice.
  const last = useRef<AskedEndpoint | null>(null);

  /**
   * Asks `baseUrl` for its models, with a key typed but not yet saved when there is one; the
   * server sends the stored key when none is typed and the URL is the stored one. The same
   * endpoint with the same key is not asked twice unless `force`.
   */
  const ask = useCallback(
    (baseUrl: string, apiKey: string, force = false) => {
      const url = baseUrl.trim();
      const key = apiKey.trim();
      if (!url) {
        return;
      }
      const previous = last.current;
      if (!force && previous && previous.baseUrl === url && previous.apiKey === key) {
        return;
      }
      last.current = { baseUrl: url, apiKey: key };
      setAsked(last.current);
      // A refusal is drawn from `query.error`; the promise has nothing more to say.
      void load({ variables: { baseUrl: url, apiKey: key || null } }).catch(() => undefined);
    },
    [load],
  );

  const done = asked !== null && !query.loading;
  return {
    ask,
    asked,
    loading: query.loading,
    error: done && query.error ? (messageOf(query.error) ?? 'The endpoint could not be listed') : null,
    /** Null until an answer is in: not asked, still asking, or refused. */
    models: done && !query.error ? (query.data?.visionModels ?? null) : null,
  };
}

export type EndpointModels = ReturnType<typeof useEndpointModels>;
