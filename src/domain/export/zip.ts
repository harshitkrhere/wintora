/**
 * A ZIP writer, STORE method only.
 *
 * Everything that goes into a case bundle is already compressed (PDF, JPEG,
 * PNG, DOCX) or small (plain text), so deflating it again would cost CPU on a
 * serverless function for nothing. Storing also means no dependency and no
 * zlib: the whole format is a handful of little-endian headers around the
 * bytes as they are.
 *
 * Pure module: no I/O.
 */

export interface ZipEntry {
  /** Forward slashes for folders. UTF-8. */
  readonly name: string;
  readonly data: Uint8Array;
  readonly modified?: Date;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as the format requires. Two-second resolution. */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, d.getUTCFullYear()));
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  return { date, time };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

const MAX_ENTRIES = 65_000;
const MAX_BYTES = 0xfffffffe;

/** Duplicate names would be silently shadowed by most extractors; refuse. */
function assertUniqueNames(entries: readonly ZipEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new RangeError(`zip: duplicate entry name "${e.name}"`);
    seen.add(e.name);
  }
}

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new RangeError('zip: too many entries');
  assertUniqueNames(entries);

  const encoder = new TextEncoder();
  const out = new ByteWriter();
  const central = new ByteWriter();
  const now = new Date();

  for (const entry of entries) {
    if (entry.data.length > MAX_BYTES) throw new RangeError(`zip: "${entry.name}" is too large`);
    const name = encoder.encode(entry.name);
    const { date, time } = dosDateTime(entry.modified ?? now);
    const crc = crc32(entry.data);
    const headerOffset = out.offset;

    // Local file header.
    out.u32(0x04034b50);
    out.u16(20); // version needed: 2.0
    out.u16(0x0800); // flags: UTF-8 names
    out.u16(0); // method: store
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(name.length);
    out.u16(0);
    out.push(name);
    out.push(entry.data);

    // Central directory record, written at the end.
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(entry.data.length);
    central.u32(entry.data.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(headerOffset);
    central.push(name);
  }

  const centralOffset = out.offset;
  const centralBytes = central.finish();
  out.push(centralBytes);

  // End of central directory.
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralBytes.length);
  out.u32(centralOffset);
  out.u16(0);

  return out.finish();
}
