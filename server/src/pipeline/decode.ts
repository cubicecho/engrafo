import { analyse } from 'chardet';
import { TEXT_DEFAULTS } from '../core/defaults.ts';

const UTF8 = 'utf-8';

// A byte-order mark is the file saying outright what it is.
const BOMS: ReadonlyArray<[bytes: Buffer, encoding: string]> = [
  [Buffer.from('efbbbf', 'hex'), UTF8],
  [Buffer.from('fffe', 'hex'), 'utf-16le'],
  [Buffer.from('feff', 'hex'), 'utf-16be'],
];

// How far into a page a browser looks for a <meta> naming its encoding.
const META_PRESCAN_BYTES = 1024;
// Both `<meta charset="x">` and `<meta http-equiv="Content-Type" content="text/html; charset=x">`.
const META_CHARSET = /<meta[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i;

/**
 * Turns an uploaded text file's bytes into a string, working out the encoding it was written in.
 *
 * @param bytes - The whole file.
 * @param options - What else may say what the encoding is.
 * @param options.html - Whether the file is a web page, whose `<meta charset>` is believed.
 * @returns The text, without a byte-order mark.
 *
 * @remarks
 * In order: a byte-order mark; bytes that are valid UTF-8, which text in any other encoding with
 * a single accented letter almost never is; a page's own `<meta charset>`; chardet's guess; and
 * windows-1252. The `<meta>` comes after the UTF-8 check because a page saved by an editor that
 * re-encoded it often keeps the old declaration.
 */
export function decodeText(bytes: Uint8Array, { html = false }: { html?: boolean } = {}): string {
  return new TextDecoder(textEncoding(bytes, { html })).decode(bytes);
}

/**
 * The encoding `decodeText` reads a file with.
 *
 * @param bytes - The whole file.
 * @param options - As `decodeText`.
 * @param options.html - Whether the file is a web page.
 * @returns A label `TextDecoder` accepts.
 */
export function textEncoding(bytes: Uint8Array, { html = false }: { html?: boolean } = {}): string {
  for (const [bom, encoding] of BOMS) {
    if (bom.every((byte, i) => bytes[i] === byte)) {
      return encoding;
    }
  }
  // UTF-16 with no mark is valid UTF-8 too, NULs and all; text has no NULs of its own.
  if (bytes.includes(0) === false && isUtf8(bytes)) {
    return UTF8;
  }
  const sample = bytes.subarray(0, TEXT_DEFAULTS.encodingSampleBytes);
  const utf16 = unmarkedUtf16(sample);
  if (utf16 !== null) {
    return utf16;
  }
  const declared = html ? metaCharset(bytes) : null;
  if (declared !== null) {
    return declared;
  }
  for (const { name } of analyse(sample)) {
    // An ASCII guess on bytes that are not UTF-8 means the sample ran out before the accents did.
    if (name !== 'ASCII' && name !== 'UTF-8' && isDecodable(name)) {
      return name;
    }
  }
  return TEXT_DEFAULTS.fallbackEncoding;
}

/**
 * UTF-16 written with no byte-order mark, which chardet does not recognise. Every character below
 * U+0100 (spaces, digits, punctuation, all of Latin-1) has a zero for one of its two bytes, and
 * always the same one: the second in little-endian, the first in big-endian.
 */
function unmarkedUtf16(sample: Uint8Array): string | null {
  let even = 0;
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) {
        even++;
      } else {
        odd++;
      }
    }
  }
  // Even text in Cyrillic or Greek has its spaces and digits; a tenth is a low bar for them. The
  // other side may have a few zeros of its own: 一 is U+4E00.
  const enough = sample.length / 2 / 10;
  const lopsided = 20;
  if (odd >= enough && even * lopsided <= odd) {
    return 'utf-16le';
  }
  if (even >= enough && odd * lopsided <= even) {
    return 'utf-16be';
  }
  return null;
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder(UTF8, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function metaCharset(bytes: Uint8Array): string | null {
  // latin1 maps every byte to one character, so the ASCII of the markup reads the same whatever
  // the page's real encoding is.
  const head = Buffer.from(bytes.subarray(0, META_PRESCAN_BYTES)).toString('latin1');
  const label = META_CHARSET.exec(head)?.[1] ?? null;
  // A page cannot declare itself UTF-16 from inside: the declaration would not be ASCII. Browsers
  // ignore it, and so does this.
  if (label === null || /^utf-?16/i.test(label) || isDecodable(label) === false) {
    return null;
  }
  return label;
}

function isDecodable(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}
