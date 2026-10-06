import type { ImageReader } from "@/firmware/imageReader";
import { isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * An AMD microcode patch's header (`UEFI_IMAGE_FORMAT.md` §7.2), as the reference
 * reads it (`amd_microcode.h`, `amdMicrocodeHeaderValid`).
 *
 * It has no signature: a patch is a header whose every field is one AMD writes — a BCD
 * date, a loader id of `0x80xx`, AMD's PCI vendor id or none — and whose size follows
 * from the processor family, which the header does not state either. On an AMD board
 * the PSP's BIOS directory names each patch (entry type `0x66`), and the sizes in it
 * agree with this table on every dump at hand. Reading the directory is a piece of
 * work of its own.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader
 */
export interface AMDMicrocodeHeader {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.year */
  readonly year: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.month */
  readonly month: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.day */
  readonly day: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.updateRevision */
  readonly updateRevision: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.loaderID */
  readonly loaderID: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.dataChecksum */
  readonly dataChecksum: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.northBridgeVendor */
  readonly northBridgeVendor: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.northBridgeDevice */
  readonly northBridgeDevice: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.southBridgeVendor */
  readonly southBridgeVendor: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.southBridgeDevice */
  readonly southBridgeDevice: number;
  /**
   * The two bytes AMD keeps of the CPUID: the extended family and model above, the
   * stepping below (`cpuID` spells them out).
   */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.processorSignature */
  readonly processorSignature: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.northBridgeRevision */
  readonly northBridgeRevision: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.southBridgeRevision */
  readonly southBridgeRevision: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.biosAPIRevision */
  readonly biosAPIRevision: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.loadControl */
  readonly loadControl: number;
  /** The patch's length, header included. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.length */
  readonly length: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.size */
export const AMD_MICROCODE_HEADER_SIZE = 0x20;

/**
 * What the reference wants after the header before it calls a patch one: `0x44` more
 * bytes, the dword at `0x40` not zero.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.minimumSize
 */
export const AMD_MICROCODE_MINIMUM_SIZE = 0x20 + 0x44;

/**
 * The CPUID the patch is for, the way AMD's file names write it: `00A50F00` for
 * `0xA500`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.cpuID
 */
export const amdCpuID = (signature: number): number =>
  (((signature >> 8) << 16) | 0x0f00 | (signature & 0xff)) >>> 0;

const hex = (value: number, digits: number) =>
  value.toString(16).toUpperCase().padStart(digits, "0");

/**
 * The date as written, `YYYY-MM-DD`: the fields are BCD, so their hex is their decimal.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.date
 */
export const amdMicrocodeDate = (header: AMDMicrocodeHeader): string =>
  `${hex(header.year, 4)}-${hex(header.month, 2)}-${hex(header.day, 2)}`;

/** A BCD byte within `[low, high]`: each nibble a decimal digit. */
function isBCD(value: number, low: number, high: number): boolean {
  return (value & 0x0f) <= 9 && value >> 4 <= 9 && value >= low && value <= high;
}

/**
 * How long a patch is (`amdMicrocodeGetSize`): the header says it for the old families,
 * and for the new ones only the family does — the reference's table, by the CPUID's
 * extended family and model byte.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.patchLength
 */
export function amdPatchLength(dataLength: number, family: number): number {
  switch (dataLength) {
    case 0x20:
      return 0x3c0;
    case 0x10:
      return 0x200;
    case 0:
      break;
    default:
      return dataLength;
  }
  if (family === 0x50) return 0x620;
  if (family === 0x58) return 0x567;
  if (family >= 0x60 && family <= 0x67) return 0xa20;
  if (family === 0x68 || family === 0x69) return 0x980;
  if (family === 0x70 || family === 0x73) return 0xd60;
  if ((family >= 0x80 && family <= 0x83) || (family >= 0x85 && family <= 0x8a)) return 0xc80;
  if ((family >= 0xa0 && family <= 0xa7) || family === 0xaa) return 0x15c0;
  if (family === 0xb4) return 0x3820;
  return 0;
}

/**
 * The patch at `offset`, when its header is one and the whole of it fits before
 * `limit`; nothing otherwise, saying nothing — a header with no signature turns up in
 * any data, and turning one down is no defect.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#AMDMicrocodeHeader.read
 */
export function readAMDMicrocode(
  offset: number,
  limit: number,
  reader: ImageReader
): AMDMicrocodeHeader | undefined {
  if (offset + AMD_MICROCODE_MINIMUM_SIZE > limit) return undefined;
  const bytes = reader.bytes({ start: offset, end: offset + AMD_MICROCODE_HEADER_SIZE });
  const after = reader.uint32(offset + 0x40);
  if (bytes === undefined || after === undefined || after === 0) return undefined;
  const byte = (at: number) => bytes[at] ?? 0;
  const u16 = (at: number) => byte(at) | (byte(at + 1) << 8);
  const u32 = (at: number) => (u16(at) | (u16(at + 2) << 16)) >>> 0;

  const signature = u16(0x18);
  const revision = u32(0x04);
  const cpu = amdCpuID(signature);
  let year = u16(0x00);
  let day = byte(0x02);
  let month = byte(0x03);
  // Three patches AMD shipped with a date that is not one, put right the way the
  // reference puts them right.
  if (cpu === 0x00800f11 && revision === 0x08001105 && year === 0x2016) year = 0x2017;
  if (cpu === 0x00300f10 && revision === 0x03000027 && month === 0x13) month = 0x12;
  if (cpu === 0x00730f01 && revision === 0x07030106) {
    if (month === 0x09) month = 0x02;
    if (day === 0x02) day = 0x09;
  }
  if (
    !isBCD(day, 0x01, 0x31) ||
    !isBCD(month, 0x01, 0x12) ||
    year >> 8 !== 0x20 ||
    !isBCD(year & 0xff, 0x01, 0x29)
  ) {
    return undefined;
  }

  const loader = u16(0x08);
  const data = loader >= 0x8005 ? ((byte(0x0b) << 8) | byte(0x0a)) * 0x10 : byte(0x0a);
  if (
    (cpu === 0x0f00 && data !== 0x10 && data !== 0x20) ||
    loader >> 8 !== 0x80 ||
    ![0x0000, 0x1022].includes(u16(0x10)) ||
    ![0x0000, 0x1022].includes(u16(0x14)) ||
    byte(0x1c) > 0x01 ||
    !(byte(0x1d) <= 0x0f || byte(0x1d) === 0xaa)
  ) {
    return undefined;
  }

  const length = amdPatchLength(data, signature >> 8);
  if (length === 0 || offset + length > limit) return undefined;
  return {
    offset,
    year,
    month,
    day,
    updateRevision: revision,
    loaderID: loader,
    dataChecksum: u32(0x0c),
    northBridgeVendor: u16(0x10),
    northBridgeDevice: u16(0x12),
    southBridgeVendor: u16(0x14),
    southBridgeDevice: u16(0x16),
    processorSignature: signature,
    northBridgeRevision: byte(0x1a),
    southBridgeRevision: byte(0x1b),
    biosAPIRevision: byte(0x1c),
    loadControl: byte(0x1d),
    length,
  };
}

/**
 * `nodes` with the AMD microcode in their padding read out as rows: in padding the scan
 * left, and in the map regions and padding rows already read into it — on the Lenovo
 * AMD board the patch sits in an Insyde map region, which the reference, knowing no
 * regions, would not look in. Each stretch keeps its place, range and name, as it does
 * for every structure read out of padding (§9).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#Parser.readingAMDMicrocode
 */
export function readingAMDMicrocode(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (
      (node.kind !== "padding" && node.kind !== "flashDeviceMapRegion") ||
      isECFirmwarePadding(node)
    ) {
      return node;
    }
    if (node.children.length > 0) {
      return { ...node, children: readingAMDMicrocode(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    const patches = amdMicrocodeIn(parser.reader, node.body);
    if (patches.length === 0) return node;
    const rows: UEFINode[] = [];
    let claimed = node.body.start;
    for (const patch of patches) {
      rows.push(...parser.padding(claimed, patch.offset, emptyByte));
      rows.push(amdMicrocodeNode(patch));
      claimed = patch.offset + patch.length;
    }
    rows.push(...parser.padding(claimed, node.body.end, emptyByte));
    return { ...node, children: rows };
  });
}

/**
 * Every patch in `range`, one after another: byte by byte, as the reference looks, with
 * the loader id's high byte — `0x80` on every patch — as the cheap first test.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#Parser.amdMicrocode
 */
function amdMicrocodeIn(
  reader: ImageReader,
  range: { readonly start: number; readonly end: number }
): AMDMicrocodeHeader[] {
  if (range.end - range.start < AMD_MICROCODE_MINIMUM_SIZE) return [];
  const bytes = reader.bytes(range);
  if (bytes === undefined) return [];
  const found: AMDMicrocodeHeader[] = [];
  const last = bytes.length - AMD_MICROCODE_MINIMUM_SIZE;
  let index = 0;
  while (index <= last) {
    if (bytes[index + 9] === 0x80) {
      const patch = readAMDMicrocode(range.start + index, range.end, reader);
      if (patch !== undefined) {
        found.push(patch);
        index += patch.length;
        continue;
      }
    }
    index += 1;
  }
  return found;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AMDMicrocode.swift#Parser.amdMicrocodeNode */
function amdMicrocodeNode(patch: AMDMicrocodeHeader): UEFINode {
  return makeNode({
    kind: "amdMicrocode",
    name: `AMD microcode ${hex(amdCpuID(patch.processorSignature), 1)}, revision ${hex(patch.updateRevision, 1)}`,
    header: { start: patch.offset, end: patch.offset + AMD_MICROCODE_HEADER_SIZE },
    body: { start: patch.offset + AMD_MICROCODE_HEADER_SIZE, end: patch.offset + patch.length },
    // The PSP's directory points at it, as the FIT points at Intel's.
    isFixed: true,
  });
}
