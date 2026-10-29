import { decodeUtf8 } from "@/core/text/utf";

/**
 * One compiled map file (`BRM1`): the envelope every family of descriptions
 * ships in — the descriptor's strap tables and registers, the ME
 * configuration, the UEP/FPF layouts, the GPIO pins and CSME 18's layouts.
 *
 * The descriptions are maintained upstream as JSON and compiled there by
 * `Skills/me-eom-structures/scripts/map_bin.py`; the web takes the binaries as
 * they are (upstream's `Design/MAP_DATA.md`, "The web edition"). This module is
 * the header, the section table, the string pool and the checksum; what a
 * record means belongs to the reader of its kind. Every read checks its
 * bounds: a truncated or edited file throws rather than reading past its end.
 */

/**
 * The map kinds the envelope carries. A file states one in its header; the
 * record layouts inside are the reader's, per kind.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapKind
 */
export const MapKind = {
  strap: 1,
  configuration: 2,
  uep: 3,
  gpio: 4,
  register: 5,
  layout: 6,
} as const;
export type MapKind = (typeof MapKind)[keyof typeof MapKind];

/**
 * The envelope's sections. A reader skips one it does not know.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapSection
 */
export const MapSection = {
  strings: 1,
  maps: 2,
  fields: 3,
  options: 4,
  // Kind 2 uses its own record sections:
  files: 5,
  settings: 6,
  // Kind 5:
  registers: 7,
  // Kind 6:
  containers: 8,
  anchors: 9,
  layoutFields: 10,
} as const;
export type MapSection = (typeof MapSection)[keyof typeof MapSection];

/**
 * Why a map resource cannot be used.
 *
 * The reader reports this rather than interpreting bytes whose layout it cannot
 * trust: a stale resource and a corrupt one both mean "no map", which the
 * panels already know how to show.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapDataError
 */
export type MapDataFailure =
  | { readonly kind: "resourceMissing"; readonly name: string }
  | { readonly kind: "badMagic" }
  | { readonly kind: "unsupportedFormat"; readonly format: number }
  | { readonly kind: "versionMismatch"; readonly file: number; readonly code: number }
  | { readonly kind: "wrongKind"; readonly mapKind: number }
  | { readonly kind: "corrupt"; readonly reason: string };

/**
 * A {@link MapDataFailure} thrown, with upstream's sentence for it.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapDataError.description
 */
export class MapDataError extends Error {
  readonly failure: MapDataFailure;

  constructor(failure: MapDataFailure) {
    super(describeFailure(failure));
    this.name = "MapDataError";
    this.failure = failure;
  }
}

function describeFailure(failure: MapDataFailure): string {
  switch (failure.kind) {
    case "resourceMissing":
      return `the map resource ${failure.name} is not in the bundle`;
    case "badMagic":
      return "the map resource is not a BRM1 file";
    case "unsupportedFormat":
      return `the map resource is format ${failure.format}; this code reads ${MAP_FORMAT_VERSION}`;
    case "versionMismatch":
      return `the map resource is version ${failure.file}; this code was marked with version ${failure.code}`;
    case "wrongKind":
      return `the map resource is kind ${failure.mapKind}`;
    case "corrupt":
      return `the map resource is corrupt: ${failure.reason}`;
  }
}

const corrupt = (reason: string): MapDataError => new MapDataError({ kind: "corrupt", reason });

/** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.formatVersion */
export const MAP_FORMAT_VERSION = 1;

/** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.noReference */
export const NO_REFERENCE = 0xffff_ffff;

/**
 * One section's place in the file. `end` is half-open.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.Section
 */
export interface MapFileSection {
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.Section.offset */
  readonly offset: number;
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.Section.length */
  readonly length: number;
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.Section.end */
  readonly end: number;
}

/**
 * One compiled map file, validated before any record is read.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile
 */
export class MapFile {
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.bytes */
  readonly bytes: Uint8Array;
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.kind */
  readonly kind: MapKind;
  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.version */
  readonly version: number;
  private readonly sections: ReadonlyMap<number, MapFileSection>;

  /**
   * Reads and validates the envelope.
   *
   * @param expectedVersion the version the code was marked with; a file of
   *   another version is refused before a section is read.
   * @param expectedFormat the layout the reader was written for.
   * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.init
   */
  constructor(bytes: Uint8Array, expectedVersion: number, expectedFormat = MAP_FORMAT_VERSION) {
    if (bytes.length < 32) throw corrupt("short header");
    this.bytes = bytes;
    if (bytes[0] !== 0x42 || bytes[1] !== 0x52 || bytes[2] !== 0x4d || bytes[3] !== 0x31) {
      throw new MapDataError({ kind: "badMagic" });
    }
    const format = this.u16(4);
    if (format !== expectedFormat) {
      throw new MapDataError({ kind: "unsupportedFormat", format });
    }
    const version = this.u32(8);
    if (version !== expectedVersion) {
      throw new MapDataError({ kind: "versionMismatch", file: version, code: expectedVersion });
    }
    const kind = this.u16(12);
    if (!(Object.values(MapKind) as number[]).includes(kind)) {
      throw new MapDataError({ kind: "wrongKind", mapKind: kind });
    }
    const headerSize = this.u16(6);
    const sectionCount = this.u32(16);
    const sections = new Map<number, MapFileSection>();
    for (let index = 0; index < sectionCount; index += 1) {
      const at = headerSize + index * 12;
      const sectionKind = this.u16(at);
      const offset = this.u32(at + 4);
      const length = this.u32(at + 8);
      if (offset + length > bytes.length) {
        throw corrupt(`section ${sectionKind} runs past the file`);
      }
      sections.set(sectionKind, { offset, length, end: offset + length });
    }
    const stored = this.u32(20);
    const zeroed = bytes.slice();
    zeroed.fill(0, 20, 24);
    if (fnv1a32(zeroed) !== stored) {
      throw corrupt("the checksum does not match the bytes");
    }
    this.kind = kind as MapKind;
    this.version = version;
    this.sections = sections;
  }

  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.section */
  section(kind: MapSection): MapFileSection | undefined {
    return this.sections.get(kind);
  }

  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.requireSection */
  requireSection(kind: MapSection): MapFileSection {
    const section = this.section(kind);
    if (section === undefined) {
      const name = Object.entries(MapSection).find(([, value]) => value === kind)?.[0] ?? kind;
      throw corrupt(`the ${name} section the format requires is absent`);
    }
    return section;
  }

  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.u16 */
  u16(at: number): number {
    if (at < 0 || at + 2 > this.bytes.length) {
      throw corrupt(`a 16-bit read at ${at} is outside the file`);
    }
    return (this.bytes[at] ?? 0) | ((this.bytes[at + 1] ?? 0) << 8);
  }

  /** @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.u32 */
  u32(at: number): number {
    if (at < 0 || at + 4 > this.bytes.length) {
      throw corrupt(`a 32-bit read at ${at} is outside the file`);
    }
    // Multiplied rather than shifted into the top byte: a shift is 32-bit and signed here.
    return (
      ((this.bytes[at] ?? 0) |
        ((this.bytes[at + 1] ?? 0) << 8) |
        ((this.bytes[at + 2] ?? 0) << 16)) +
      (this.bytes[at + 3] ?? 0) * 0x100_0000
    );
  }

  /**
   * A signed 32-bit read: a setting's condition value is one.
   *
   * @web-only upstream reads the same four bytes as `Int32(bitPattern:)` at its one caller
   */
  i32(at: number): number {
    return this.u32(at) | 0;
  }

  /** @web-only a single byte, which upstream reads straight off `bytes` with the record's bounds already checked */
  u8(at: number): number {
    if (at < 0 || at >= this.bytes.length) {
      throw corrupt(`an 8-bit read at ${at} is outside the file`);
    }
    return this.bytes[at] ?? 0;
  }

  /**
   * A string from the pool, or `undefined` for {@link NO_REFERENCE}.
   *
   * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.string
   */
  string(reference: number): string | undefined {
    if (reference === NO_REFERENCE) return undefined;
    const section = this.requireSection(MapSection.strings);
    const start = section.offset + reference;
    if (start < section.offset || start >= section.end) {
      throw corrupt("a string reference is outside the pool");
    }
    let end = start;
    while (end < section.end && this.bytes[end] !== 0) end += 1;
    if (end >= section.end) throw corrupt(`an unterminated string at ${start}`);
    // A malformed sequence decodes as U+FFFD, which no description carries.
    const text = decodeUtf8(this.bytes.subarray(start, end));
    if (text.includes("\uFFFD")) throw corrupt(`a string is not UTF-8 at ${start}`);
    return text;
  }

  /**
   * The bounds a record array of `count × size` bytes needs, checked against
   * its section before the first record is read. Returns the array's first byte.
   *
   * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.records
   */
  records(
    section: MapFileSection,
    offset: number,
    count: number,
    size: number,
    name: string
  ): number {
    if (offset < 0 || count < 0 || size <= 0 || offset + count * size > section.length) {
      throw corrupt(`the ${name} records run past their section`);
    }
    return section.offset + offset;
  }
}

/**
 * FNV-1a, 32 bits, over `bytes`: the file's checksum, computed with its own
 * field zeroed.
 *
 * @upstream Packages/MapData/Sources/MapData/MapFile.swift#MapFile.fnv1a32
 */
export function fnv1a32(bytes: Uint8Array): number {
  let value = 2_166_136_261;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value >>> 0;
}
