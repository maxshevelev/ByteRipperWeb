import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { ChecksumRepair } from "@/firmware/uefi/checksumRepair";
import { checksumText, crc32, sum8Of } from "@/firmware/uefi/checksums";
import { type DescriptorInfo, readDescriptorInfo } from "@/firmware/uefi/descriptorInfo";
import { FLASH_REGIONS, regionLabel } from "@/firmware/uefi/descriptorParser";
import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";
import { fileTypeName } from "@/firmware/uefi/fileParser";
import { itemType } from "@/firmware/uefi/itemClassification";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import {
  microcodeCpuid,
  microcodeFields,
  microcodePlatformsText,
  microcodeProcessorText,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub, subtypeName } from "@/firmware/uefi/uefiTypes";
import {
  cell,
  type DetailField,
  type DetailTable,
  field,
  type NodeDetail,
  permission,
} from "@/tools/toolDetail";
import { kindLabel } from "@/tools/uefi/uefiTreeDisplay";

/**
 * What the panel says about the selected node, by its type. Ported from
 * upstream's `UEFINodeDetail.swift` (`Design/UEFI_STRUCTURE_TOOL.md`).
 *
 * The fields come from the bytes, through the same reader the parser used: a
 * field the header does not hold is absent, not guessed, and the name tables are
 * the parser's own, not re-derived here.
 *
 * One divergence: upstream's "Decompressed from" row is not here, because this
 * port does not open compressed sections yet.
 *
 * @param repairs the writes that would put this node's checksums right, or none
 *   when they check out. A repair at a checksum's own offset says that field is
 *   wrong, and its bytes are the value the row quotes as what it should be.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.build
 */
export function buildNodeDetail(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[] = []
): NodeDetail {
  const fields = [...commonFields(node, image), ...headerFields(node, reader, repairs)];
  const title = node.name.length === 0 ? kindLabel(node.kind) : node.name;

  // An update for more than one processor lists the others in a table of its
  // own, which reads as the grid it is.
  if (node.kind === "microcode") {
    const extended = readMicrocodeHeader(node.header.start, reader)?.extendedTable;
    if (extended === undefined || extended.signatures.length === 0) {
      return { title, fields, tables: [] };
    }
    const cell = (text: string) => ({ text, tone: "plain" as const });
    return {
      title,
      fields,
      tables: [
        {
          title: "Extended signatures",
          symbol: "cpu",
          columns: ["CPUID", "Processor", "Platforms", "Checksum"],
          rows: extended.signatures.map((signature) => [
            cell(microcodeCpuid(signature.processorSignature)),
            cell(microcodeProcessorText(signature.processorSignature)),
            cell(microcodePlatformsText(signature.platformIDs)),
            cell(hex(signature.checksum)),
          ]),
        },
      ],
    };
  }

  // A descriptor says more about itself than a header's worth of fields, and
  // two of the things it says are grids.
  if (node.kind !== "flashDescriptor") return { title, fields, tables: [] };
  const descriptor = readDescriptorInfo(node.header.start, reader);
  if (descriptor === undefined) return { title, fields, tables: [] };
  return {
    title,
    fields: [...fields, ...descriptorFields(descriptor)],
    tables: descriptorTables(descriptor),
  };
}

// MARK: - The fields every node has

function commonFields(node: UEFINode, image: UEFIImage): DetailField[] {
  const fields: DetailField[] = [field("Kind", kindLabel(node.kind))];
  if (node.subtype !== undefined) fields.push(field("Type", typeText(node)));
  if (node.guid !== undefined) fields.push(field("GUID", guidDetailText(node.guid)));
  fields.push(field("Header", rangeText(node.header)));
  fields.push(field("Body", rangeText(node.body)));
  if (node.tail.end > node.tail.start) fields.push(field("Tail", rangeText(node.tail)));
  const range = nodeRange(node);
  fields.push(field("Total", rangeText(range)));

  const flags: string[] = [];
  if (node.isFixed) flags.push("fixed");
  if (node.isCompressed) flags.push("compressed");
  if (node.isErased) flags.push("erased");
  if (flags.length > 0) fields.push(field("Flags", flags.join(", ")));

  // A compressed node's address means nothing — the decompressor puts it
  // wherever it likes — so the one thing worth showing is skipped there.
  if (!node.isCompressed) {
    const address = image.addressForOffset(range.start);
    if (address !== undefined) fields.push(field("Address", hex(address)));
  }
  return fields;
}

// MARK: - What the node's header adds

function headerFields(
  node: UEFINode,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[]
): DetailField[] {
  const h = node.header.start;
  const fields: DetailField[] = [];
  const add = (label: string, value: number | undefined, text: (value: number) => string) => {
    if (value !== undefined) fields.push(field(label, text(value)));
  };

  switch (node.kind) {
    case "volume": {
      add("Length", reader.uint64(h + 0x20), sizeText);
      add("Signature", reader.uint32(h + 0x28), hex);
      add("Attributes", reader.uint32(h + 0x2c), (value) =>
        bits(value, [[0x0000_0800, "Erase polarity"]])
      );
      add("Header length", reader.uint16(h + 0x30), sizeText);
      const checksum = reader.uint16(h + 0x32);
      if (checksum !== undefined) {
        fields.push(checksumRow("Checksum", checksum, 4, repairs, h + 0x32));
      }
      add("Ext. header", reader.uint16(h + 0x34), hex);
      add("Revision", reader.uint8(h + 0x37), (value) => `${value}`);
      break;
    }

    case "file": {
      // The name GUID is the common "GUID" field and the type the common "Type"
      // field; what the header adds is the rest.
      add("Attributes", reader.uint8(h + 0x13), (value) =>
        bits(value, [
          [0x01, "Tail / large"],
          [0x04, "Fixed"],
          [0x40, "Checksum"],
        ])
      );
      // A large file keeps its size in a 64-bit field after the base header and
      // leaves the three-byte one at zero.
      const size = reader.uint24(h + 0x14);
      if (size !== undefined && size !== 0) fields.push(field("Size", sizeText(size)));
      else add("Size", reader.uint64(h + 0x18), sizeText);
      add("State", reader.uint8(h + 0x17), (value) => bits(value, [[0x80, "Erase polarity"]]));
      const headerChecksum = reader.uint8(h + 0x10);
      if (headerChecksum !== undefined) {
        fields.push(checksumRow("Header checksum", headerChecksum, 2, repairs, h + 0x10));
      }
      const bodyChecksum = reader.uint8(h + 0x11);
      if (bodyChecksum !== undefined) {
        fields.push(checksumRow("Body checksum", bodyChecksum, 2, repairs, h + 0x11));
      }
      break;
    }

    case "section": {
      // An extended-size section leaves the three-byte field at the marker and
      // keeps the real size in 32 bits.
      const size = reader.uint24(h);
      if (size === 0xff_ffff) add("Size", reader.uint32(h + 0x04), sizeText);
      else add("Size", size, sizeText);
      break;
    }

    case "microcode": {
      // The header type and the loader revision are constants of a valid Intel
      // microcode, read straight off the bytes. The rest is the reading the FIT
      // panel gives the microcode an entry points at (`microcodeFields`), so the
      // two say it in the same words — with the checksum's verdict this panel's
      // own: the repairs.
      add("Header type", reader.uint32(h), hex);
      const header = readMicrocodeHeader(h, reader);
      if (header !== undefined) {
        add("Loader revision", reader.uint32(h + 0x14), hex);
        const repair = repairs.find((one) => one.offset === h + 0x10);
        fields.push(
          ...microcodeFields(
            header,
            repair === undefined,
            repair === undefined ? undefined : littleEndian(repair.bytes)
          )
        );
      }
      break;
    }

    case "capsule":
      add("Header size", reader.uint32(h + 0x10), sizeText);
      add("Flags", reader.uint32(h + 0x14), hex);
      add("Image size", reader.uint32(h + 0x18), sizeText);
      break;

    case "intelImage": {
      // The image node is the whole file, and its bytes open with the descriptor
      // whose map says how many chips, regions, masters and straps the board
      // has. The first three are stored minus one; the two strap counts are not.
      const map0 = reader.uint32(h + 0x14);
      if (map0 !== undefined) {
        fields.push(field("Flash chips", `${((map0 >>> 8) & 0x3) + 1}`));
        fields.push(field("Regions", `${((map0 >>> 24) & 0x7) + 1}`));
      }
      const map1 = reader.uint32(h + 0x18);
      if (map1 !== undefined) {
        fields.push(field("Masters", `${((map1 >>> 8) & 0x3) + 1}`));
        fields.push(field("PCH straps", `${(map1 >>> 24) & 0xff}`));
      }
      add("PROC straps", reader.uint32(h + 0x1c), (map2) => `${(map2 >>> 8) & 0xff}`);
      break;
    }

    case "flashDescriptor":
      add("Signature", reader.uint32(h + 0x10), hex);
      add("FLMAP", reader.uint32(h + 0x14), hex);
      add("Version", reader.uint32(h + 0x20), hex);
      break;

    case "region": {
      // The descriptor's table keeps base and limit in 4 KiB units.
      const range = nodeRange(node);
      fields.push(field("Base (4 KiB)", hex(Math.floor(range.start / 0x1000))));
      if (range.end > 0) {
        fields.push(field("Limit (4 KiB)", hex(Math.floor((range.end - 1) / 0x1000))));
      }
      break;
    }

    case "vssStore":
      add("Format", reader.uint8(h + 8), hex);
      add("State", reader.uint8(h + 9), hex);
      add("Reserved", reader.uint16(h + 10), hex);
      add("Reserved1", reader.uint32(h + 12), hex);
      break;

    case "vss2Store":
      // The same four fields, after the 16-byte store GUID and size.
      add("Format", reader.uint8(h + 20), hex);
      add("State", reader.uint8(h + 21), hex);
      add("Reserved", reader.uint16(h + 22), hex);
      add("Reserved1", reader.uint32(h + 24), hex);
      break;

    case "ftwStore":
      add("State", reader.uint8(h + 20), hex);
      add("Header CRC32", reader.uint32(h + 16), hex);
      break;

    case "sysFStore": {
      add("Unknown", reader.uint8(h + 4), hex);
      add("Unknown1", reader.uint32(h + 5), hex);
      // The store's CRC32 is its final four bytes, over everything before them.
      const end = nodeRange(node).end;
      if (end >= h + 4) {
        const stored = reader.uint32(end - 4);
        const bytes = reader.bytesAt(h, end - 4 - h);
        if (stored !== undefined && bytes !== undefined) {
          const computed = crc32(bytes);
          fields.push(
            field(
              "CRC32",
              checksumText({
                value: stored,
                valid: computed === stored,
                expected: computed,
                digits: 8,
              })
            )
          );
        }
      }
      break;
    }

    case "flashMapStore":
      add("Entries", reader.uint16(h + 10), (value) => `${value}`);
      add("Reserved", reader.uint32(h + 12), hex);
      break;

    case "flashMapEntry":
      add("Data type", reader.uint16(h + 16), hex);
      add("Entry type", reader.uint16(h + 18), hex);
      add("Size", reader.uint32(h + 28), sizeText);
      add("Offset", reader.uint32(h + 32), hex);
      add("Physical address", reader.uint64(h + 20), hex);
      break;

    case "evsaStore": {
      add("Attributes", reader.uint32(h + 8), hex);
      add("Reserved", reader.uint32(h + 16), hex);
      const checksum = evsaChecksum(h + 1, node.header.end, reader);
      if (checksum !== undefined) fields.push(field("Checksum", checksumText(checksum)));
      break;
    }

    case "vssEntry":
      // The variable's vendor GUID is the common "GUID" field.
      add("State", reader.uint8(h + 2), hex);
      add("Reserved", reader.uint8(h + 3), hex);
      add("Attributes", reader.uint32(h + 4), (value) => bits(value, NVRAM_ATTRIBUTE_BITS));
      break;

    case "evsaEntry": {
      // What the header adds depends on the entry's kind.
      switch (node.subtype) {
        case Sub.guidEvsaEntry:
          add("GuidId", reader.uint16(h + 4), hex);
          break;
        case Sub.nameEvsaEntry:
          add("VarId", reader.uint16(h + 4), hex);
          break;
        default:
          add("VarId", reader.uint16(h + 6), hex);
          add("GuidId", reader.uint16(h + 4), hex);
          add("Attributes", reader.uint32(h + 8), (value) => bits(value, EVSA_ATTRIBUTE_BITS));
      }
      const checksum = evsaChecksum(h + 1, nodeRange(node).end, reader);
      if (checksum !== undefined) fields.push(field("Checksum", checksumText(checksum)));
      break;
    }

    case "slicData":
      switch (node.subtype) {
        case Sub.pubkeySlicData:
          add("Key type", reader.uint8(h + 8), hex);
          add("Version", reader.uint8(h + 9), hex);
          add("Algorithm", reader.uint32(h + 12), hex);
          add("Bit length", reader.uint32(h + 20), hex);
          add("Exponent", reader.uint32(h + 24), hex);
          break;
        case Sub.markerSlicData: {
          add("Version", reader.uint32(h + 8), hex);
          const oemId = reader.bytesAt(h + 12, 6);
          if (oemId !== undefined) fields.push(field("OEM ID", asciiText(oemId)));
          const tableId = reader.bytesAt(h + 18, 8);
          if (tableId !== undefined) fields.push(field("OEM table ID", asciiText(tableId)));
          // The parser only accepts the known flag, so its word is the value.
          const flag = reader.uint64Bits(h + 26);
          if (flag !== undefined) {
            fields.push(
              field(
                "Windows flag",
                flag === 0x2053_574f_444e_4957n ? "WINDOWS" : `0x${flag.toString(16).toUpperCase()}`
              )
            );
          }
          add("SLIC version", reader.uint32(h + 34), hex);
          break;
        }
      }
      break;

    // Read as leaves in the reference: nothing to add to the common fields.
    case "fdcStore":
    case "cmdbStore":
    case "sysFEntry":
    case "uefiImage":
    case "padding":
    case "freeSpace":
    case "nonUEFIData":
      break;
  }
  return fields;
}

// MARK: - What a flash descriptor adds

/** The vector it opens with, and where each region it declares begins. */
function descriptorFields(descriptor: DescriptorInfo): DetailField[] {
  const fields: DetailField[] = [];
  if (descriptor.reservedVector.length > 0) {
    fields.push(field("Reserved vector", hexBytes(descriptor.reservedVector)));
  }
  for (const region of descriptor.regionOffsets) {
    if (region.type === "descriptor") continue;
    fields.push(field(`${regionLabel(region.type)} offset`, hex(region.offset)));
  }
  return fields;
}

/** The masks each master carries, what the BIOS master may do, and the chips. */
function descriptorTables(descriptor: DescriptorInfo): DetailTable[] {
  const tables: DetailTable[] = [];
  const mask = (value: number) =>
    `0x${value.toString(16).toUpperCase().padStart(descriptor.maskDigits, "0")}`;
  if (descriptor.masters.length > 0) {
    tables.push({
      title: "Region access settings",
      symbol: "key",
      columns: ["Master", "Read", "Write"],
      rows: descriptor.masters.map((master) => [
        cell(master.name),
        cell(mask(master.read)),
        cell(mask(master.write)),
      ]),
    });
  }
  if (descriptor.biosAccess.length > 0) {
    tables.push({
      title: "BIOS access table",
      symbol: "lock.shield",
      columns: ["Region", "Read", "Write"],
      rows: descriptor.biosAccess.map((access) => [
        cell(access.region),
        permission(access.read),
        permission(access.write),
      ]),
    });
  }
  if (descriptor.chips.length > 0) {
    tables.push({
      title: "Flash chips in VSCC table",
      symbol: "cpu",
      columns: ["JEDEC ID", "Chip"],
      rows: descriptor.chips.map((chip) => [
        cell(chip.jedecId.toString(16).toUpperCase().padStart(6, "0")),
        cell(chip.name ?? "Unknown"),
      ]),
    });
  }
  return tables;
}

// MARK: - NVRAM helpers

/** The VSS variable attribute bits, in the reference parser's words. */
const NVRAM_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [0x0000_0001, "NonVolatile"],
  [0x0000_0002, "BootService"],
  [0x0000_0004, "Runtime"],
  [0x0000_0008, "HwErrorRecord"],
  [0x0000_0010, "AuthWrite"],
  [0x0000_0020, "TimeBasedAuthWrite"],
  [0x0000_0040, "AppendWrite"],
  [0x8000_0000, "AppleChecksum"],
];

/** The EVSA data-entry bits: the VSS words, with the extended-header bit. */
const EVSA_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [0x0000_0001, "NonVolatile"],
  [0x0000_0002, "BootService"],
  [0x0000_0004, "Runtime"],
  [0x0000_0008, "HwErrorRecord"],
  [0x0000_0010, "AuthWrite"],
  [0x0000_0020, "TimeBasedAuthWrite"],
  [0x0000_0040, "AppendWrite"],
  [0x1000_0000, "ExtendedHeader"],
];

/**
 * An EVSA record checks itself the sum-to-zero way, from its stored checksum
 * byte to its end. When the sum is not zero, the byte that would make it zero is
 * `stored - sum` — what the row quotes.
 */
function evsaChecksum(
  checksumOffset: number,
  end: number,
  reader: ImageReader
): { value: number; valid: boolean; expected: number } | undefined {
  const stored = reader.uint8(checksumOffset);
  if (stored === undefined || end <= checksumOffset) return undefined;
  const sum = sum8Of({ start: checksumOffset, end }, reader);
  if (sum === undefined) return undefined;
  return { value: stored, valid: sum === 0, expected: (stored - sum) & 0xff };
}

/** Fixed-size bytes holding an ASCII word, up to the first zero. */
function asciiText(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  return new TextDecoder().decode(zero < 0 ? bytes : bytes.subarray(0, zero));
}

// MARK: - Text

/**
 * A checksum row whose validity the parse-time repairs decide: a repair at the
 * field's own offset says it is wrong and quotes what it should be.
 */
function checksumRow(
  label: string,
  stored: number,
  digits: number,
  repairs: readonly ChecksumRepair[],
  checksumOffset: number
): DetailField {
  const repair = repairs.find((one) => one.offset === checksumOffset);
  return field(
    label,
    checksumText({
      value: stored,
      valid: repair === undefined,
      expected: repair === undefined ? undefined : littleEndian(repair.bytes),
      digits,
    }),
    repair !== undefined
  );
}

function littleEndian(bytes: Uint8Array): number {
  let value = 0;
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = value * 256 + (bytes[index] ?? 0);
  }
  return value;
}

/** The type byte, named by the kind that gives it a meaning. */
function typeText(node: UEFINode): string {
  const subtype = node.subtype;
  if (subtype === undefined) return "";
  switch (node.kind) {
    case "file":
      return fileTypeName(subtype);
    case "section":
      return sectionTypeName(subtype);
    case "volume":
      return `Revision ${subtype}`;
    case "region": {
      const type = FLASH_REGIONS[subtype];
      return type === undefined ? hex(subtype) : `${regionLabel(type)} · ${hex(subtype)}`;
    }
    case "intelImage":
    case "uefiImage":
    case "vssEntry":
    case "sysFEntry":
    case "evsaEntry":
    case "flashMapEntry":
    case "slicData":
      return subtypeName(itemType(node), subtype) ?? hex(subtype);
    default:
      return hex(subtype);
  }
}

function guidDetailText(guid: EFIGUID): string {
  const known = nameOfGuid(guid);
  return known === undefined ? guidText(guid) : `${guidText(guid)} (${known})`;
}

/**
 * A byte length, in hex and in decimal — `0x800 (2048)` — and `Empty` for none,
 * the word that stands for that everywhere rather than a dash.
 */
function sizeText(bytes: number): string {
  return bytes === 0 ? "Empty" : `${hex(bytes)} (${bytes})`;
}

/** Where the part starts and how long it is: `0x0 · 0x2000 (8192) bytes`. */
function rangeText(range: ImageRange): string {
  const count = range.end - range.start;
  return count <= 0 ? sizeText(0) : `${hex(range.start)} · ${sizeText(count)} bytes`;
}

/** The hex value, with the well-known bits named when they are set. */
function bits(value: number, names: readonly (readonly [number, string])[]): string {
  const set = names.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
  return set.length === 0 ? hex(value) : `${hex(value)} (${set.join(", ")})`;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function hexBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}
