import { tagBytes } from "@/firmware/me/bytes";
import { crc32 } from "@/firmware/me/crypto/checksum";

/**
 * Synthetic ME regions, built byte by byte.
 *
 * No real dump goes into this repository, so every structure a parser is tested
 * against is built here — and the ones worth testing are the malformed ones
 * anyway: a partition count that reads past the entries, a `$FPT` that is not
 * where the marker says, a table whose checksum was written before the edit.
 */

export class MEWriter {
  private readonly parts: number[] = [];

  get count(): number {
    return this.parts.length;
  }

  get bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }

  u8(value: number): this {
    this.parts.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }

  u24(value: number): this {
    return this.u16(value).u8(value >>> 16);
  }

  u32(value: number): this {
    return this.u16(value).u16(value >>> 16);
  }

  raw(bytes: Uint8Array | readonly number[]): this {
    for (const byte of bytes) this.parts.push(byte & 0xff);
    return this;
  }

  text(value: string, width = value.length): this {
    for (let index = 0; index < width; index++) this.parts.push(value.charCodeAt(index) || 0);
    return this;
  }

  fill(count: number, byte = 0): this {
    for (let index = 0; index < count; index++) this.parts.push(byte & 0xff);
    return this;
  }

  /** Pads to `size` with `byte`, which is how every region here ends. */
  padTo(size: number, byte = 0xff): this {
    return this.fill(Math.max(0, size - this.parts.length), byte);
  }
}

/** Writes a little-endian word into bytes already written. */
export function putU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

export interface TestPartition {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly flags?: number;
}

/**
 * A minimal `$FPT` v2.0 header — exactly 0x20 bytes — and its entries at
 * `anchor`. A header version of 0x20 with a zero second checksum word resolves
 * to v2.0 rather than to the v2.1 the quirk branch looks for.
 */
export function fptRegion(options: {
  readonly anchor?: number;
  readonly entries: readonly TestPartition[];
  readonly headerVersion?: number;
  readonly headerLength?: number;
  readonly entryCount?: number;
  readonly secondCrcWord?: number;
  readonly size?: number;
  readonly fill?: number;
}): Uint8Array {
  const anchor = options.anchor ?? 0;
  const writer = new MEWriter()
    .fill(anchor, options.fill ?? 0)
    .raw(tagBytes("$FPT"))
    .u32(options.entryCount ?? options.entries.length)
    .u8(options.headerVersion ?? 0x20)
    .u8(0x10) // EntryVersion
    .u8(options.headerLength ?? 0x20)
    .u8(0) // Flags
    .u16(0) // TicksToAdd
    .u16(0) // TokensToAdd
    .u32(0) // SPS/UMA
    .u16(0) // the first checksum word
    .u16(options.secondCrcWord ?? 0)
    .u16(0) // FitMajor
    .u16(0) // FitMinor
    .u16(0) // FitHotfix
    .u16(0); // FitBuild

  for (const entry of options.entries) {
    writer
      .text(entry.name.padEnd(4, "\0").slice(0, 4), 4)
      .u32(0) // Owner
      .u32(entry.offset)
      .u32(entry.size)
      .u32(0) // StartTokens
      .u32(0) // MaxTokens
      .u32(0) // ScratchSectors
      .u32(entry.flags ?? 0);
  }
  return options.size === undefined ? writer.bytes : writer.padTo(options.size, 0xff).bytes;
}

/**
 * A Flash Descriptor whose Engine region is `[base, base + size)`, and nothing
 * else — the one fact the `$FPT` spine reads off one.
 */
export function descriptorWithMeRegion(options: {
  readonly base: number;
  readonly size: number;
  readonly total: number;
}): Uint8Array {
  const bytes = new Uint8Array(Math.max(options.total, 0x1000)).fill(0x00);
  bytes.set([0x5a, 0xa5, 0xf0, 0x0f], 0x10);
  bytes[0x14] = 0x01; // one strap
  bytes.fill(0xff, 0xc0, 0xd0);
  // FLREG2's base and limit, both counted in 4 KB blocks.
  const base = options.base / 0x1000;
  const limit = (options.base + options.size) / 0x1000 - 1;
  bytes[0x48] = base & 0xff;
  bytes[0x49] = (base >>> 8) & 0xff;
  bytes[0x4a] = limit & 0xff;
  bytes[0x4b] = (limit >>> 8) & 0xff;
  return bytes;
}

/** A module's place inside a `$CPD`, when the fixture puts real content there. */
export interface TestModule {
  readonly name: string;
  readonly offset?: number;
  readonly size?: number;
}

/**
 * A `$CPD` directory: the header and its entries, with the revision's own
 * checksum computed over the whole of it.
 *
 * Revision 1 stores a checksum-8 in a byte and revision 2 a CRC-32 in a word —
 * which is exactly the kind of thing a fixture must get right, since a decoder
 * that agreed with a fixture computing its checksum the same wrong way would
 * agree with nothing real.
 */
export function cpdDirectory(options: {
  readonly name: string;
  readonly headerVersion?: number;
  readonly modules?: readonly TestModule[];
  readonly numModules?: number;
}): Uint8Array {
  const headerVersion = options.headerVersion ?? 1;
  const headerLength = headerVersion === 2 ? 0x14 : 0x10;
  const modules = options.modules ?? [{ name: "$MN2" }];
  const bytes = new Uint8Array(headerLength + modules.length * 0x18);

  bytes.set(tagBytes("$CPD"));
  putU32(bytes, 0x04, options.numModules ?? modules.length);
  bytes[0x08] = headerVersion;
  bytes[0x09] = 1;
  bytes[0x0a] = headerLength;
  for (let index = 0; index < 4; index++) {
    bytes[0x0c + index] = options.name.charCodeAt(index) || 0;
  }

  modules.forEach((module, index) => {
    const entry = headerLength + index * 0x18;
    for (let at = 0; at < Math.min(12, module.name.length); at++) {
      bytes[entry + at] = module.name.charCodeAt(at);
    }
    putU32(bytes, entry + 0x0c, module.offset ?? 0);
    putU32(bytes, entry + 0x10, module.size ?? 0);
  });

  if (headerVersion === 1) {
    let sum = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (index !== 0x0b) sum += bytes[index] ?? 0;
    }
    bytes[0x0b] = (0x100 - (sum & 0xff)) & 0xff;
  } else {
    putU32(bytes, 0x10, crc32(bytes));
  }
  return bytes;
}

/** How a manifest fixture differs from the ordinary CSE one. */
export interface TestManifest {
  readonly tag?: string;
  readonly format?: "r0" | "r1" | "r2";
  readonly flags?: number;
  readonly headerLength?: number;
  /** Packed BCD on the wire, as the format stores them: 0x24 is the 24th. */
  readonly day?: number;
  readonly month?: number;
  readonly year?: number;
  readonly major?: number;
  readonly minor?: number;
  readonly hotfix?: number;
  readonly build?: number;
  readonly svn?: number;
  readonly meMajor?: number;
  readonly meMinor?: number;
  readonly meHotfix?: number;
  readonly meBuild?: number;
  readonly vcn?: number;
  readonly numModules?: number;
  readonly publicKeySize?: number;
  readonly key?: Uint8Array;
  readonly signature?: Uint8Array;
  /** The whole manifest's size, in dwords, as the field at 0x18 stores it. */
  readonly manifestSize?: number;
  /** The buffer to build in, when a test wants room after the struct. */
  readonly region?: number;
}

/**
 * A `$MN2` or `$MAN` manifest, its struct base at offset 0.
 *
 * The version, date and key fields sit at the same places in all three formats;
 * what differs is whether 0x20, 0x30 and 0x34 hold a module count and a version
 * control number or a build tag and the MEU block. The fixture writes whichever
 * the requested format would have, so a decoder that read the wrong one reads
 * the wrong thing rather than a zero.
 */
export function manifest(options: TestManifest = {}): Uint8Array {
  const format = options.format ?? "r1";
  const bytes = new Uint8Array(Math.max(options.region ?? 0, 0x284));
  const put16 = (at: number, value: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >>> 8) & 0xff;
  };

  putU32(bytes, 0x04, options.headerLength ?? 0xa1); // in dwords
  putU32(bytes, 0x08, format === "r2" ? 0x2_1000 : 0x1_0000);
  putU32(bytes, 0x0c, options.flags ?? 0x1); // production, not debug
  putU32(bytes, 0x18, options.manifestSize ?? 0xa1); // in dwords, like the header
  put16(0x10, 0x8086); // the vendor id the anchor scan looks for
  bytes[0x14] = options.day ?? 0x24;
  bytes[0x15] = options.month ?? 0x03;
  put16(0x16, options.year ?? 0x2021);
  for (const [index, character] of [...(options.tag ?? "$MN2")].entries()) {
    bytes[0x1c + index] = character.charCodeAt(0);
  }
  // A small value here makes this the pre-CSE format and a large one a build
  // tag, which is the dispatch itself.
  putU32(bytes, 0x20, format === "r0" ? (options.numModules ?? 4) : 0x1000_0000);
  put16(0x24, options.major ?? 15);
  put16(0x26, options.minor ?? 40);
  put16(0x28, options.hotfix ?? 37);
  put16(0x2a, options.build ?? 3121);
  putU32(bytes, 0x2c, options.svn ?? 3);
  put16(0x30, options.meMajor ?? 15);
  put16(0x32, options.meMinor ?? 40);
  if (format === "r0") {
    putU32(bytes, 0x34, options.vcn ?? 2);
  } else {
    put16(0x34, options.meHotfix ?? 0);
    put16(0x36, options.meBuild ?? 0);
  }
  putU32(bytes, 0x78, options.publicKeySize ?? 0x40); // in dwords
  putU32(bytes, 0x7c, 1); // one dword of exponent
  bytes.set(options.key ?? Uint8Array.from({ length: 0x100 }, (_, i) => i & 0xff), 0x80);
  bytes.set([0x01, 0x00, 0x01, 0x00], 0x180); // 65537
  bytes.set(
    options.signature ?? Uint8Array.from({ length: 0x100 }, (_, i) => (0xff - i) & 0xff),
    0x184
  );
  return bytes;
}

/** A region whose manifest sits past some leading filler. */
export function regionWithManifest(base: number, options: TestManifest = {}): Uint8Array {
  const one = manifest(options);
  const bytes = new Uint8Array(base + one.length);
  bytes.set(one, base);
  return bytes;
}
