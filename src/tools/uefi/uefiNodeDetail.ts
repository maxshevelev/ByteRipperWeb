import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { outermostSection } from "@/firmware/uefi/byteSpace";
import type { ChecksumRepair } from "@/firmware/uefi/checksumRepair";
import { checksumText, crc32, sum8, sum8Of } from "@/firmware/uefi/checksums";
import { type DescriptorInfo, readDescriptorInfo } from "@/firmware/uefi/descriptorInfo";
import { FLASH_REGIONS, regionLabel } from "@/firmware/uefi/descriptorParser";
import { allECImages, isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import { type EFIGUID, guidEquals, guidText } from "@/firmware/uefi/efiGuid";
import { fileTypeName } from "@/firmware/uefi/fileParser";
import {
  acmSubtypeName,
  fitComponentKindOf,
  readFITComponentHeader,
} from "@/firmware/uefi/fitComponents";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import { readInsydeBvdt } from "@/firmware/uefi/insydeBvdt";
import { allITEFirmware } from "@/firmware/uefi/iteFirmware";
import { itemType } from "@/firmware/uefi/itemClassification";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import {
  microcodeCpuid,
  microcodeFields,
  microcodePlatformsText,
  microcodeProcessorText,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { NVAR, nvarChecksumOf } from "@/firmware/uefi/nvarParser";
import {
  fillPercentUsed,
  fillUsed,
  type NvramStoreFill,
  nvramStoreFillOf,
} from "@/firmware/uefi/nvramStoreFill";
import {
  isIbbKind,
  type ProtectedRange,
  protectedRangeKindName,
  rangesTouchingNode,
} from "@/firmware/uefi/protectedRanges";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import { tcgHashName } from "@/firmware/uefi/tcgHash";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { isNodeCompressed, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub, subtypeName } from "@/firmware/uefi/uefiTypes";
import {
  cell,
  type DetailCell,
  type DetailField,
  type DetailTable,
  field,
  type NodeDetail,
  permission,
} from "@/tools/toolDetail";
import { uefiTopSwapDetail } from "@/tools/uefi/uefiTopSwap";
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
  if (node.kind === "ecImage") fields.push(...ecImageFields(node, image, reader));
  const topSwap = uefiTopSwapDetail(node, image);
  if (topSwap !== undefined) fields.push(field(L("Top Swap"), topSwap));
  const fill = nvramStoreFillOf(node, reader);
  if (fill !== undefined) fields.push(...fillFields(fill));
  const title = node.name.length === 0 ? kindLabel(node.kind) : node.name;

  // Every range that shares a byte with the node, once something has read them.
  const protectedBy =
    image.protectedRanges === undefined
      ? []
      : rangesTouchingNode(image.protectedRanges, node, image);
  const protection: { fields: DetailField[]; tables: DetailTable[] } =
    protectedBy.length === 0
      ? { fields: [], tables: [] }
      : {
          fields: [field(L("Protection"), protectionCaveat())],
          tables: [protectedByTable(protectedBy)],
        };
  fields.push(...protection.fields);

  // An update for more than one processor lists the others in a table of its
  // own, which reads as the grid it is.
  if (node.kind === "microcode") {
    const extended = readMicrocodeHeader(node.header.start, reader)?.extendedTable;
    if (extended === undefined || extended.signatures.length === 0) {
      return { title, fields, tables: protection.tables };
    }
    const cell = (text: string) => ({ text, tone: "plain" as const });
    return {
      title,
      fields,
      tables: [
        ...protection.tables,
        {
          title: L("Extended signatures"),
          symbol: "cpu",
          columns: [L("CPUID"), L("Processor"), L("Platforms"), L("Checksum")],
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
  if (node.kind !== "flashDescriptor") return { title, fields, tables: protection.tables };
  const descriptor = readDescriptorInfo(node.header.start, reader);
  if (descriptor === undefined) return { title, fields, tables: protection.tables };
  return {
    title,
    fields: [...fields, ...descriptorFields(descriptor)],
    tables: [...protection.tables, ...descriptorTables(descriptor)],
  };
}

// MARK: - Protected ranges

/**
 * What the image cannot say: the Boot Guard profile is in the PCH's fuses, not
 * in the BIOS region.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.protectionCaveat
 */
export const protectionCaveat = (): string =>
  L(
    "Whether Boot Guard is enforced is set in the chipset's fuses, not in this image: the marks say what an edit would break if it is. Vendor hashes are checked by the firmware itself."
  );

/**
 * Every range that shares a byte with the node: what it is, where it is, where
 * the list naming it is, and what hashing it found.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.protectedByTable
 */
function protectedByTable(ranges: readonly ProtectedRange[]): DetailTable {
  return {
    title: L("Protected by"),
    symbol: "lock.shield",
    columns: [L("Range"), L("Kind"), L("Listed at"), L("Hash")],
    rows: ranges.map((range) => [
      {
        text:
          range.range === undefined
            ? L("Not placed")
            : `${hex(range.range.start)}–${hex(range.range.end)}`,
        tone: "plain" as const,
      },
      { text: protectedRangeKindName(range.kind), tone: "plain" as const },
      { text: hex(range.source.start), tone: "plain" as const },
      verdictCell(range),
    ]),
  };
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.verdictCell */
function verdictCell(range: ProtectedRange): DetailCell {
  const algorithms = range.digests.map((one) => tcgHashName(one.algorithm)).join(", ");
  switch (range.verdict.kind) {
    case "matches":
      return { text: L("%1$@ matches", algorithms), tone: "yes" };
    case "mismatch":
      // An IBB mismatch is not a verdict yet.
      return {
        text: isIbbKind(range.kind)
          ? L("%1$@ differs (unconfirmed)", algorithms)
          : L("%1$@ differs", algorithms),
        tone: "no",
      };
    case "unsupported":
      return { text: L("%1$@ not computed", tcgHashName(range.verdict.algorithm)), tone: "plain" };
    case "unchecked":
      return { text: L("Not checked"), tone: "plain" };
  }
}

// MARK: - The fields every node has

function commonFields(node: UEFINode, image: UEFIImage): DetailField[] {
  const fields: DetailField[] = [field(L("Kind"), kindLabel(node.kind))];
  if (node.subtype !== undefined) fields.push(field(L("Type"), typeText(node)));
  if (node.guid !== undefined) fields.push(field("GUID", guidDetailText(node.guid)));
  // Inside a compressed section the ranges below are offsets into what it
  // decompresses to, and this says which section that is.
  const outermost = outermostSection(node.space);
  if (outermost !== undefined) {
    const found = image.innermostNodeContaining(outermost);
    const section =
      found !== undefined && found.header.start === outermost
        ? found.name
        : L("Compressed section");
    let text = L("%1$@ at %2$@", section, hex(outermost));
    if (node.space.length > 1) {
      text = L("%1$@, %2$@ compressed sections deep", text, node.space.length);
    }
    fields.push(field(L("Decompressed from"), text));
  }
  fields.push(field(L("Header"), rangeText(node.header)));
  fields.push(field(L("Body"), rangeText(node.body)));
  if (node.tail.end > node.tail.start) fields.push(field(L("Tail"), rangeText(node.tail)));
  const range = nodeRange(node);
  fields.push(field(L("Total"), rangeText(range)));

  const flags: string[] = [];
  if (node.isFixed) flags.push("fixed");
  if (isNodeCompressed(node)) flags.push("compressed");
  if (node.isErased) flags.push("erased");
  if (flags.length > 0) fields.push(field(L("Flags"), flags.join(", ")));

  // A compressed node's address means nothing — the decompressor puts it
  // wherever it likes — so the one thing worth showing is skipped there.
  if (!isNodeCompressed(node)) {
    const address = image.addressForOffset(range.start);
    if (address !== undefined) fields.push(field(L("Address"), hex(address)));
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
        fields.push(checksumRow(L("Checksum"), checksum, 4, repairs, h + 0x32));
      }
      add("Ext. header", reader.uint16(h + 0x34), hex);
      add(L("Revision"), reader.uint8(h + 0x37), (value) => `${value}`);
      break;
    }

    case "file": {
      // The name GUID is the common "GUID" field and the type the common "Type"
      // field; what the header adds is the rest.
      add("Attributes", reader.uint8(h + 0x13), (value) =>
        bits(value, [
          [0x01, "Tail / large"],
          [0x04, "Fixed"],
          [0x40, L("Checksum")],
        ])
      );
      // A large file keeps its size in a 64-bit field after the base header and
      // leaves the three-byte one at zero.
      const size = reader.uint24(h + 0x14);
      if (size !== undefined && size !== 0) fields.push(field(L("Size"), sizeText(size)));
      else add(L("Size"), reader.uint64(h + 0x18), sizeText);
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
      if (size === 0xff_ffff) add(L("Size"), reader.uint32(h + 0x04), sizeText);
      else add(L("Size"), size, sizeText);
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
          // The engine's own field carries a flag; the detail carries a tone.
          ...microcodeFields(
            header,
            repair === undefined,
            repair === undefined ? undefined : littleEndian(repair.bytes)
          ).map((one) => field(one.label, one.value, one.isProblem))
        );
      }
      break;
    }

    case "capsule":
      add("Header size", reader.uint32(h + 0x10), sizeText);
      add(L("Flags"), reader.uint32(h + 0x14), hex);
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
      add(L("Version"), reader.uint32(h + 0x20), hex);
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
      add(L("Unknown"), reader.uint8(h + 4), hex);
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

    case "flashDeviceMapStore": {
      // `INSYDE_FLASH_DEVICE_MAP_HEADER`.
      add(L("Size"), reader.uint32(h + 4), sizeText);
      add("Data offset", reader.uint32(h + 8), hex);
      add("Entry size", reader.uint32(h + 12), sizeText);
      add("Entry format", reader.uint8(h + 16), hex);
      add(L("Revision"), reader.uint8(h + 17), hex);
      add(L("Extensions"), reader.uint8(h + 18), (value) => `${value}`);
      const stored = reader.uint8(h + 19);
      const header = reader.bytes({ start: h, end: h + 0x1c });
      if (stored !== undefined && header !== undefined) {
        const expected = (0x100 - ((sum8(header) - stored) & 0xff)) & 0xff;
        fields.push(
          field(
            L("Checksum"),
            expected === stored
              ? `${hex(stored)}, valid`
              : `${hex(stored)}, should be ${hex(expected)}`
          )
        );
      }
      add("Flash device base address", reader.uint64(h + 20), hex);
      break;
    }

    case "flashDeviceMapEntry": {
      // The region type GUID is the common "GUID" field.
      const regionId = reader.bytes({ start: h + 16, end: h + 32 });
      if (regionId !== undefined) fields.push(field("Region ID", hexBytes(regionId)));
      add("Region offset", reader.uint64(h + 32), hex);
      add("Region size", reader.uint64(h + 40), hex);
      const attributes = reader.uint32(h + 48);
      if (attributes !== undefined) {
        const words: string[] = [];
        if ((attributes & 0x1) !== 0) words.push("modifiable");
        if ((attributes & 0x2) !== 0) words.push("ignored");
        fields.push(
          field(
            "Attributes",
            words.length === 0 ? hex(attributes) : `${hex(attributes)} (${words.join(", ")})`
          )
        );
      }
      const hash = reader.bytes({ start: h + 52, end: h + 84 });
      if (hash !== undefined) fields.push(field(L("Hash"), hexBytes(hash)));
      break;
    }

    case "flashMapStore":
      add("Entries", reader.uint16(h + 10), (value) => `${value}`);
      add("Reserved", reader.uint32(h + 12), hex);
      break;

    case "flashMapEntry":
      add("Data type", reader.uint16(h + 16), hex);
      add("Entry type", reader.uint16(h + 18), hex);
      add(L("Size"), reader.uint32(h + 28), sizeText);
      add("Offset", reader.uint32(h + 32), hex);
      add("Physical address", reader.uint64(h + 20), hex);
      break;

    case "evsaStore": {
      add("Attributes", reader.uint32(h + 8), hex);
      add("Reserved", reader.uint32(h + 16), hex);
      const checksum = evsaChecksum(h + 1, node.header.end, reader);
      if (checksum !== undefined) fields.push(field(L("Checksum"), checksumText(checksum)));
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
      if (checksum !== undefined) fields.push(field(L("Checksum"), checksumText(checksum)));
      break;
    }

    case "nvarEntry":
      fields.push(...nvarFields(node, reader));
      break;

    case "nvarGuidStore":
      fields.push(
        field("GUIDs", `${Math.floor((node.body.end - node.body.start) / NVAR.guidSize)}`)
      );
      break;

    case "slicData":
      switch (node.subtype) {
        case Sub.pubkeySlicData:
          add("Key type", reader.uint8(h + 8), hex);
          add(L("Version"), reader.uint8(h + 9), hex);
          add("Algorithm", reader.uint32(h + 12), hex);
          add("Bit length", reader.uint32(h + 20), hex);
          add("Exponent", reader.uint32(h + 24), hex);
          break;
        case Sub.markerSlicData: {
          add(L("Version"), reader.uint32(h + 8), hex);
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
    case "freeSpace":
    case "nonUEFIData":
    case "startupApData":
      break;

    // Padding the parser named for the ITE image it opens on lists every image.
    case "padding":
      // With a row per image, the rows say it.
      if (isECFirmwarePadding(node) && !node.children.some((child) => child.kind === "ecImage")) {
        fields.push(...iteFields(node, reader));
      }
      break;

    // A map region has no header: the map says where it is and what type it is,
    // and the type is the common "GUID" field. What the region holds is read
    // where its type is understood.
    case "flashDeviceMapRegion": {
      if (node.guid !== undefined && guidEquals(node.guid, FlashDeviceMap.biosVersionDataTable)) {
        const table = readInsydeBvdt(node.body, reader);
        if (table?.biosVersion !== undefined) {
          fields.push(field("BIOS version", table.biosVersion));
        }
        if (table?.productName !== undefined) {
          fields.push(field("Product name", table.productName));
        }
        if (table?.kernelVersion !== undefined) {
          fields.push(field("Kernel version", table.kernelVersion));
        }
        if (table?.releaseDate !== undefined) {
          fields.push(field("Release date", table.releaseDate));
        }
      }
      if (
        node.guid !== undefined &&
        guidEquals(node.guid, FlashDeviceMap.ecFirmware) &&
        !node.children.some((child) => child.kind === "ecImage")
      ) {
        fields.push(...iteFields(node, reader));
      }
      break;
    }

    // Read in `buildNodeDetail`, which has the block the image sits in.
    case "ecImage":
      break;

    // What UEFITool's FIT tab says of the structure, in the header's own words:
    // the fields are Intel's names, and stay in them.
    case "fitComponent": {
      const kind = node.subtype === undefined ? undefined : fitComponentKindOf(node.subtype);
      const header =
        kind === undefined ? undefined : readFITComponentHeader(kind, node.body.start, reader);
      if (header === undefined) break;
      switch (header.kind) {
        case "table":
          fields.push(field("Entries", `${header.rows}`));
          break;
        case "acm":
          fields.push(
            field("Module subtype", acmSubtypeName(header.subtype) ?? hex(header.subtype))
          );
          fields.push(field("Header version", hex(header.headerVersion)));
          fields.push(field("Chipset ID", hex(header.chipsetID)));
          fields.push(field(L("Date"), header.date));
          fields.push(field("ACM SVN", `${header.svn}`));
          break;
        case "keyManifest":
          fields.push(field("Version", hex(header.version)));
          fields.push(field("KM version", hex(header.kmVersion)));
          fields.push(field("KM SVN", `${header.svn}`));
          fields.push(field("KM ID", hex(header.id)));
          break;
        case "bootPolicy":
          fields.push(field("Version", hex(header.version)));
          fields.push(field("BPM revision", `${header.revision}`));
          fields.push(field("BP SVN", `${header.svn}`));
          fields.push(field("ACM SVN", `${header.acmSVN}`));
          break;
      }
      break;
    }
  }
  return fields;
}

/**
 * What an EC image row adds: who made it, what it says it is, how long it is, and
 * which earlier image in the block it copies. Read again from the block the image
 * sits in, since a copy is told by the images before it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.ecImageFields
 */
function ecImageFields(node: UEFINode, image: UEFIImage, reader: ImageReader): DetailField[] {
  const block = node.id.length === 0 ? undefined : image.node(node.id.slice(0, -1));
  if (block === undefined) return [];
  const start = nodeRange(node).start;
  const found = allECImages(block.body, reader).find((one) => one.start === start);
  if (found === undefined) return [];
  const fields: DetailField[] = [];
  if (found.vendor.kind === "ite") {
    fields.push(field(L("Vendor"), "ITE"));
    fields.push(field("ITE identification", found.vendor.identification));
  } else {
    fields.push(field(L("Vendor"), "Microchip"));
    fields.push(field("Signature", "PHCM"));
  }
  fields.push(field(L("Written"), sizeText(found.written)));
  if (found.copyOf !== undefined) fields.push(field(L("Copy of"), hex(found.copyOf)));
  return fields;
}

/**
 * One row per ITE image in the node: what it says it is, and where it starts.
 * The firmware's own words, so they read as written.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.iteFields
 */
function iteFields(node: UEFINode, reader: ImageReader): DetailField[] {
  return allITEFirmware(nodeRange(node), reader).map((image) =>
    field("ITE identification", `${image.identification} · ${hex(image.start)}`)
  );
}

// MARK: - How full a variable store is

/**
 * The panel's own reading of a store, so it translates: how much of it is
 * written, how much is left, and what its entries still count for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.fillFields
 */
function fillFields(fill: NvramStoreFill): DetailField[] {
  return [
    field(L("In use"), `${sizeText(fillUsed(fill))} · ${fillPercentUsed(fill)}\u00a0%`),
    field(L("Free space"), sizeText(fill.free)),
    field(L("Current entries"), `${fill.current}`),
    field(L("Superseded entries"), `${fill.superseded}`),
    field(L("Deleted entries"), `${fill.deleted}`),
  ];
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
      title: L("Region access settings"),
      symbol: "key",
      columns: [L("Master"), L("Read"), L("Write")],
      rows: descriptor.masters.map((master) => [
        cell(master.name),
        cell(mask(master.read)),
        cell(mask(master.write)),
      ]),
    });
  }
  if (descriptor.biosAccess.length > 0) {
    tables.push({
      title: L("BIOS access table"),
      symbol: "lock.shield",
      columns: [L("Region"), L("Read"), L("Write")],
      rows: descriptor.biosAccess.map((access) => [
        cell(access.region),
        permission(access.read),
        permission(access.write),
      ]),
    });
  }
  if (descriptor.chips.length > 0) {
    tables.push({
      title: L("Flash chips in VSCC table"),
      symbol: "cpu",
      columns: [L("JEDEC ID"), L("Chip")],
      rows: descriptor.chips.map((chip) => [
        cell(chip.jedecId.toString(16).toUpperCase().padStart(6, "0")),
        cell(chip.name ?? L("Unknown")),
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

/**
 * What an NVAR entry's header and extended header say (§9). The GUID is the
 * common "GUID" field — the parser found it, in the entry or in the store's
 * table, or took it from the chain for a later link.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.nvarFields
 */
function nvarFields(node: UEFINode, reader: ImageReader): DetailField[] {
  const h = node.header.start;
  const fields: DetailField[] = [];
  const attributes = reader.uint8(h + 9);
  if (attributes === undefined) return fields;
  fields.push(field("Attributes", bits(attributes, NVAR_ATTRIBUTE_BITS)));
  // `next` is relative to the entry; the row says where it lands.
  const next = reader.uint24(h + 6);
  if (next !== undefined && next !== NVAR.noNext) fields.push(field("Next entry", hex(h + next)));
  // An entry that names its GUID by index carries the index right after the
  // header — on a valid entry that is not a later link.
  if (
    (attributes & NVAR.valid) !== 0 &&
    (attributes & NVAR.dataOnly) === 0 &&
    (attributes & NVAR.localGuid) === 0
  ) {
    const index = reader.uint8(h + NVAR.headerSize);
    if (index !== undefined) fields.push(field("GUID index", `${index}`));
  }

  // The extended header is the entry's tail: its attributes first, then a
  // timestamp and a hash when the variable is time-authenticated, and the
  // checksum and the header's own size last.
  const tail = node.tail;
  const tailSize = tail.end - tail.start;
  const extended = tailSize >= NVAR.extendedHeaderMinimum ? reader.uint8(tail.start) : undefined;
  if (extended === undefined) return fields;
  fields.push(field("Extended attributes", bits(extended, NVAR_EXTENDED_ATTRIBUTE_BITS)));
  if ((extended & NVAR.extendedTimeBased) !== 0 && tailSize >= 1 + NVAR.timestampSize + 2) {
    const timestamp = reader.uint64(tail.start + 1);
    if (timestamp !== undefined) {
      fields.push(field("Timestamp", hex(timestamp)));
      const hashEnd = 1 + NVAR.timestampSize + NVAR.hashSize + 2;
      if ((attributes & NVAR.dataOnly) === 0 && tailSize >= hashEnd) {
        const hash = reader.bytesAt(tail.start + 1 + NVAR.timestampSize, NVAR.hashSize);
        if (hash !== undefined) {
          fields.push(
            field(
              "Hash",
              [...hash].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("")
            )
          );
        }
      }
    }
  }
  const checksum = nvarChecksumOf(node, reader);
  if (checksum !== undefined) {
    fields.push(
      field(
        L("Checksum"),
        checksumText({
          value: checksum.stored,
          valid: checksum.valid,
          expected: checksum.expected,
        })
      )
    );
  }
  return fields;
}

/** The NVAR attribute bits, in the reference parser's words. */
const NVAR_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [NVAR.runtime, "Runtime"],
  [NVAR.asciiName, "AsciiName"],
  [NVAR.localGuid, "Guid"],
  [NVAR.dataOnly, "DataOnly"],
  [NVAR.extendedHeader, "ExtHeader"],
  [NVAR.hwErrorRecord, "HwErrorRecord"],
  [NVAR.authWrite, "AuthWrite"],
  [NVAR.valid, "Valid"],
];

/** The NVAR extended attribute bits; the others are unknown. */
const NVAR_EXTENDED_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [NVAR.extendedChecksum, "Checksum"],
  [NVAR.extendedAuthWrite, "AuthWrite"],
  [NVAR.extendedTimeBased, "TimeBasedAuthWrite"],
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
    case "nvarEntry":
    case "startupApData":
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
  return bytes === 0 ? L("Empty") : `${hex(bytes)} (${bytes})`;
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
