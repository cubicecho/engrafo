// The session token lives in localStorage rather than a cookie: the API is a
// Bearer-token GraphQL endpoint that sets no cookies, and in development the
// bundle is served by Vite on a different port from the server.
const TOKEN_KEY = 'engrafo_token';

/**
 * Reads the session token this browser holds.
 *
 * @returns The token, or null when there is none or storage is blocked.
 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps a session token for the requests that follow.
 *
 * @param token - The bearer token the server issued.
 */
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

/** Forgets the session token. Does nothing when storage is blocked. */
export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: there is no token to clear.
  }
}
