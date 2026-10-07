/** Name endings that never resolve off a private network: a router's domain, mDNS, and the reserved ones. */
const PRIVATE_SUFFIXES = ['.localhost', '.lan', '.local', '.internal', '.home.arpa'];

/** The largest value one part of a dotted address takes. */
const OCTET_MAX = 255;

/** IPv4 blocks that do not route off a private network, by their first two parts. */
const PRIVATE_IPV4_RANGES = [
  // Loopback, 127/8.
  { first: 127, secondFrom: 0, secondTo: OCTET_MAX },
  // 10/8.
  { first: 10, secondFrom: 0, secondTo: OCTET_MAX },
  // 172.16/12.
  { first: 172, secondFrom: 16, secondTo: 31 },
  // 192.168/16.
  { first: 192, secondFrom: 168, secondTo: 168 },
  // Link-local, 169.254/16.
  { first: 169, secondFrom: 254, secondTo: 254 },
];

/**
 * Decides whether to insist on TLS for a connection string.
 *
 * @param url - Postgres connection string.
 * @returns true only when the host could route off a private network and the URL sets no `sslmode`.
 *
 * @remarks
 * Read from the parsed hostname, never the raw string: a URL carrying credentials
 * (`postgres://user:pass@postgres:5432/db`) puts the userinfo where a prefix match looks for
 * the host. "Local" is wider than loopback, because self-hosting is: a bare `postgres` on a
 * compose network and `10.0.0.5` on the LAN speak no TLS by default, and demanding it just
 * breaks the connection.
 */
export function requiresSsl(url: string): boolean {
  // An explicit sslmode is the operator's decision; postgres-js reads it itself.
  if (/[?&]sslmode=/i.test(url)) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }

  const hasPrivateSuffix = PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (hostname === 'localhost' || hasPrivateSuffix) {
    return false;
  }
  // A name with no dots is a container or LAN hostname, not a public address.
  const isBareName = hostname.includes('.') === false && hostname.includes(':') === false;
  if (isBareName) {
    return false;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [first = 0, second = 0] = ipv4.slice(1).map(Number);
    const isPrivate = PRIVATE_IPV4_RANGES.some(
      (range) => first === range.first && second >= range.secondFrom && second <= range.secondTo,
    );
    return isPrivate === false;
  }

  if (hostname.includes(':')) {
    if (hostname === '::1') {
      return false; // loopback
    }
    if (/^f[cd]/.test(hostname)) {
      return false; // unique-local fc00::/7
    }
    if (/^fe[89ab]/.test(hostname)) {
      return false; // link-local fe80::/10
    }
    return true;
  }

  return true;
}
