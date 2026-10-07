// The session token lives in localStorage rather than a cookie: the API is a
// Bearer-token GraphQL endpoint that sets no cookies, and in development the
// bundle is served by Vite on a different port from the server.
const TOKEN_KEY = 'engrafo_token';

// Where the token is kept when the browser refuses storage — a private window
// with site data blocked. It lasts until the tab reloads, which is still a
// session; without it, signing in would succeed on the server and do nothing here.
let sessionOnlyToken: string | null = null;

/**
 * Reads the session token this browser holds.
 *
 * @returns The token, or null when there is none.
 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? sessionOnlyToken;
  } catch {
    return sessionOnlyToken;
  }
}

/**
 * Keeps a session token for the requests that follow. Where storage is blocked it is kept for
 * this page load only.
 *
 * @param token - The bearer token the server issued.
 */
export function setToken(token: string): void {
  sessionOnlyToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked: the copy above is the session.
  }
}

/** Forgets the session token. */
export function clearToken(): void {
  sessionOnlyToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: there was nothing stored to remove.
  }
}
