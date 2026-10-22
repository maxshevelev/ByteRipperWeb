import { LocalizedText } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum8 } from "@/firmware/uefi/checksums";
import { type DMIField, dmiFieldNode } from "@/firmware/uefi/dmiField";
import type { Parser } from "@/firmware/uefi/parserState";
import { madeUpName, makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Panasonic's DMI region, where the firmware of a Toughbook keeps what the factory wrote of the
 * machine (`UEFI_IMAGE_FORMAT.md` §9): the asset tag, a serial, the Windows product key, and
 * records nobody has documented. In the padding inside the BIOS region, on a 4 KiB boundary —
 * declared nowhere, so found by its content: a header, a directory, and records the directory
 * lists.
 *
 * ```
 * 0x00  "MEI_" and the model, "MEI_FZ55-2"   (MEI: Matsushita Electric Industrial)
 * 0x28  a model code, "FZ55FZ-52M4"
 * 0x3A  "MEI___CF"
 * 0x80  u16 the directory's length in 8-byte units, this one included;
 *       u16 its checksum; u32 0
 * 0x88  {u32 ID, u32 address} per record
 * ```
 *
 * An address is where the record is in the CPU's view of the flash — the file offset plus
 * 0xFE000000 on a 32 MiB chip, plus 0xFF800000 on an 8 MiB one — so the block's own address is
 * the first record's rounded down to 4 KiB: the first record lies within the block's first 4 KiB,
 * after the directory. A record is its length, header included, an 8-bit checksum, then its
 * data: a u16 length and the checksum in some records, a u32 length, the checksum and three
 * bytes nobody has explained in the others. Records follow one another at the addresses the
 * directory gives, back to back or with a gap. Which form a record has is told by where the next
 * one starts and by its checksum, not by its ID.
 *
 * Everything is checksummed the same way — the bytes sum to 0 modulo 256: the header's first
 * 0x80 bytes, the directory from 0x80 to its last slot, and each record over its length.
 *
 * What the records hold is known for three: 0x02 the asset tag, 0x03 a serial — whether the
 * board's or the machine's is not known — and 0x16 the Windows product key. The layout is read
 * off dumps, not a published one, and the help says so.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.init
 */
export interface PanasonicDMIArea {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.offset */
  readonly offset: number;
  /**
   * The header and the directory, as stored.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.header
   */
  readonly header: Uint8Array;
  /**
   * The records, in file order.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.records
   */
  readonly records: readonly PanasonicDMIRecord[];
  /**
   * Whether the header's first 0x80 bytes sum to 0. Which of them is the checksum is not known.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.headerChecksumIsValid
   */
  readonly headerChecksumIsValid: boolean;
  /**
   * The byte at +0x82 that would make the directory sum to 0.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.expectedDirectoryChecksum
   */
  readonly expectedDirectoryChecksum: number;
}

/**
 * One record the directory lists.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record
 */
export interface PanasonicDMIRecord {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.id */
  readonly id: number;
  /**
   * Where the directory says it is: in the CPU's view of the flash.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.address
   */
  readonly address: number;
  /**
   * Where it is in the file: from its length to the end of what the length counts.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.range
   */
  readonly range: ImageRange;
  /**
   * 3 where the length is a u16, 8 where it is a u32.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.headerSize
   */
  readonly headerSize: number;
  /**
   * The checksum byte: the record's bytes sum to 0 with it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.checksum
   */
  readonly checksum: number;
  /**
   * The byte that would make them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.expectedChecksum
   */
  readonly expectedChecksum: number;
  /**
   * The record's first bytes, as far as `recordHeadSize`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.head
   */
  readonly head: Uint8Array;
}

/**
 * The block sits on a 4 KiB boundary of the file.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.alignment
 */
export const PANASONIC_DMI_ALIGNMENT = 0x1000;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.signature */
export const PANASONIC_DMI_SIGNATURE: readonly number[] = Array.from("MEI_", (character) =>
  character.charCodeAt(0)
);

/**
 * How much of the block is the header the checksum at its end covers.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.headerSize
 */
const HEADER_SIZE = 0x80;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.directoryOffset */
const DIRECTORY_OFFSET = 0x80;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.slotsOffset */
export const PANASONIC_DMI_SLOTS_OFFSET = 0x88;
/**
 * How much of a record is kept to read its fields from.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.recordHeadSize
 */
const RECORD_HEAD_SIZE = 0x40;

/**
 * The ID of the record that holds the asset tag.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.assetTagID
 */
export const PANASONIC_ASSET_TAG_ID = 0x02;
/**
 * The ID of the record that holds the serial.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.serialID
 */
export const PANASONIC_SERIAL_ID = 0x03;
/**
 * The ID of the record that holds the Windows product key.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.productKeyID
 */
export const PANASONIC_PRODUCT_KEY_ID = 0x16;

/**
 * What a record of `id` holds, where that is known; nothing for the rest.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.meaning
 */
export function panasonicRecordMeaning(id: number): LocalizedText | undefined {
  switch (id) {
    case PANASONIC_ASSET_TAG_ID:
      return LocalizedText.of("Asset tag");
    case PANASONIC_SERIAL_ID:
      return LocalizedText.of("Serial");
    case PANASONIC_PRODUCT_KEY_ID:
      return LocalizedText.of("Windows product key");
    default:
      return undefined;
  }
}

/**
 * The length and the checksum a record's header holds: a u16 and a u8 in a 3-byte header, a u32
 * and a u8 in an 8-byte one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.recordHeader
 */
export function panasonicRecordHeader(
  bytes: Uint8Array
): { readonly length: number; readonly checksum: number } | undefined {
  switch (bytes.length) {
    case 3:
      return { length: u16(bytes, 0), checksum: bytes[2] as number };
    case 8:
      return { length: u32(bytes, 0), checksum: bytes[4] as number };
    default:
      return undefined;
  }
}

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] as number) | ((bytes[at + 1] as number) << 8);

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.u32 */
const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] as number) |
    ((bytes[at + 1] as number) << 8) |
    ((bytes[at + 2] as number) << 16) |
    ((bytes[at + 3] as number) << 24)) >>>
  0;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.checksumIsValid */
export const panasonicRecordChecksumIsValid = (record: PanasonicDMIRecord): boolean =>
  record.checksum === record.expectedChecksum;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.header */
export const panasonicRecordHeaderRange = (record: PanasonicDMIRecord): ImageRange => ({
  start: record.range.start,
  end: record.range.start + record.headerSize,
});

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.body */
export const panasonicRecordBody = (record: PanasonicDMIRecord): ImageRange => ({
  start: record.range.start + record.headerSize,
  end: record.range.end,
});

/**
 * Where the record's data starts in `head`: after its header, as far as `head` holds it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.Record.data
 */
const dataStart = (record: PanasonicDMIRecord): number =>
  Math.min(record.headerSize, record.head.length);

/**
 * The directory's checksum, at +0x82.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.directoryChecksum
 */
export const panasonicDirectoryChecksum = (area: PanasonicDMIArea): number =>
  area.header[0x82] as number;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.directoryChecksumIsValid */
export const panasonicDirectoryChecksumIsValid = (area: PanasonicDMIArea): boolean =>
  panasonicDirectoryChecksum(area) === area.expectedDirectoryChecksum;

/**
 * From the header to the end of the last record.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.range
 */
export function panasonicDMIRange(area: PanasonicDMIArea): ImageRange {
  const last = area.records[area.records.length - 1];
  return { start: area.offset, end: last?.range.end ?? area.offset + area.header.length };
}

// MARK: - The fields

const isPrintable = (byte: number): boolean => byte >= 0x20 && byte <= 0x7e;

/**
 * The run of printable text at the front of `bytes`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.text
 */
function textOf(bytes: Uint8Array): string {
  let end = 0;
  while (end < bytes.length && isPrintable(bytes[end] as number)) end += 1;
  return String.fromCharCode(...bytes.subarray(0, end));
}

/**
 * The model, as the header names it after "MEI_".
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.model
 */
export const panasonicModel = (area: PanasonicDMIArea): string =>
  textOf(area.header.subarray(4, 0x10));

/**
 * The model code at +0x28.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.modelCode
 */
export const panasonicModelCode = (area: PanasonicDMIArea): string =>
  textOf(area.header.subarray(0x28, 0x38));

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.record */
export const panasonicRecord = (
  area: PanasonicDMIArea,
  id: number
): PanasonicDMIRecord | undefined => area.records.find((record) => record.id === id);

/**
 * Where a record's text starts in its head: at its data, or one byte on where the data opens
 * with a byte that is not text — the serial's record does, with 01.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.textStart
 */
function textStart(record: PanasonicDMIRecord): number {
  const start = dataStart(record);
  const first = record.head[start];
  const second = record.head[start + 1];
  if (first === undefined || isPrintable(first) || second === undefined || !isPrintable(second)) {
    return start;
  }
  return start + 1;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.text */
function textIn(
  area: PanasonicDMIArea,
  id: number
): { readonly start: number; readonly text: string } | undefined {
  const record = panasonicRecord(area, id);
  if (record === undefined) return undefined;
  const from = textStart(record);
  const text = textOf(record.head.subarray(from));
  return text.length === 0 ? undefined : { start: record.range.start + from, text };
}

/**
 * The asset tag, where written.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.assetTag
 */
export const panasonicAssetTag = (area: PanasonicDMIArea): string | undefined =>
  textIn(area, PANASONIC_ASSET_TAG_ID)?.text;

/**
 * The serial, where written: the record's text up to its line end.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.serial
 */
export const panasonicSerial = (area: PanasonicDMIArea): string | undefined =>
  textIn(area, PANASONIC_SERIAL_ID)?.text;

/** The product key's length: five groups of five characters and four dashes. */
const PRODUCT_KEY_LENGTH = 29;

/**
 * `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, in capitals and digits.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.isProductKey
 */
function isProductKey(bytes: Uint8Array): boolean {
  return bytes.every((byte, index) =>
    index % 6 === 5
      ? byte === 0x2d
      : (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a)
  );
}

/**
 * Where the product key lies in its record — after four u32s and its length — when it reads as
 * one: five groups of five characters.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.productKeyRange
 */
function productKeyRange(area: PanasonicDMIArea): ImageRange | undefined {
  const record = panasonicRecord(area, PANASONIC_PRODUCT_KEY_ID);
  if (record === undefined || record.headerSize !== 8) return undefined;
  const lengthAt = 0x18;
  const keyAt = lengthAt + 4;
  if (
    record.head.length < keyAt + PRODUCT_KEY_LENGTH ||
    u32(record.head, lengthAt) !== PRODUCT_KEY_LENGTH ||
    !isProductKey(record.head.subarray(keyAt, keyAt + PRODUCT_KEY_LENGTH))
  ) {
    return undefined;
  }
  const start = record.range.start + keyAt;
  return { start, end: start + PRODUCT_KEY_LENGTH };
}

/**
 * The Windows product key, where it reads as one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.productKey
 */
export function panasonicProductKey(area: PanasonicDMIArea): string | undefined {
  const range = productKeyRange(area);
  const record = panasonicRecord(area, PANASONIC_PRODUCT_KEY_ID);
  if (range === undefined || record === undefined) return undefined;
  const from = range.start - record.range.start;
  return String.fromCharCode(...record.head.subarray(from, from + PRODUCT_KEY_LENGTH));
}

/** A field of the block, and the record it is read from — nothing for the header's. */
export interface PanasonicDMIFieldOf {
  readonly record: number | undefined;
  readonly field: DMIField;
}

/**
 * The fields the block keeps, in file order, each where it lies in the file: the rows under the
 * block's and its records'.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.fields
 */
export function panasonicFields(area: PanasonicDMIArea): PanasonicDMIFieldOf[] {
  const text = (name: LocalizedText, start: number, value: string): DMIField => ({
    name,
    range: { start, end: start + value.length },
    encoding: "ascii",
  });
  const fields: PanasonicDMIFieldOf[] = [
    {
      record: undefined,
      field: text(LocalizedText.of("Model"), area.offset + 4, panasonicModel(area)),
    },
    {
      record: undefined,
      field: text(LocalizedText.of("Model code"), area.offset + 0x28, panasonicModelCode(area)),
    },
  ];
  const tag = textIn(area, PANASONIC_ASSET_TAG_ID);
  if (tag !== undefined) {
    fields.push({
      record: PANASONIC_ASSET_TAG_ID,
      field: text(LocalizedText.of("Asset tag"), tag.start, tag.text),
    });
  }
  const serial = textIn(area, PANASONIC_SERIAL_ID);
  if (serial !== undefined) {
    fields.push({
      record: PANASONIC_SERIAL_ID,
      field: text(LocalizedText.of("Serial"), serial.start, serial.text),
    });
  }
  const key = productKeyRange(area);
  if (key !== undefined) {
    fields.push({
      record: PANASONIC_PRODUCT_KEY_ID,
      field: { name: LocalizedText.of("Windows product key"), range: key, encoding: "ascii" },
    });
  }
  return fields;
}

// MARK: - Finding it

/**
 * The block at `offset`, when its header starts with the signature and its directory lists
 * records that chain: each lies where the directory says, at rising addresses, its length ends
 * it no later than the next one starts, and the last one ends before `end`. The checksums are not
 * what finds it: a block whose sums fail is read all the same, and the details say which fail.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#PanasonicDMIArea.read
 */
export function readPanasonicDMIArea(
  offset: number,
  end: number,
  reader: ImageReader
): PanasonicDMIArea | undefined {
  if (offset % PANASONIC_DMI_ALIGNMENT !== 0 || offset + PANASONIC_DMI_SLOTS_OFFSET > end) {
    return undefined;
  }
  const header = reader.bytesAt(offset, PANASONIC_DMI_SLOTS_OFFSET);
  if (
    header === undefined ||
    !PANASONIC_DMI_SIGNATURE.every((byte, index) => header[index] === byte)
  ) {
    return undefined;
  }
  // The directory's length counts its own first eight bytes.
  const units = u16(header, 0x80);
  const directoryEnd = DIRECTORY_OFFSET + 8 * units;
  if (units < 3 || directoryEnd > PANASONIC_DMI_ALIGNMENT || offset + directoryEnd > end) {
    return undefined;
  }
  const directory = reader.bytesAt(
    offset + PANASONIC_DMI_SLOTS_OFFSET,
    directoryEnd - PANASONIC_DMI_SLOTS_OFFSET
  );
  if (directory === undefined) return undefined;
  const entries = Array.from({ length: units - 1 }, (_, index) => ({
    id: u32(directory, index * 8),
    address: u32(directory, index * 8 + 4),
  })).filter((entry) => entry.id !== 0);
  const first = entries[0];
  if (first === undefined || entries.length < 2) return undefined;
  const base = first.address - (first.address % PANASONIC_DMI_ALIGNMENT);
  const starts = entries.map((entry) => offset + entry.address - base);
  const last = starts[starts.length - 1] as number;
  if (
    (starts[0] as number) < offset + directoryEnd ||
    !starts.every((start, index) => index === 0 || (starts[index - 1] as number) < start) ||
    last >= end
  ) {
    return undefined;
  }
  const records: PanasonicDMIRecord[] = [];
  for (const [index, entry] of entries.entries()) {
    const start = starts[index] as number;
    const limit = starts[index + 1] ?? end;
    const lengths = reader.bytesAt(start, Math.min(8, limit - start));
    if (lengths === undefined || lengths.length < 3) return undefined;
    // Each form the header may have, where its length fits; the one whose checksum holds, or
    // else the long one.
    const forms: { header: number; length: number; bytes: Uint8Array }[] = [];
    if (lengths.length === 8) {
      const long = u32(lengths, 0);
      const bytes = long >= 8 && start + long <= limit ? reader.bytesAt(start, long) : undefined;
      if (bytes !== undefined) forms.push({ header: 8, length: long, bytes });
    }
    const short = u16(lengths, 0);
    const bytes = short >= 3 && start + short <= limit ? reader.bytesAt(start, short) : undefined;
    if (bytes !== undefined) forms.push({ header: 3, length: short, bytes });
    const form = forms.find((one) => sum8(one.bytes) === 0) ?? forms[0];
    if (form === undefined) return undefined;
    const checksum = form.bytes[form.header === 8 ? 4 : 2] as number;
    records.push({
      id: entry.id,
      address: entry.address,
      range: { start, end: start + form.length },
      headerSize: form.header,
      checksum,
      expectedChecksum: (checksum - sum8(form.bytes)) & 0xff,
      head: form.bytes.slice(0, RECORD_HEAD_SIZE),
    });
  }
  const all = new Uint8Array(header.length + directory.length);
  all.set(header);
  all.set(directory, header.length);
  return {
    offset,
    header: all,
    records,
    headerChecksumIsValid: sum8(header.subarray(0, HEADER_SIZE)) === 0,
    expectedDirectoryChecksum:
      ((all[0x82] as number) - sum8(all.subarray(DIRECTORY_OFFSET))) & 0xff,
  };
}

/**
 * `nodes` with every Panasonic DMI block read out of the padding it lies in, as a row with a row
 * per record — on a 4 KiB boundary of the file, where the dump read from lays it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#Parser.readingPanasonicDMIStores
 */
export function readingPanasonicDMIStores(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (node.kind !== "padding") return node;
    if (node.children.length > 0) {
      return { ...node, children: readingPanasonicDMIStores(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    const body = node.body;
    const step = PANASONIC_DMI_ALIGNMENT;
    const found: PanasonicDMIArea[] = [];
    let at = Math.ceil(body.start / step) * step;
    while (at + PANASONIC_DMI_SLOTS_OFFSET <= body.end) {
      const signature = parser.reader.bytesAt(at, 4);
      const area =
        signature !== undefined &&
        PANASONIC_DMI_SIGNATURE.every((byte, index) => signature[index] === byte)
          ? readPanasonicDMIArea(at, body.end, parser.reader)
          : undefined;
      if (area === undefined) {
        at += step;
      } else {
        found.push(area);
        at = Math.ceil(panasonicDMIRange(area).end / step) * step;
      }
    }
    if (found.length === 0) return node;
    const rows: UEFINode[] = [];
    let claimed = body.start;
    for (const area of found) {
      rows.push(...parser.padding(claimed, area.offset, emptyByte));
      rows.push(panasonicDMIRow(area));
      claimed = panasonicDMIRange(area).end;
    }
    return { ...node, children: [...rows, ...parser.padding(claimed, body.end, emptyByte)] };
  });
}

/**
 * The block's row: its header's fields, then a row per record, the fields a record holds under
 * it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/PanasonicDMIStore.swift#Parser.panasonicDMIRow
 */
export function panasonicDMIRow(area: PanasonicDMIArea): UEFINode {
  const fields = panasonicFields(area);
  const row = makeSpan({
    kind: "panasonicDMIStore",
    ...madeUpName("Panasonic DMI"),
    range: panasonicDMIRange(area),
  });
  row.isFixed = true;
  row.children = [
    ...fields.filter((one) => one.record === undefined).map((one) => dmiFieldNode(one.field, true)),
    ...area.records.map((record) => {
      const node = makeNode({
        kind: "panasonicDMIRecord",
        subtype: record.id <= 0xff ? record.id : undefined,
        ...madeUpName("Record %1$@", panasonicRecordIdText(record.id)),
        header: panasonicRecordHeaderRange(record),
        body: panasonicRecordBody(record),
        isFixed: true,
      });
      node.children = fields
        .filter((one) => one.record === record.id)
        .map((one) => dmiFieldNode(one.field, true));
      return node;
    }),
  ];
  return row;
}

/** A record's ID as the rows and the details write it: `0x16`. */
export const panasonicRecordIdText = (id: number): string =>
  `0x${id.toString(16).toUpperCase().padStart(2, "0")}`;
