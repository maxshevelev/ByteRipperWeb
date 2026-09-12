/**
 * A ZIP writer, in about two hundred lines.
 *
 * Save All as Separate Files needs a folder to put them in, and only Chromium
 * offers one (D7). Everywhere else the honest answer is a single download, and
 * a download of several files is an archive.
 *
 * No dependency for it: the format's writing half is four record layouts and a
 * CRC, and the compression is the platform's own `CompressionStream`. A library
 * would be a dependency for the part that is already in the browser.
 *
 * Deflate where the browser has it, stored where it does not — either way the
 * result is a plain ZIP any tool opens. Firmware dumps deflate well, which is
 * the difference between a 32 MB download and a 3 MB one.
 *
 * **The archive is built in memory.** A download is handed a blob, so its bytes
 * exist at once whatever this does; the alternative — a streamed download —
 * needs a service worker, which is a deployment concern this application does
 * not otherwise have. The size ceiling below is the real limit of that, and it
 * is refused rather than silently truncated.
 */

import type { Bytes } from "@/core/storage/byteStorage";

/** ZIP's 32-bit fields stop here; past it an archive needs ZIP64. */
const SIZE_CEILING = 0xffff_ffff;

export class ZipTooLarge extends Error {
  constructor() {
    super(
      "This set of segments is too large for a single ZIP download. Save them to a folder " +
        "instead, or save the pieces one at a time."
    );
    this.name = "ZipTooLarge";
  }
}

interface ZipEntry {
  readonly name: Bytes;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
  readonly body: Bytes[];
}

export class ZipArchive {
  private readonly entries: ZipEntry[] = [];
  private offset = 0;

  /** Whether this browser can deflate. Stored entries are still valid ZIP. */
  static canCompress(): boolean {
    return typeof CompressionStream !== "undefined";
  }

  /**
   * Adds one file. `chunks` is consumed as it arrives, so a large piece is
   * compressed as it streams rather than assembled first.
   */
  async add(name: string, chunks: AsyncIterable<Bytes>): Promise<void> {
    const raw: Bytes[] = [];
    let size = 0;
    let crc = 0xffff_ffff;
    for await (const chunk of chunks) {
      crc = crc32Update(crc, chunk);
      size += chunk.length;
      raw.push(chunk);
    }
    crc = (crc ^ 0xffff_ffff) >>> 0;

    const deflated = ZipArchive.canCompress() ? await deflate(raw) : undefined;
    // A deflate that came out larger than the input — already-compressed bytes,
    // or a tiny file — is stored instead. The format allows both per entry.
    const useDeflate = deflated !== undefined && byteLength(deflated) < size;
    const body = useDeflate && deflated !== undefined ? deflated : raw;
    const compressedSize = byteLength(body);

    if (size > SIZE_CEILING || compressedSize > SIZE_CEILING) throw new ZipTooLarge();

    const encoded = new TextEncoder().encode(name) as Bytes;
    const entry: ZipEntry = {
      name: encoded,
      method: useDeflate ? 8 : 0,
      crc,
      compressedSize,
      size,
      offset: this.offset,
      body,
    };
    this.entries.push(entry);
    this.offset += 30 + encoded.length + compressedSize;
    if (this.offset > SIZE_CEILING) throw new ZipTooLarge();
  }

  /** The finished archive. */
  build(): Blob {
    const parts: BlobPart[] = [];
    for (const entry of this.entries) {
      parts.push(localHeader(entry), entry.name, ...entry.body);
    }
    const directoryOffset = this.offset;
    let directorySize = 0;
    for (const entry of this.entries) {
      const header = centralHeader(entry);
      parts.push(header, entry.name);
      directorySize += header.length + entry.name.length;
    }
    parts.push(endOfDirectory(this.entries.length, directorySize, directoryOffset));
    return new Blob(parts, { type: "application/zip" });
  }
}

function byteLength(chunks: readonly Bytes[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

async function deflate(chunks: readonly Bytes[]): Promise<Bytes[] | undefined> {
  try {
    // "deflate-raw" is the bare stream ZIP stores; "deflate" would add a zlib
    // header and every unzip would reject the entry.
    const stream = new CompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    const pump = (async () => {
      for (const chunk of chunks) await writer.write(chunk);
      await writer.close();
    })();
    const out: Bytes[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) out.push(value as Bytes);
    }
    await pump;
    return out;
  } catch {
    // A browser that has the constructor but not this format: store instead.
    return undefined;
  }
}

/** The DOS date every writer stamps when it has nothing better. */
function dosDateTime(at = new Date()): { time: number; date: number } {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

const STAMP = dosDateTime();

function localHeader(entry: ZipEntry): Bytes {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x0403_4b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, 0x0800, true); // the name is UTF-8
  view.setUint16(8, entry.method, true);
  view.setUint16(10, STAMP.time, true);
  view.setUint16(12, STAMP.date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.compressedSize, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.name.length, true);
  view.setUint16(28, 0, true);
  return header;
}

function centralHeader(entry: ZipEntry): Bytes {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x0201_4b50, true);
  view.setUint16(4, 20, true); // version made by
  view.setUint16(6, 20, true); // version needed
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, STAMP.time, true);
  view.setUint16(14, STAMP.date, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.compressedSize, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(38, 0, true); // external attributes
  view.setUint32(42, entry.offset, true);
  return header;
}

function endOfDirectory(count: number, size: number, offset: number): Bytes {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x0605_4b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return record;
}

/** The table is built once; a per-byte loop over the polynomial is 8× slower. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb8_8320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, bytes: Bytes): number {
  let result = crc;
  for (const byte of bytes) {
    result = ((result >>> 8) ^ (CRC_TABLE[(result ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return result;
}
