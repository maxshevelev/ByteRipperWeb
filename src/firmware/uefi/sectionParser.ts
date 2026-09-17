import type { ImageRange } from "@/firmware/imageReader";
import { alignUp } from "@/firmware/uefi/checksums";
import {
  algorithmOfCompressionType,
  algorithmOfGuid,
  isCompressedGuid,
  PROCESSING_REQUIRED,
} from "@/firmware/uefi/compressedSection";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { guidedSection } from "@/firmware/uefi/knownGuids";
import type { Parser } from "@/firmware/uefi/parserState";
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

const SECTION_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: "Compressed section",
  2: "GUID-defined section",
  3: "Disposable section",
  16: "PE32 image",
  17: "PIC image",
  18: "TE image",
  19: "DXE dependency",
  20: "Version",
  21: "Name",
  22: "Compatibility16",
  23: "Volume image",
  24: "Freeform subtype GUID",
  25: "Raw",
  27: "PEI dependency",
  28: "MM dependency",
  32: "Insyde postcode",
  240: "Phoenix postcode",
};

/**
 * A vendor type nobody documented keeps its number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypeNames.swift#UEFITypeNames.section
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SectionParser.swift#Section.typeName
 */
export function sectionTypeName(type: number): string {
  return (
    SECTION_TYPE_NAMES[type] ?? `Section type 0x${type.toString(16).toUpperCase().padStart(2, "0")}`
  );
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
  options: { readonly ffsVersion: number; readonly emptyByte: number; readonly depth: number }
): UEFINode[] {
  const { ffsVersion, emptyByte, depth } = options;
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
      parseSection(parser, { offset, end, headerSize, type, ffsVersion, emptyByte, depth })
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
  }
): UEFINode {
  const { offset, end, headerSize, type, ffsVersion, emptyByte, depth } = options;
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
      children = walkSections(parser, body, { ffsVersion, emptyByte, depth: depth + 1 });
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
