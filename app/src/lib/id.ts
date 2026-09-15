let counter = 0;

/**
 * An id for something that exists only in this browser tab — an upload's
 * progress row, say.
 *
 * Not plain `crypto.randomUUID()`: that is a secure-context API, so it is
 * undefined over plain HTTP to anything but `localhost`. That is not an edge
 * case here — it is how a self-hosted instance on a LAN is normally reached,
 * and calling it there throws "crypto.randomUUID is not a function".
 *
 * Nothing built here is a secret, is guessed at, or ever leaves the tab: it
 * distinguishes one row from another, so a counter is a fine fallback.
 */
export function clientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${counter++}`;
}
