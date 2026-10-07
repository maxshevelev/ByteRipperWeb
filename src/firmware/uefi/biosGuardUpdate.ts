import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * An AMI BIOS Guard update file — "PFAT" in AMI's own tag, `<model>.3xx` on an ASUS support
 * page (`UEFI_IMAGE_FORMAT.md` §1.2).
 *
 * Not an image: the BIOS region cut into signed blocks, each with the script the chipset
 * runs to write it, behind a table naming what the blocks are. What a bench wants of it is
 * the region it carries, laid out as the chip holds it, and which part of that region each
 * name covers — so that is what a parse is. The scripts and the signatures are read past,
 * not checked: checking a signature needs the vendor's key, and nothing here writes a block
 * the way the chipset would.
 *
 * The layout is read off one vendor's file against a dump of the same board, not off a
 * published description, and the help says so.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate
 */
export interface BIOSGuardUpdate {
  /**
   * The `PlatformID` the blocks carry — `RAPTORLAKE` — as the file writes it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.platform
   */
  readonly platform: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.entries */
  readonly entries: readonly BIOSGuardEntry[];
  /**
   * The BIOS region the blocks make up, in the order the chip holds it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.region
   */
  readonly region: Uint8Array;
}

/**
 * One line of the file's table: a part of the BIOS region the flasher writes as a unit, made
 * of `blockCount` blocks.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Entry
 */
export interface BIOSGuardEntry {
  /**
   * What the table calls it — `FV_MAIN_WRAPPER`, `NVRAM`, `AsusNVRAM`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Entry.name
   */
  readonly name: string;
  /**
   * The flasher's switch for it — `/P`, `/N`, `/OA` — or empty where the line names none.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Entry.key
   */
  readonly key: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Entry.blockCount */
  readonly blockCount: number;
  /**
   * Where it lies in the BIOS region, from the region's first byte.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Entry.range
   */
  readonly range: ImageRange;
}

/**
 * Why a file did not read as an update.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Problem
 */
export type BIOSGuardProblem =
  /** No `_AMIPFAT` header at the start. */
  | { readonly kind: "notAnUpdate" }
  /** A header whose table names no blocks. */
  | { readonly kind: "noEntries" }
  /** The file ends inside a block: its index, from 0. */
  | { readonly kind: "truncated"; readonly block: number }
  /** What stands where a block should start does not read as one. */
  | { readonly kind: "notABlock"; readonly block: number };

/**
 * Where everything in an update file is, read from its headers alone: the table, and where
 * each block's data lies. Nothing of the data is copied — a tree that only wants to list the
 * entries reads a few kilobytes of a file of tens of megabytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout
 */
export interface BIOSGuardLayout {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.headerSize */
  readonly headerSize: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.platform */
  readonly platform: string;
  /**
   * The entries, placed in the region the blocks make up.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.entries
   */
  readonly entries: readonly BIOSGuardEntry[];
  /**
   * Each block's data, in the reader's offsets, in the order the region holds them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.blocks
   */
  readonly blocks: readonly ImageRange[];
  /**
   * Where the last block — its signature included — ends. What follows is the vendor's own
   * and not part of the update.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.end
   */
  readonly end: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.tag */
const TAG = [...("_AMIPFAT" as string)].map((character) => character.charCodeAt(0));
/**
 * Size, checksum, tag and flags: where the table's text begins.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.textStart
 */
const TEXT_START = 0x11;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.blockHeaderSize */
const BLOCK_HEADER_SIZE = 0x30;
/**
 * The signature's own header, then an RSA-2048 or an RSA-3072 key and signature: modulus, a
 * 4-byte exponent, signature.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.signatureSizes
 */
const SIGNATURE_SIZES = [8 + 256 + 4 + 256, 8 + 384 + 4 + 384];

/** The size of the BIOS region the blocks make up. @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.Layout.regionSize */
export const regionSize = (layout: BIOSGuardLayout): number =>
  layout.blocks.reduce((sum, block) => sum + (block.end - block.start), 0);

/**
 * Whether an update file starts at `offset` — what lets a caller say "this is not one" before
 * anything else is read.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.isUpdate
 */
export function isBIOSGuardUpdate(reader: ImageReader, offset = 0): boolean {
  const found = reader.bytesAt(offset + 8, TAG.length);
  return found !== undefined && TAG.every((byte, index) => found[index] === byte);
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.layout
 */
export function biosGuardLayout(
  reader: ImageReader,
  offset = 0
):
  | { readonly ok: true; readonly layout: BIOSGuardLayout }
  | { readonly ok: false; readonly problem: BIOSGuardProblem } {
  const fail = (problem: BIOSGuardProblem) => ({ ok: false, problem }) as const;
  const size = isBIOSGuardUpdate(reader, offset) ? reader.uint32(offset) : undefined;
  if (size === undefined) return fail({ kind: "notAnUpdate" });
  const headerSize = size;
  const text =
    headerSize >= TEXT_START && offset + headerSize <= reader.count
      ? reader.bytesAt(offset + TEXT_START, headerSize - TEXT_START)
      : undefined;
  if (text === undefined) return fail({ kind: "notAnUpdate" });

  const lines = biosGuardTable(text);
  const total = lines.reduce((sum, line) => sum + line.blockCount, 0);
  if (total === 0) return fail({ kind: "noEntries" });

  const blocks: ImageRange[] = [];
  let platform = "";
  let at = offset + headerSize;
  for (let index = 0; index < total; index++) {
    if (at + BLOCK_HEADER_SIZE > reader.count) return fail({ kind: "truncated", block: index });
    const id = platformID(reader, at + 4);
    if (id === undefined || (index > 0 && id !== platform)) {
      return fail({ kind: "notABlock", block: index });
    }
    platform = id;
    const attributes = reader.uint32(at + 0x14);
    const scriptSize = reader.uint32(at + 0x1c);
    const dataSize = reader.uint32(at + 0x20);
    if (attributes === undefined || scriptSize === undefined || dataSize === undefined) {
      return fail({ kind: "truncated", block: index });
    }
    const dataStart = at + BLOCK_HEADER_SIZE + scriptSize;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > reader.count) return fail({ kind: "truncated", block: index });
    blocks.push({ start: dataStart, end: dataEnd });
    at = dataEnd;
    if ((attributes & 1) !== 0) {
      const signature = signatureSize(reader, at, platform, index === total - 1);
      if (signature === undefined) return fail({ kind: "truncated", block: index });
      at += signature;
    }
  }

  const entries: BIOSGuardEntry[] = [];
  let block = 0;
  let start = 0;
  for (const line of lines) {
    let length = 0;
    for (const one of blocks.slice(block, block + line.blockCount)) length += one.end - one.start;
    entries.push({
      name: line.name,
      key: line.key,
      blockCount: line.blockCount,
      range: { start, end: start + length },
    });
    block += line.blockCount;
    start += length;
  }
  return { ok: true, layout: { headerSize, platform, entries, blocks, end: at } };
}

/**
 * The BIOS region the blocks make up, read out of `reader`; nothing when the reader no
 * longer holds them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.region
 */
export function biosGuardRegion(
  layout: BIOSGuardLayout,
  reader: ImageReader
): Uint8Array | undefined {
  const region = new Uint8Array(regionSize(layout));
  let at = 0;
  for (const block of layout.blocks) {
    const bytes = reader.bytes(block);
    if (bytes === undefined) return undefined;
    region.set(bytes, at);
    at += bytes.length;
  }
  return region;
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.parse
 */
export function parseBIOSGuardFile(
  reader: ImageReader
):
  | { readonly ok: true; readonly update: BIOSGuardUpdate }
  | { readonly ok: false; readonly problem: BIOSGuardProblem } {
  const read = biosGuardLayout(reader);
  if (!read.ok) return read;
  const region = biosGuardRegion(read.layout, reader);
  if (region === undefined) return { ok: false, problem: { kind: "truncated", block: 0 } };
  return {
    ok: true,
    update: { platform: read.layout.platform, entries: read.layout.entries, region },
  };
}

/** How many blocks the file carries. @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.blockCount */
export const biosGuardBlockCount = (update: BIOSGuardUpdate): number =>
  update.entries.reduce((sum, entry) => sum + entry.blockCount, 0);

/**
 * The table's lines, `<n> /<KEY> <blocks> ;<NAME>`, after the title line. A line that does
 * not read as one is not an entry; a key is optional.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.table
 */
export function biosGuardTable(
  text: Uint8Array
): { name: string; key: string; blockCount: number }[] {
  const lines = utf8(text)
    .split(/[\n\r\v\f\u0085\u2028\u2029]/)
    .filter((line) => line !== "");
  const entries: { name: string; key: string; blockCount: number }[] = [];
  for (const line of lines.slice(1)) {
    const at = line.indexOf(";");
    if (at < 0) continue;
    const name = line.slice(at + 1).trim();
    const fields = line
      .slice(0, at)
      .split(/\s+/)
      .filter((field) => field !== "");
    const last = fields[fields.length - 1];
    if (name === "" || last === undefined || !/^\d+$/.test(last)) continue;
    const blockCount = Number(last);
    if (blockCount <= 0) continue;
    const key = fields.slice(0, -1).find((field) => field.startsWith("/")) ?? "";
    entries.push({ name, key, blockCount });
  }
  return entries;
}

/** The bytes as UTF-8 text, the way a file's table is written; a byte that is none reads as itself. */
function utf8(bytes: Uint8Array): string {
  let escaped = "";
  for (const byte of bytes) escaped += `%${byte.toString(16).padStart(2, "0")}`;
  try {
    return decodeURIComponent(escaped);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/**
 * A block's `PlatformID`: printable ASCII, NUL-padded to 16 bytes, at least one character.
 * Nothing when the 16 bytes are anything else — which is how a block that is not where it
 * should be is told.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.platformID
 */
function platformID(reader: ImageReader, at: number): string | undefined {
  const field = reader.bytesAt(at, 16);
  if (field === undefined) return undefined;
  let length = 0;
  while (length < 16 && field[length] !== 0) length++;
  if (length === 0) return undefined;
  for (let index = 0; index < 16; index++) {
    const byte = field[index] ?? 0;
    if (index < length ? byte < 0x20 || byte > 0x7e : byte !== 0) return undefined;
  }
  return String.fromCharCode(...field.subarray(0, length));
}

/**
 * How long the signature after a block's data is. The file does not say, so each size a key
 * can have is tried: the right one is where the next block starts with the same platform.
 * After the last block, or where no size leads to one, it is the first that fits in the file
 * — and a next block that is not there is then said to be missing, not this signature.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#BIOSGuardUpdate.signatureSize
 */
function signatureSize(
  reader: ImageReader,
  at: number,
  platform: string,
  isLast: boolean
): number | undefined {
  const fitting = SIGNATURE_SIZES.filter((size) => at + size <= reader.count);
  if (isLast) return fitting[0];
  return (
    fitting.find(
      (size) =>
        at + size + BLOCK_HEADER_SIZE <= reader.count &&
        platformID(reader, at + size + 4) === platform
    ) ?? fitting[0]
  );
}

/**
 * The update file starting at `offset`, as the node over its header and blocks; nothing when
 * there is none, which is the usual answer.
 *
 * Its children are not read here: they are in the region the blocks assemble to, which is a
 * copy of megabytes, and the tree makes it when the row is opened (`TreeMaterialization`), as
 * it decodes a compressed section then.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#Parser.parseBIOSGuardUpdate
 */
export function parseBIOSGuardUpdate(
  parser: Parser,
  options: { readonly offset: number; readonly limit: number; readonly depth: number }
): UEFINode | undefined {
  const { offset, limit, depth } = options;
  if (!isBIOSGuardUpdate(parser.reader, offset)) return undefined;
  const read = biosGuardLayout(parser.reader, offset);
  if (!read.ok || read.layout.end > limit) return undefined;
  const { layout } = read;
  return makeNode({
    kind: "biosGuardUpdate",
    name: "AMI BIOS Guard update",
    header: { start: offset, end: offset + layout.headerSize },
    body: { start: offset + layout.headerSize, end: layout.end },
    compression: { algorithm: "BIOS Guard", decodes: true },
    isExpandable: true,
    childDepth: depth + 1,
  });
}

/**
 * The entries of the update whose header is at `offset`, as rows over the assembled region:
 * each a stretch of it, left closed until it is opened.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSGuardUpdate.swift#Parser.biosGuardEntries
 */
export function biosGuardEntries(parser: Parser, offset: number, depth: number): UEFINode[] {
  const read = biosGuardLayout(parser.reader, offset);
  if (!read.ok) return [];
  return read.layout.entries.map((entry) =>
    makeNode({
      kind: "biosGuardEntry",
      name: entry.name,
      header: { start: entry.range.start, end: entry.range.start },
      body: entry.range,
      isExpandable: entry.range.end > entry.range.start,
      childDepth: depth + 1,
    })
  );
}
