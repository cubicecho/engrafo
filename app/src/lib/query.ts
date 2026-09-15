/**
 * Apollo 4's result, in the shape cubeui's QueryState reads.
 *
 * "Pending" and "failed" only count while there is nothing to show: a poll that
 * errors or a cache-and-network refetch must not swap a good list for a
 * skeleton or an error card.
 */
export function queryLike(result: { data?: unknown; loading: boolean; error?: Error; refetch: () => unknown }) {
  const empty = result.data === undefined;
  return {
    isPending: result.loading && empty,
    isError: Boolean(result.error) && empty,
    error: result.error ?? null,
    refetch: result.refetch,
  };
}
