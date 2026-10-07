let counter = 0;

// Digits and letters both, so the timestamp in a fallback id stays short.
const BASE_36 = 36;

/**
 * An id for something that exists only in this browser tab, such as an upload's
 * progress row.
 *
 * Not plain `crypto.randomUUID()`: that is a secure-context API, so it is
 * undefined over plain HTTP at a LAN address, which is how a self-hosted
 * instance is normally reached. The id only tells one row from another, so a
 * counter is a fine fallback.
 *
 * @returns A string unique within this tab.
 */
export function clientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(BASE_36)}-${counter++}`;
}
