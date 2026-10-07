import { describe, expect, it } from 'vitest';
import { requiresSsl } from '../ssl.ts';

/** Builds a Postgres URL with credentials, since userinfo is what a naive host match trips on. */
const urlFor = (host: string, query = ''): string => `postgres://engrafo:secret@${host}:5432/engrafo${query}`;

describe('requiresSsl', () => {
  it.each([
    ['localhost'],
    ['db.localhost'],
    ['postgres'],
    ['127.0.0.1'],
    ['10.0.0.5'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.1.20'],
    ['169.254.10.10'],
    ['[::1]'],
    ['[fd12:3456::1]'],
    ['[fe80::1]'],
  ])('leaves TLS alone for the private host %s', (host) => {
    expect(requiresSsl(urlFor(host))).toBe(false);
  });

  it.each([['db.example.com'], ['8.8.8.8'], ['172.32.0.1'], ['[2001:db8::1]']])(
    'forces TLS for the public host %s',
    (host) => {
      expect(requiresSsl(urlFor(host))).toBe(true);
    },
  );

  it('respects an explicit sslmode', () => {
    expect(requiresSsl(urlFor('db.example.com', '?sslmode=disable'))).toBe(false);
  });

  it('does not force TLS on a URL it cannot parse', () => {
    expect(requiresSsl('not a url')).toBe(false);
  });
});
