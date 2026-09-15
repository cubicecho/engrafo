// The session token lives in localStorage rather than a cookie: the API is a
// Bearer-token GraphQL endpoint with no session table, and in development the
// bundle is served by Vite on a different port from the server.
const TOKEN_KEY = 'engrafo_token';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: there is no token to clear.
  }
}
