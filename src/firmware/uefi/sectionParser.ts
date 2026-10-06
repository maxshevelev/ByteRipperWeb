import { L, localized } from "@/core/localization/localization";
import type { ImageRange } from "@/firmware/imageReader";
import { alignUp } from "@/firmware/uefi/checksums";
import {
  AMD_ZLIB_COMPRESSED_SIZE_OFFSET,
  AMD_ZLIB_GUID,
  AMD_ZLIB_HEADER_SIZE,
  algorithmOfCompressionType,
  algorithmOfGuid,
  isCompressedGuid,
  PROCESSING_REQUIRED,
} from "@/firmware/uefi/compressedSection";
import { type EFIGUID, guidEquals } from "@/firmware/uefi/efiGuid";
import { guidedSection } from "@/firmware/uefi/knownGuids";
import { parseNvarStore } from "@/firmware/uefi/nvarParser";
import {
  ffsPhoenixRawSectionEvsaGuid,
  nvramNvarExternalDefaultsFileGuid,
} from "@/firmware/uefi/nvramGuids";
import { walkStores } from "@/firmware/uefi/nvramParser";
import type { Parser } from "@/firmware/uefi/parserState";
import { pictureBody } from "@/firmware/uefi/picture";
import { makeNode, type SectionCompression, type UEFINode } from "@/firmware/uefi/uefiNode";
import { parseVolume } from "@/firmware/uefi/volumeParser";

/**
 * `EFI_COMMON_SECTION_HEADER` and the section types.
 *
 * Encapsulating sections are where the tree stops being a list: a compression
 * section holds sections, a volume image section holds a volume, and the volume
 * holds files again.
 *
 * What this parser will not do is decompress — five algorithms, none of them in
 * the platform, and the rule of this project is no dependency without a reason
 * worth writing down. A compressed section is a leaf that says which algorithm
 * it is, and the day one is implemented it grows children instead.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section */
export const Section = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.headerSize */
  headerSize: 4,
  /**
   * FFSv3 only: a size of `0xFFFFFF` means the real one follows in 32 bits.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.extendedHeaderSize
   */
  extendedHeaderSize: 8,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.extendedSizeMarker */
  extendedSizeMarker: 0xff_ffff,
  /**
   * Sections sit on four-byte boundaries, where files sit on eight.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.alignment
   */
  alignment: 4,

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.compression */
  compression: 0x01,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.guidDefined */
  guidDefined: 0x02,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.disposable */
  disposable: 0x03,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.userInterface */
  userInterface: 0x15,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.firmwareVolumeImage */
  firmwareVolumeImage: 0x17,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.raw */
  raw: 0x19,

  /**
   * `EFI_COMPRESSION_SECTION`, which follows the common header.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.compressionHeaderSize
   */
  compressionHeaderSize: 5,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.notCompressed */
  notCompressed: 0x00,

  /**
   * `EFI_GUID_DEFINED_SECTION`: a GUID, a `DataOffset` and attributes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.guidDefinedHeaderSize
   */
  guidDefinedHeaderSize: 20,
} as const;

const SECTION_TYPE_NAMES: () => Readonly<Record<number, string>> = localized(() => ({
  1: L("Compressed section"),
  2: "GUID-defined section",
  3: "Disposable section",
  16: "PE32 image",
  17: "PIC image",
  18: "TE image",
  19: "DXE dependency",
  20: L("Version"),
  21: "Name",
  22: "Compatibility16",
  23: "Volume image",
  24: "Freeform subtype GUID",
  25: "Raw",
  27: "PEI dependency",
  28: "MM dependency",
  32: "Insyde postcode",
  240: "Phoenix postcode",
}));

/**
 * A vendor type nobody documented keeps its number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypeNames.swift#UEFITypeNames.section
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.typeName
 */
export function sectionTypeName(type: number): string {
  return (
    SECTION_TYPE_NAMES()[type] ??
    `Section type 0x${type.toString(16).toUpperCase().padStart(2, "0")}`
  );
}

/**
 * What each type puts after the common header, as far as a probe needs to know
 * (`parse*SectionHeader` in the reference): a section shorter than this is not
 * the section its type says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.typeHeaderSize
 */
export function sectionTypeHeaderSize(type: number): number {
  switch (type) {
    case Section.compression:
      return Section.compressionHeaderSize;
    case Section.guidDefined:
      return Section.guidDefinedHeaderSize;
    case 0x18: // freeform subtype GUID
      return 16;
    case 0x14: // version: the build number
      return 2;
    case 0x20: // Insyde postcode
    case 0xf0: // Phoenix postcode
      return 4;
    default:
      return 0;
  }
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.isKnown */
export function isKnownSectionType(type: number): boolean {
  // 0x1A is not a section type. The gap is the specification's, and a range
  // that papered over it would wave through the one value in here that means
  // something is wrong.
  return (
    (type >= 0x01 && type <= 0x03) ||
    (type >= 0x10 && type <= 0x19) ||
    type === 0x1b ||
    type === 0x1c ||
    type === 0x20 ||
    type === 0xf0
  );
}

/**
 * A file's body, read as the run of sections it is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Parser.walkSections
 */
export function walkSections(
  parser: Parser,
  body: ImageRange,
  options: {
    readonly ffsVersion: number;
    readonly emptyByte: number;
    readonly depth: number;
    /**
     * The file the sections belong to, when the walk knows it: a raw section
     * means something different in some files (§9). A buffer decompressed
     * from a section is walked without it.
     */
    readonly fileGuid?: EFIGUID | undefined;
  }
): UEFINode[] {
  const { ffsVersion, emptyByte, depth, fileGuid } = options;
  if (depth >= parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, body.start);
    return [];
  }
  const nodes: UEFINode[] = [];
  let offset = body.start;

  while (offset < body.end) {
    if (body.end - offset < Section.headerSize) {
      nodes.push(...parser.padding(offset, body.end, emptyByte));
      break;
    }
    const shortSize = parser.reader.uint24(offset);
    const type = parser.reader.uint8(offset + 3);
    if (shortSize === undefined || type === undefined) {
      nodes.push(...parser.padding(offset, body.end, emptyByte));
      break;
    }

    let headerSize: number = Section.headerSize;
    let size = shortSize;
    if (shortSize === Section.extendedSizeMarker && ffsVersion === 3) {
      const extended = parser.reader.uint32(offset + 4);
      if (extended === undefined) {
        parser.note({ kind: "truncated", structure: "sectionHeader" }, offset);
        break;
      }
      headerSize = Section.extendedHeaderSize;
      size = extended;
    }
    if (size === 0) {
      parser.note({ kind: "zeroSize", structure: "sectionHeader" }, offset);
      break;
    }
    if (size < headerSize) {
      parser.note(
        { kind: "sizeMismatch", structure: "sectionHeader", stored: size, computed: headerSize },
        offset
      );
      break;
    }

    let end = offset + size;
    if (end > body.end) {
      parser.note({ kind: "truncated", structure: "sectionBody" }, offset);
      end = body.end;
      if (end - offset <= headerSize) break;
    }

    nodes.push(
      parseSection(parser, {
        offset,
        end,
        headerSize,
        type,
        ffsVersion,
        emptyByte,
        depth,
        fileGuid,
      })
    );

    const up = alignUp(end - body.start, Section.alignment);
    if (up === undefined) break;
    const next = body.start + up;
    if (next <= offset) break;
    nodes.push(...parser.padding(end, Math.min(next, body.end), emptyByte));
    offset = next;
  }
  return nodes;
}

/**
 * Whether `body` reads as a run of sections, the way the reference's probe asks
 * before it reads a raw file's body as one: every section's size at least a
 * header and within what is left, every type's own header there, a GUID-defined
 * section's `DataOffset` inside it, and the next section four-aligned. Unknown
 * types pass, as they do there. Reads and reports nothing — a raw file that is
 * not sections is no defect.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Parser.readsAsSectionRun
 */
export function readsAsSectionRun(parser: Parser, body: ImageRange, ffsVersion: number): boolean {
  let offset = body.start;
  while (offset < body.end) {
    const remaining = body.end - offset;
    const shortSize = parser.reader.uint24(offset);
    const type = parser.reader.uint8(offset + 3);
    if (remaining < Section.headerSize || shortSize === undefined || type === undefined) {
      return false;
    }
    let headerSize: number = Section.headerSize;
    let size = shortSize;
    if (ffsVersion === 3 && shortSize === Section.extendedSizeMarker) {
      const extended = parser.reader.uint32(offset + 4);
      if (remaining < Section.extendedHeaderSize || extended === undefined) return false;
      headerSize = Section.extendedHeaderSize;
      size = extended;
    }
    if (
      size < Section.headerSize ||
      size > remaining ||
      size < headerSize + sectionTypeHeaderSize(type)
    ) {
      return false;
    }
    if (type === Section.guidDefined) {
      const dataOffset = parser.reader.uint16(offset + headerSize + 16);
      if (dataOffset === undefined || dataOffset > size) return false;
    }
    const next = alignUp(offset + size - body.start, Section.alignment);
    if (next === undefined) return false;
    offset = body.start + next;
  }
  return true;
}

function parseSection(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly end: number;
    readonly headerSize: number;
    readonly type: number;
    readonly ffsVersion: number;
    readonly emptyByte: number;
    readonly depth: number;
    readonly fileGuid: EFIGUID | undefined;
  }
): UEFINode {
  const { offset, end, headerSize, type, ffsVersion, emptyByte, depth, fileGuid } = options;
  let name = sectionTypeName(type);
  let guid: EFIGUID | undefined;
  let bodyStart = offset + headerSize;
  let readsBodyAsSections = false;
  // A compressed section this parser decodes is left closed, the way a volume
  // is: decoding one is megabytes of work nobody asked for until its row is
  // opened.
  let decodable = false;
  let compression: SectionCompression | undefined;

  switch (type) {
    case Section.disposable:
      readsBodyAsSections = true;
      break;

    case Section.compression: {
      bodyStart = Math.min(offset + headerSize + Section.compressionHeaderSize, end);
      const algorithm = parser.reader.uint8(offset + headerSize + 4);
      if (algorithm !== undefined) {
        readsBodyAsSections = algorithm === Section.notCompressed;
        name = compressionName(algorithm);
        decodable = algorithmOfCompressionType(algorithm) !== undefined;
        if (algorithm !== Section.notCompressed) {
          compression = { algorithm: algorithmName(algorithm), decodes: decodable };
        }
      }
      break;
    }

    case Section.guidDefined: {
      guid = parser.reader.guid(offset + headerSize);
      // The body starts where the section says it does, not where the structure
      // ends: vendors put certificates and their own headers in between, and
      // `DataOffset` is the only thing that knows.
      const dataOffset = parser.reader.uint16(offset + headerSize + 16);
      if (
        dataOffset !== undefined &&
        dataOffset >= headerSize + Section.guidDefinedHeaderSize &&
        offset + dataOffset <= end
      ) {
        bodyStart = offset + dataOffset;
      } else {
        bodyStart = Math.min(offset + headerSize + Section.guidDefinedHeaderSize, end);
      }
      if (guid !== undefined && guidEquals(guid, AMD_ZLIB_GUID)) {
        bodyStart = amdZlibBodyStart(parser, offset, bodyStart, end);
      }
      const known = guid === undefined ? undefined : guidedSection(guid);
      if (known !== undefined) {
        name = `${known.name} section`;
        readsBodyAsSections = !known.transformsBody;
      }
      if (guid !== undefined) {
        decodable = algorithmOfGuid(guid) !== undefined;
        // A signed or checksummed body is still a run of structures; a
        // compressed one is not, and the badge says which algorithm it is.
        if (known?.compressed === true) {
          compression = { algorithm: known.name, decodes: decodable };
        }
        // A compressed body has to be processed before it is read, and the
        // section is meant to say so. Reported, and decoded all the same.
        const attributes = parser.reader.uint16(offset + headerSize + 18);
        if (
          isCompressedGuid(guid) &&
          attributes !== undefined &&
          (attributes & PROCESSING_REQUIRED) === 0
        ) {
          parser.note({ kind: "processingRequiredNotSet" }, offset);
        }
      }
      break;
    }

    default:
      if (!isKnownSectionType(type)) {
        parser.note({ kind: "unknownType", structure: "sectionHeader", code: type }, offset + 3);
      }
  }

  const body: ImageRange = { start: bodyStart, end };
  let children: UEFINode[] = [];
  if (body.end > body.start) {
    if (readsBodyAsSections) {
      children = walkSections(parser, body, { ffsVersion, emptyByte, depth: depth + 1, fileGuid });
    } else if (
      type === Section.raw &&
      fileGuid !== undefined &&
      guidEquals(fileGuid, ffsPhoenixRawSectionEvsaGuid)
    ) {
      // Phoenix keeps an EVSA store — the Secure Boot defaults among others —
      // in the raw section of a file of its own, and its body reads as an NVRAM
      // volume's does (§9).
      children = walkStores(parser, body, emptyByte, depth + 1);
    } else if (type === Section.raw) {
      // The external defaults file's raw section is an NVAR store and is meant
      // to read as one. Any other raw section is tried, the way the reference
      // tries every one: a store opens `NVAR`, so a body that does not costs
      // one read to turn down (§9).
      const isDefaults =
        fileGuid !== undefined && guidEquals(fileGuid, nvramNvarExternalDefaultsFileGuid);
      children =
        parseNvarStore(parser, body, { emptyByte, probe: !isDefaults, depth: depth + 1 }) ??
        // Most of a firmware's pictures — the logo, the setup screen's icons —
        // are a raw section's whole body.
        pictureBody(parser, body, emptyByte) ??
        [];
    } else if (type === Section.firmwareVolumeImage) {
      // A volume inside a section, and files inside that: the point at which
      // this format starts over one level down.
      const volume = parseVolume(parser, { offset: bodyStart, limit: end, depth: depth + 1 });
      if (volume !== undefined) children = [volume];
    } else if (type === Section.userInterface) {
      const text = ucs2String(parser, body);
      if (text !== undefined) name = text;
    }
  }

  return makeNode({
    kind: "section",
    subtype: type,
    name,
    guid,
    header: { start: offset, end: bodyStart },
    body,
    compression,
    isExpandable: decodable && body.end > body.start,
    childDepth: depth + 1,
    children,
  });
}

/**
 * Where an AMD Zlib section's stream starts: after the vendor's header, which belongs
 * to the section's header as the reference draws it (§2.2). The header's
 * `CompressedSize` is meant to account for the rest of the section exactly; when it
 * does not, that is said and the stream is read all the same, as the reference reads
 * it. A section too short to hold the header keeps its data where `DataOffset` puts
 * it, and does not decode.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Parser.amdZlibBodyStart
 */
function amdZlibBodyStart(parser: Parser, offset: number, dataStart: number, end: number): number {
  const streamStart = dataStart + AMD_ZLIB_HEADER_SIZE;
  const stored = parser.reader.uint32(dataStart + AMD_ZLIB_COMPRESSED_SIZE_OFFSET);
  if (streamStart > end || stored === undefined) return dataStart;
  if (stored !== end - streamStart) {
    parser.note(
      { kind: "sizeMismatch", structure: "amdZlibHeader", stored, computed: end - streamStart },
      offset
    );
  }
  return streamStart;
}

/**
 * A compression section's algorithm by the name a panel shows.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/CompressedSection.swift#CompressedSection.algorithmName
 */
function algorithmName(algorithm: number): string {
  switch (algorithm) {
    case 0x01:
      return "Tiano";
    case 0x02:
      return "LZMA";
    case 0x86:
      return "LZMA with x86 filter";
    default:
      return `Compression type 0x${algorithm.toString(16).toUpperCase().padStart(2, "0")}`;
  }
}

function compressionName(algorithm: number): string {
  switch (algorithm) {
    case Section.notCompressed:
      return "Uncompressed section";
    case 0x01:
      return "Tiano compressed section";
    case 0x02:
      // EDK2 calls it customized; every image that uses it means LZMA.
      return "LZMA compressed section";
    case 0x86:
      return "LZMA with x86 filter section";
    default:
      return `Compressed section (type 0x${algorithm.toString(16).toUpperCase().padStart(2, "0")})`;
  }
}

/**
 * A user-interface section is a UCS-2 string with a terminating zero — the name
 * a person gave the file, and the only readable name most files have.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Parser.ucs2String
 */
export function ucs2String(parser: Parser, range: ImageRange): string | undefined {
  const bytes = parser.reader.bytes(range);
  if (bytes === undefined || bytes.length < 2) return undefined;
  const units: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (unit === 0) break;
    units.push(unit);
  }
  const text = String.fromCharCode(...units);
  return text.length === 0 ? undefined : text;
}
