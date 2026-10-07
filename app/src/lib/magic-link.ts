/**
 * The query string of a sign-in link, for following it on this origin.
 *
 * @param link - The link the server returned. Built from `APP_URL`, so it may name another origin.
 * @param origin - What a relative link is resolved against.
 * @returns The link's query string, `?token=…`, or null when the link cannot be read as a URL.
 */
export function magicLinkSearch(link: string, origin: string): string | null {
  try {
    return new URL(link, origin).search;
  } catch {
    return null;
  }
}
