import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Acer's DMI region, where the firmware keeps the machine's identity
 * (`UEFI_IMAGE_FORMAT.md` §9): the system serial number, the motherboard serial, the UUID,
 * the model. What the bench calls the DMI area. An 8 KiB block on a 4 KiB boundary, in the
 * padding inside the BIOS region: it is no region of the descriptor, no map region, and it
 * lies at no fixed offset — the board's BIOS layout sets where, and the block is found by
 * its content.
 *
 * ```
 * 0x00  the system serial, 22 alphanumerics starting with "N"
 * 0x30  a flag the factory writes per build
 * 0x3C  06 FF FF FF
 * 0x40  "Acer"
 * 0x50  the motherboard serial, 22 alphanumerics starting with "NB"
 * 0x70  the UUID, 16 bytes
 * 0x80  the model
 * 0xA0  the asset tag, where written
 * 0xC0  the product name
 * 0xF3  02
 * 0x128 or 0x130  a copy of the UUID's last six bytes
 * ```
 *
 * Everything else in the block is padding — FF or 00. The block has no checksum: none was
 * found over the dumps it was read from, and the copy of the UUID's tail is not a checksum —
 * it goes stale when the UUID is changed after. The layout is read off those dumps, not a
 * published one, and the help says so.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea
 */
export interface AcerDMIArea {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.offset */
  readonly offset: number;
  /**
   * The block's 8 KiB, as stored.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.stored
   */
  readonly stored: Uint8Array;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.size */
export const ACER_DMI_SIZE = 0x2000;

/**
 * The block sits at the start of the bytes it is found in, or on a 4 KiB boundary inside
 * them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.alignment
 */
export const ACER_DMI_ALIGNMENT = 0x1000;

/**
 * The block's signature, at +0x3C: the constant 06, three FF, "Acer".
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.signature
 */
export const ACER_DMI_SIGNATURE: readonly number[] = [
  0x06,
  0xff,
  0xff,
  0xff,
  ...Array.from("Acer", (character) => character.charCodeAt(0)),
];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.signatureOffset */
export const ACER_DMI_SIGNATURE_OFFSET = 0x3c;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.range */
export const acerDMIRange = (area: AcerDMIArea) => ({
  start: area.offset,
  end: area.offset + ACER_DMI_SIZE,
});

const asText = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

// MARK: - The fields

/**
 * The system serial: 22 alphanumerics, what the sticker says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.systemSerial
 */
export const acerSystemSerial = (area: AcerDMIArea): string =>
  asText(area.stored.subarray(0, 0x16));

/**
 * The motherboard serial: 22 alphanumerics, the board's own number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.motherboardSerial
 */
export const acerMotherboardSerial = (area: AcerDMIArea): string =>
  asText(area.stored.subarray(0x50, 0x66));

/**
 * The UUID, as stored: the first two words little-endian, the rest as they read — the way
 * SMBIOS writes one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.uuid
 */
export const acerUUID = (area: AcerDMIArea): Uint8Array => area.stored.slice(0x70, 0x80);

/**
 * The UUID, spelled the way the bench spells it: the first three groups read back the way
 * SMBIOS stores them, the rest as-is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.uuidText
 */
export function acerUUIDText(area: AcerDMIArea): string {
  const group = (from: number, count: number, reversed: boolean): string => {
    const bytes = Array.from(area.stored.subarray(0x70 + from, 0x70 + from + count));
    const ordered = reversed ? bytes.reverse() : bytes;
    return ordered.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
  };
  return [
    group(0, 4, true),
    group(4, 2, true),
    group(6, 2, false),
    group(8, 2, false),
    group(10, 6, false),
  ].join("-");
}

/** The run of printable text from `offset`, to its first FF or NUL. */
function textFrom(area: AcerDMIArea, offset: number): string {
  let end = offset;
  while (end < area.stored.length) {
    const byte = area.stored[end] as number;
    if (byte === 0xff || byte === 0x00 || byte < 0x20 || byte > 0x7e) break;
    end += 1;
  }
  return asText(area.stored.subarray(offset, end));
}

/**
 * The model, as far as it is written.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.model
 */
export const acerModel = (area: AcerDMIArea): string => textFrom(area, 0x80);

/**
 * The asset tag, where written; nothing over its padding.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.assetTag
 */
export function acerAssetTag(area: AcerDMIArea): string | undefined {
  const text = textFrom(area, 0xa0);
  return text.length === 0 ? undefined : text;
}

/**
 * The product name, as far as it is written.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.productName
 */
export const acerProductName = (area: AcerDMIArea): string => textFrom(area, 0xc0);

/**
 * The manufacturing code the factory wrote at the block's end — a run of decimal digits, at
 * +0x690 or +0x6A0 — where it is there. A cleaning tool has zeroed some of it in some dumps.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.manufacturingCode
 */
export function acerManufacturingCode(area: AcerDMIArea): string | undefined {
  for (const offset of [0x690, 0x6a0]) {
    let end = offset;
    while (end < area.stored.length) {
      const byte = area.stored[end] as number;
      if (byte < 0x30 || byte > 0x39) break;
      end += 1;
    }
    if (end - offset >= 4) return asText(area.stored.subarray(offset, end));
  }
  return undefined;
}

// MARK: - What reads wrong

/**
 * Something about the block a technician should know before trusting it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIFinding
 */
export type AcerDMIFinding =
  /** The factory serials read "00" at offset 7 and "3400" at the end. */
  | "serialPattern"
  /** The factory motherboard serials read "1100" at offset 5 and "3400" at the end. */
  | "motherboardSerialPattern"
  /** The factory UUIDs are version 1. */
  | "uuidVersion"
  /** The factory UUIDs are variant 1: the top bit of their ninth byte is set. */
  | "uuidVariant"
  /** The constant 02 at +0xF3 reads as something else. */
  | "constantWrong"
  /** The copy of the UUID's last six bytes is erased. */
  | "tailCopyErased"
  /**
   * The copy of the UUID's last six bytes is there, but it does not read as the UUID's last
   * six. It is a copy, not a checksum: it went stale when the UUID was changed after.
   */
  | "tailCopyStale";

/**
 * A problem, as opposed to something worth knowing.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIFinding.isProblem
 */
export const acerFindingIsProblem = (finding: AcerDMIFinding): boolean =>
  finding !== "tailCopyErased";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIFinding.text */
export function acerFindingText(finding: AcerDMIFinding): string {
  switch (finding) {
    case "serialPattern":
      return L(
        "The serial does not hold the factory pattern: the factory ones read 00 at offset 7 and 3400 at the end."
      );
    case "motherboardSerialPattern":
      return L(
        "The motherboard serial does not hold the factory pattern: the factory ones read 1100 at offset 5 and 3400 at the end."
      );
    case "uuidVersion":
      return L("The UUID is not a version 1 one, as the factory ones are.");
    case "uuidVariant":
      return L(
        "The UUID's variant bit is not set, as it is on the factory ones. A cleaned or tampered UUID is the usual reason."
      );
    case "constantWrong":
      return L("The constant at +0xF3 is not 02.");
    case "tailCopyErased":
      return L(
        "The copy of the UUID's last six bytes is erased. It is a copy, not a checksum, so nothing checks wrong because of it."
      );
    case "tailCopyStale":
      return L(
        "The copy of the UUID's last six bytes does not read as the UUID's last six. It is a copy, not a checksum: it went stale when the UUID was changed after."
      );
  }
}

/**
 * Whether `text` holds `pattern` at `start`, counting from the front; false when `text` does
 * not run that far.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.holds
 */
const holds = (text: string, pattern: string, start: number): boolean =>
  text.length >= start + pattern.length && text.slice(start, start + pattern.length) === pattern;

/**
 * What reads wrong in the block. The factory blocks pass all of it; a cleaned or tampered
 * one does not.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.findings
 */
export function acerFindings(area: AcerDMIArea): AcerDMIFinding[] {
  const found: AcerDMIFinding[] = [];
  const system = acerSystemSerial(area);
  if (!holds(system, "00", 7) || !holds(system, "3400", 18)) found.push("serialPattern");
  const board = acerMotherboardSerial(area);
  if (!holds(board, "1100", 5) || !holds(board, "3400", 18)) {
    found.push("motherboardSerialPattern");
  }
  const uuid = acerUUID(area);
  if ((uuid[6] as number) >> 4 !== 1) found.push("uuidVersion");
  if (((uuid[8] as number) & 0x80) === 0) found.push("uuidVariant");
  if (area.stored[0xf3] !== 0x02) found.push("constantWrong");
  const tail = uuid.subarray(10, 16);
  const copy = area.stored.subarray(0x130, 0x136);
  const legacyCopy = area.stored.subarray(0x128, 0x12e);
  const same = (left: Uint8Array) => left.every((byte, index) => byte === tail[index]);
  if (!same(copy) && !same(legacyCopy)) {
    const isBlank = (bytes: Uint8Array) => bytes.every((byte) => byte === 0xff || byte === 0x00);
    found.push(isBlank(copy) && isBlank(legacyCopy) ? "tailCopyErased" : "tailCopyStale");
  }
  return found;
}

// MARK: - The checks a wiped or tampered block fails

const isAlnum = (bytes: Uint8Array): boolean =>
  bytes.every(
    (byte) =>
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a)
  );

/** The system serial: 22 alphanumerics, the first of them "N". */
const isSerial = (bytes: Uint8Array): boolean => isAlnum(bytes) && bytes[0] === 0x4e;

/** The motherboard serial: 22 alphanumerics, the first two of them "NB". */
const isMotherboardSerial = (bytes: Uint8Array): boolean =>
  isAlnum(bytes) && bytes[0] === 0x4e && bytes[1] === 0x42;

/**
 * Where the block keeps its fields, the union over the dumps read from: outside these
 * stretches, every byte is padding — FF or 00.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.dataWindows
 */
const DATA_WINDOWS: readonly (readonly [offset: number, length: number])[] = [
  [0x00, 0x20],
  [0x30, 0x20],
  [0x50, 0x20],
  [0x70, 0x30],
  [0xa0, 0x20],
  [0xc0, 0x20],
  [0xeb, 1],
  [0xec, 1],
  [0xee, 1],
  [0xf3, 1],
  [0xf4, 1],
  [0xf6, 1],
  [0xf8, 1],
  [0xfb, 1],
  [0x128, 0xe],
  [0x140, 0xe],
  [0x690, 0x46],
];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.isSparse */
function isSparse(stored: Uint8Array): boolean {
  const covered = new Uint8Array(ACER_DMI_SIZE);
  for (const [offset, length] of DATA_WINDOWS) covered.fill(1, offset, offset + length);
  return stored.every((byte, index) => covered[index] === 1 || byte === 0xff || byte === 0x00);
}

/**
 * The block `stored` holds, when the checks a wiped or tampered block fails all pass: the
 * signature at +0x3C, a 4 KiB-aligned start, a system serial that reads as one, a
 * motherboard serial that reads as one, and padding everywhere the fields are not.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#AcerDMIArea.found
 */
export function foundAcerDMIArea(stored: Uint8Array, offset: number): AcerDMIArea | undefined {
  if (
    stored.length !== ACER_DMI_SIZE ||
    offset % ACER_DMI_ALIGNMENT !== 0 ||
    !ACER_DMI_SIGNATURE.every(
      (byte, index) => stored[ACER_DMI_SIGNATURE_OFFSET + index] === byte
    ) ||
    !isSerial(stored.subarray(0, 0x16)) ||
    !isMotherboardSerial(stored.subarray(0x50, 0x66)) ||
    !isSparse(stored)
  ) {
    return undefined;
  }
  return { offset, stored };
}

/**
 * The Acer DMI area `reader` holds at `offset`, when one is there.
 *
 * @web-only upstream reads `reader.bytes(node.range)` then `found` at each call site
 */
export function acerDMIAreaAt(reader: ImageReader, offset: number): AcerDMIArea | undefined {
  const stored = reader.bytesAt(offset, ACER_DMI_SIZE);
  return stored === undefined ? undefined : foundAcerDMIArea(stored, offset);
}

/**
 * `nodes` with every Acer DMI block read out as a row: out of the padding it lies in, or
 * out of the flash-device-map region that labels it "Unused" where the Insyde map carves it
 * out of the padding — on a 4 KiB boundary of the file, where the dumps read from lay them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AcerDMIStore.swift#Parser.readingAcerDMIStores
 */
export function readingAcerDMIStores(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (node.kind !== "padding" && node.kind !== "flashDeviceMapRegion") return node;
    if (node.children.length > 0) {
      return { ...node, children: readingAcerDMIStores(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    const body = node.body;
    const found: number[] = [];
    let at = Math.ceil(body.start / ACER_DMI_ALIGNMENT) * ACER_DMI_ALIGNMENT;
    while (at + ACER_DMI_SIZE <= body.end) {
      if (acerDMIAreaAt(parser.reader, at) !== undefined) found.push(at);
      at += ACER_DMI_ALIGNMENT;
    }
    if (found.length === 0) return node;
    const rows: UEFINode[] = [];
    let claimed = body.start;
    for (const start of found) {
      rows.push(...parser.padding(claimed, start, emptyByte));
      const row = makeSpan({
        kind: "acerDMIStore",
        name: L("Acer DMI"),
        range: { start, end: start + ACER_DMI_SIZE },
      });
      row.isFixed = true;
      rows.push(row);
      claimed = start + ACER_DMI_SIZE;
    }
    return { ...node, children: [...rows, ...parser.padding(claimed, body.end, emptyByte)] };
  });
}
