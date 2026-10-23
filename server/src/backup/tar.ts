// A tar writer and reader, just enough of POSIX ustar and pax for an export to stream out and an
// import to stream back in. Tar rather than zip because both halves are one pass: a tar entry is
// a header and its bytes, so the export writes each object as the bucket hands it over and the
// import reads each one as the bucket hands it back, with nothing on disk and nothing held but the
// entry in hand. fflate's streaming zip would do the first half, but it has no ZIP64, so an
// archive past 4 GiB or 65,535 entries would come out corrupt, and a zip's directory is at its end,
// so reading one back means having all of it first.

/** Tar works in blocks of this many bytes: every header is one, every body is padded to one. */
export const TAR_BLOCK_BYTES = 512;
/** Two empty blocks end an archive. */
export const TAR_END = Buffer.alloc(TAR_BLOCK_BYTES * 2);

// The ustar header's fields, in order, by length. Each starts where the one before it ends.
const NAME_BYTES = 100;
const MODE_BYTES = 8;
const ID_BYTES = 8;
const SIZE_BYTES = 12;
const MTIME_BYTES = 12;
const CHECKSUM_BYTES = 8;
const TYPE_BYTES = 1;
const LINK_NAME_BYTES = 100;
const MAGIC_BYTES = 6;
const VERSION_BYTES = 2;
const OWNER_NAME_BYTES = 32;
const DEVICE_BYTES = 8;
const PREFIX_BYTES = 155;

const LAYOUT = [
  ['name', NAME_BYTES],
  ['mode', MODE_BYTES],
  ['uid', ID_BYTES],
  ['gid', ID_BYTES],
  ['size', SIZE_BYTES],
  ['mtime', MTIME_BYTES],
  ['checksum', CHECKSUM_BYTES],
  ['type', TYPE_BYTES],
  ['linkName', LINK_NAME_BYTES],
  ['magic', MAGIC_BYTES],
  ['version', VERSION_BYTES],
  ['uname', OWNER_NAME_BYTES],
  ['gname', OWNER_NAME_BYTES],
  ['devMajor', DEVICE_BYTES],
  ['devMinor', DEVICE_BYTES],
  ['prefix', PREFIX_BYTES],
] as const;

type FieldName = (typeof LAYOUT)[number][0];

/** Where each header field is, and how long: [offset, length]. */
const FIELD = (() => {
  const fields = {} as Record<FieldName, readonly [number, number]>;
  let offset = 0;
  for (const [name, length] of LAYOUT) {
    fields[name] = [offset, length];
    offset += length;
  }
  return fields;
})();

const OCTAL = 8;
/** `rw-r--r--`. */
const FILE_MODE = 0o644;
const MS_PER_SECOND = 1000;
const ASCII_SPACE = 0x20;
/** The largest size the header's octal digits hold (one byte is the NUL); past it the size goes in pax. */
const MAX_OCTAL_SIZE = OCTAL ** (SIZE_BYTES - 1) - 1;
/** The checksum is six octal digits, then a NUL and a space. */
const CHECKSUM_DIGITS = 6;
/** A name of plain ASCII this long or shorter fits the header itself; anything else goes in pax. */
const MAX_PLAIN_NAME = NAME_BYTES;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** Entry types, by the byte in the header. */
const TYPE = {
  file: '0',
  oldFile: '\0',
  pax: 'x',
  paxGlobal: 'g',
  gnuLongName: 'L',
} as const;

/** The padding that brings a body of `size` bytes to a block boundary. */
export function tarPadding(size: number): Buffer {
  const remainder = size % TAR_BLOCK_BYTES;
  return Buffer.alloc(remainder === 0 ? 0 : TAR_BLOCK_BYTES - remainder);
}

function writeField(block: Buffer, [offset, length]: readonly [number, number], value: string): void {
  block.write(value.slice(0, length), offset, length, 'latin1');
}

function writeOctal(block: Buffer, field: readonly [number, number], value: number): void {
  // Zero-padded, with the field's last byte a NUL.
  writeField(block, field, `${value.toString(OCTAL).padStart(field[1] - 1, '0')}\0`);
}

/** One header block, its checksum computed over the block with the checksum field as spaces. */
function headerBlock(name: string, size: number, mtime: Date, type: string): Buffer {
  const block = Buffer.alloc(TAR_BLOCK_BYTES);
  writeField(block, FIELD.name, name);
  writeOctal(block, FIELD.mode, FILE_MODE);
  writeOctal(block, FIELD.uid, 0);
  writeOctal(block, FIELD.gid, 0);
  writeOctal(block, FIELD.size, size);
  writeOctal(block, FIELD.mtime, Math.floor(mtime.getTime() / MS_PER_SECOND));
  writeField(block, FIELD.type, type);
  writeField(block, FIELD.magic, 'ustar\0');
  writeField(block, FIELD.version, '00');
  writeField(block, FIELD.uname, 'engrafo');
  writeField(block, FIELD.gname, 'engrafo');
  block.fill(ASCII_SPACE, FIELD.checksum[0], FIELD.checksum[0] + FIELD.checksum[1]);
  const sum = block.reduce((total, byte) => total + byte, 0);
  writeField(block, FIELD.checksum, `${sum.toString(OCTAL).padStart(CHECKSUM_DIGITS, '0')}\0 `);
  return block;
}

/**
 * One pax record, `<length> <key>=<value>\n`, where the length counts itself: so it is found by
 * trying, since adding a digit to the length can make it a digit longer.
 */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = Buffer.byteLength(body);
  let length = bodyBytes + 1;
  while (String(length).length + bodyBytes !== length) {
    length++;
  }
  return `${length}${body}`;
}

/**
 * The bytes that start one file in a tar: a pax header when the name or the size does not fit
 * ustar's fields, then the file's own header. The body follows, then {@link tarPadding}.
 *
 * @param name - The path inside the archive, `/`-separated, any Unicode.
 * @param size - The body's length in bytes, which must be exactly what follows.
 * @param mtime - The file's modification time.
 */
export function tarFileHeader(name: string, size: number, mtime: Date): Buffer {
  const records: string[] = [];
  const plainName = name.length <= MAX_PLAIN_NAME && PRINTABLE_ASCII.test(name);
  if (plainName === false) {
    records.push(paxRecord('path', name));
  }
  if (size > MAX_OCTAL_SIZE) {
    records.push(paxRecord('size', String(size)));
  }
  // A reader that ignores pax still gets a usable, if mangled, name.
  const fallbackName = plainName ? name : name.replace(/[^\x20-\x7e]/g, '_').slice(-MAX_PLAIN_NAME);
  const fileHeader = headerBlock(fallbackName, Math.min(size, MAX_OCTAL_SIZE), mtime, TYPE.file);
  if (records.length === 0) {
    return fileHeader;
  }
  const pax = Buffer.from(records.join(''), 'utf8');
  return Buffer.concat([
    headerBlock('PaxHeader', pax.length, mtime, TYPE.pax),
    pax,
    tarPadding(pax.length),
    fileHeader,
  ]);
}

/** A tar that cannot be read: not a tar, or cut short. */
export class TarError extends Error {}

/**
 * Reads exact byte counts off a stream of chunks, which arrive in whatever sizes the network
 * chose.
 */
class ByteReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private ended = false;
  private readonly source: AsyncIterator<Uint8Array>;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.source = source[Symbol.asyncIterator]();
  }

  /** Buffers until `count` bytes are in hand or the stream ends. */
  private async fill(count: number): Promise<void> {
    while (this.buffered < count && this.ended === false) {
      const next = await this.source.next();
      if (next.done) {
        this.ended = true;
      } else if (next.value.length > 0) {
        const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        this.chunks.push(chunk);
        this.buffered += chunk.length;
      }
    }
  }

  /** Takes up to `count` bytes off the front of what is buffered. */
  private take(count: number): Buffer {
    const taken = Buffer.concat(this.chunks, Math.min(count, this.buffered));
    let left = taken.length;
    while (left > 0) {
      const [first] = this.chunks;
      if (first.length <= left) {
        this.chunks.shift();
        left -= first.length;
      } else {
        this.chunks[0] = first.subarray(left);
        left = 0;
      }
    }
    this.buffered -= taken.length;
    return taken;
  }

  /**
   * Exactly `count` bytes.
   *
   * @returns The bytes, or null when the stream ended before any of them.
   * @throws {@link TarError} when it ended partway through them.
   */
  async read(count: number): Promise<Buffer | null> {
    await this.fill(count);
    if (this.buffered === 0 && count > 0) {
      return null;
    }
    if (this.buffered < count) {
      throw new TarError('The archive ends partway through a file.');
    }
    return this.take(count);
  }

  /** Reads `count` bytes and throws them away, a chunk at a time so a large body is never held. */
  async skip(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      await this.fill(1);
      if (this.buffered === 0) {
        throw new TarError('The archive ends partway through a file.');
      }
      left -= this.take(Math.min(left, this.chunks[0].length)).length;
    }
  }
}

function readField(block: Buffer, [offset, length]: readonly [number, number]): string {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

function readOctal(block: Buffer, field: readonly [number, number]): number {
  const text = readField(block, field).trim();
  return text === '' ? 0 : Number.parseInt(text, OCTAL);
}

function hasValidChecksum(block: Buffer): boolean {
  const stored = readOctal(block, FIELD.checksum);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK_BYTES; i++) {
    const inChecksum = i >= FIELD.checksum[0] && i < FIELD.checksum[0] + FIELD.checksum[1];
    sum += inChecksum ? ASCII_SPACE : block[i];
  }
  return sum === stored;
}

/** The `path` and `size` a pax header sets for the entry after it. */
function parsePax(body: Buffer): { path?: string; size?: number } {
  const found: { path?: string; size?: number } = {};
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(ASCII_SPACE, at);
    const length = Number.parseInt(body.subarray(at, space).toString('latin1'), 10);
    if (space === -1 || Number.isFinite(length) === false || length <= 0) {
      break;
    }
    const record = body.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (key === 'path') {
      found.path = value;
    } else if (key === 'size') {
      found.size = Number(value);
    }
    at += length;
  }
  return found;
}

/** One file in an archive being read. */
export interface TarEntry {
  /** Its path inside the archive. */
  name: string;
  /** Its length in bytes, known before any of it is read. */
  size: number;
  /** Reads the body into memory. Not calling it skips the body; calling it twice is a bug. */
  read(): Promise<Buffer>;
}

/**
 * The regular files in a tar, in order, as the stream delivers them. Directories, links and the
 * like are passed over. Each entry's body is read only if asked for, and must be asked for before
 * the next entry is: this reads one pass, never looking back.
 *
 * @param source - The archive's bytes, uncompressed.
 * @throws {@link TarError} for something that is not a tar, or one that ends early.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  let next: { path?: string; size?: number } = {};
  for (;;) {
    const block = await reader.read(TAR_BLOCK_BYTES);
    // An archive missing its end blocks is still read to its end, as GNU tar does.
    if (block === null || block.every((byte) => byte === 0)) {
      return;
    }
    if (hasValidChecksum(block) === false) {
      throw new TarError('This is not a tar archive, or it is damaged.');
    }
    const type = readField(block, FIELD.type) || TYPE.oldFile;
    const size = next.size ?? readOctal(block, FIELD.size);

    if (type === TYPE.pax || type === TYPE.paxGlobal || type === TYPE.gnuLongName) {
      const body = (await reader.read(size)) ?? Buffer.alloc(0);
      await reader.skip(tarPadding(size).length);
      if (type === TYPE.pax) {
        next = parsePax(body);
      } else if (type === TYPE.gnuLongName) {
        next = { path: readField(body, [0, body.length]) };
      }
      continue;
    }

    const prefix = readField(block, FIELD.prefix);
    const name = next.path ?? (prefix ? `${prefix}/${readField(block, FIELD.name)}` : readField(block, FIELD.name));
    next = {};
    let consumed = false;
    if (type === TYPE.file || type === TYPE.oldFile) {
      yield {
        name,
        size,
        read: async () => {
          consumed = true;
          return (await reader.read(size)) ?? Buffer.alloc(0);
        },
      };
    }
    if (consumed === false) {
      await reader.skip(size);
    }
    await reader.skip(tarPadding(size).length);
  }
}
