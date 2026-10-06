import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * AMI's GPNV store, where ASUS keeps what the factory wrote of the machine
 * (`UEFI_IMAGE_FORMAT.md` §9): the board's serial numbers, the model, the Windows key —
 * what the bench calls the DMI area. A run of records, each written whole after the last,
 * the one before it of the same name marked replaced; nothing is erased until the whole
 * store is. Found on two ASUS laptops, an AMD one inside a volume of its own and an Intel
 * one in the padding after NVRAM. The layout is read off those dumps, not a published one,
 * and the help says so.
 *
 * ```
 * 0x00  "GPNV"
 * 0x04  the record's length, header included (UInt16)
 * 0x06  1 for the record in force, 0 for one a later record replaced
 * 0x07  the name, four characters and a NUL: "MFG0", "CNFG", "OA30", "_DMI"
 * 0x0C  the data, to the record's length; what is not written is FF
 * ```
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord
 */
export interface GPNVRecord {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.offset */
  readonly offset: number;
  /** The record's length, header included. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.length */
  readonly length: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.name */
  readonly name: string;
  /** The record in force, not one a later record replaced. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.isCurrent */
  readonly isCurrent: boolean;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.headerSize */
export const GPNV_HEADER_SIZE = 0x0c;

/**
 * The store sits at the start of the bytes it is found in, or on a 4 KiB boundary inside
 * them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.alignment
 */
export const GPNV_ALIGNMENT = 0x1000;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.signature */
const SIGNATURE = [0x47, 0x50, 0x4e, 0x56];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.range */
export const gpnvRange = (record: GPNVRecord): ImageRange => ({
  start: record.offset,
  end: record.offset + record.length,
});
/** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.header */
export const gpnvHeader = (record: GPNVRecord): ImageRange => ({
  start: record.offset,
  end: record.offset + GPNV_HEADER_SIZE,
});
/** @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.body */
export const gpnvBody = (record: GPNVRecord): ImageRange => ({
  start: record.offset + GPNV_HEADER_SIZE,
  end: record.offset + record.length,
});

/**
 * The record at `offset`, when its header reads as one and its length ends by `limit`;
 * nothing otherwise, saying nothing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.read
 */
export function readGPNVRecord(
  offset: number,
  limit: number,
  reader: ImageReader
): GPNVRecord | undefined {
  if (offset + GPNV_HEADER_SIZE > limit) return undefined;
  const header = reader.bytes({ start: offset, end: offset + GPNV_HEADER_SIZE });
  if (header === undefined || !SIGNATURE.every((byte, index) => header[index] === byte)) {
    return undefined;
  }
  const length = (header[4] ?? 0) | ((header[5] ?? 0) << 8);
  const state = header[6] ?? 0;
  const name = header.subarray(7, 11);
  if (
    length < GPNV_HEADER_SIZE ||
    offset + length > limit ||
    state > 1 ||
    header[11] !== 0 ||
    !name.every(
      (byte) => byte === 0x5f || (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a)
    )
  ) {
    return undefined;
  }
  return { offset, length, name: String.fromCharCode(...name), isCurrent: state === 1 };
}

/**
 * The records back to back from `offset`, up to the first bytes that are not one; empty
 * when there is none at `offset`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.store
 */
export function readGPNVStore(offset: number, limit: number, reader: ImageReader): GPNVRecord[] {
  const records: GPNVRecord[] = [];
  let at = offset;
  for (;;) {
    const record = readGPNVRecord(at, limit, reader);
    if (record === undefined) return records;
    records.push(record);
    at = record.offset + record.length;
  }
}

/**
 * The product key of an `OA30` record: Microsoft's MSDM data — a version, a data type, the
 * key's length at `0x10` and the key at `0x14`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.productKey
 */
export function gpnvProductKey(body: Uint8Array): string | undefined {
  if (body.length < 0x14) return undefined;
  const length = (body[0x10] ?? 0) | ((body[0x11] ?? 0) << 8);
  if (length === 0 || 0x14 + length > body.length) return undefined;
  const key = body.subarray(0x14, 0x14 + length);
  if (!key.every((byte) => byte >= 0x20 && byte <= 0x7e)) return undefined;
  return String.fromCharCode(...key);
}

/**
 * The runs of printable text in a record's data, at least four characters each, with
 * where each starts in the data. What the fields between them mean is not known.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#GPNVRecord.texts
 */
export function gpnvTexts(body: Uint8Array): { offset: number; text: string }[] {
  const found: { offset: number; text: string }[] = [];
  let start: number | undefined;
  for (let index = 0; index <= body.length; index++) {
    const byte = body[index];
    const printable = byte !== undefined && byte >= 0x20 && byte <= 0x7e;
    if (printable) {
      if (start === undefined) start = index;
      continue;
    }
    if (start !== undefined && index - start >= 4) {
      const text = String.fromCharCode(...body.subarray(start, index)).trim();
      if (text.length > 0) found.push({ offset: start, text });
    }
    start = undefined;
  }
  return found;
}

/**
 * How many of a record's texts its row spells out.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.gpnvRowTexts
 */
export const GPNV_ROW_TEXTS = 3;

/**
 * `MFG0 = M8NRKD00311031C, 90NR0551-M04320, …`: a record's name and the first texts of its
 * data; an `OA30` record's product key.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeDisplay.swift#UEFITreeDisplay.gpnvRow
 */
export function gpnvRowText(name: string, body: Uint8Array | undefined): string {
  if (body === undefined) return name;
  if (name === "OA30") {
    const key = gpnvProductKey(body);
    if (key !== undefined) return `${name} = ${key}`;
  }
  const texts = gpnvTexts(body).map((one) => one.text);
  if (texts.length === 0) return name;
  const shown = texts.slice(0, GPNV_ROW_TEXTS).join(", ");
  return `${name} = ${texts.length > GPNV_ROW_TEXTS ? `${shown}, …` : shown}`;
}

/**
 * The GPNV store at `offset`, as a row with a row per record, and the bytes after its last
 * record up to `end`; nothing when no record starts there.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#Parser.gpnvStore
 */
export function gpnvStore(
  parser: Parser,
  offset: number,
  end: number,
  emptyByte: number
): UEFINode[] | undefined {
  const records = readGPNVStore(offset, end, parser.reader);
  const last = records.at(-1);
  if (last === undefined) return undefined;
  const store = makeSpan({
    kind: "gpnvStore",
    name: "GPNV",
    range: { start: offset, end: last.offset + last.length },
  });
  store.children = records.map((record) =>
    makeNode({
      kind: "gpnvRecord",
      subtype: record.isCurrent ? 1 : 0,
      name: record.name,
      header: gpnvHeader(record),
      body: gpnvBody(record),
    })
  );
  return [store, ...parser.padding(last.offset + last.length, end, emptyByte)];
}

/**
 * `nodes` with a GPNV store in their written padding read out as a row, each stretch
 * keeping its place, range and name (§9): at the start of the stretch, or on a 4 KiB
 * boundary of the file inside it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GPNVStore.swift#Parser.readingGPNVStores
 */
export function readingGPNVStores(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (node.kind !== "padding") return node;
    if (node.children.length > 0) {
      return { ...node, children: readingGPNVStores(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    const body = node.body;
    let at = body.start;
    while (at + GPNV_HEADER_SIZE <= body.end) {
      const rows = gpnvStore(parser, at, body.end, emptyByte);
      if (rows !== undefined) {
        return { ...node, children: [...parser.padding(body.start, at, emptyByte), ...rows] };
      }
      at = (Math.floor(at / GPNV_ALIGNMENT) + 1) * GPNV_ALIGNMENT;
    }
    return node;
  });
}
