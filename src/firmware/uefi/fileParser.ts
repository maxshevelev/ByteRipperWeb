import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum8, sum8Of } from "@/firmware/uefi/checksums";
import { type EFIGUID, guid, guidBytes, guidEquals } from "@/firmware/uefi/efiGuid";
import { readingFITComponents } from "@/firmware/uefi/fitComponents";
import { nameOfGuid, PHOENIX_HASH_FILE } from "@/firmware/uefi/knownGuids";
import { parseNvarStore } from "@/firmware/uefi/nvarParser";
import {
  nvramNvarBbDefaultsFileGuid,
  nvramNvarPeiExternalDefaultsFileGuid,
  nvramNvarStoreFileGuid,
} from "@/firmware/uefi/nvramGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import { scanRawArea } from "@/firmware/uefi/rawScan";
import {
  readsAsSectionRun,
  Section,
  ucs2String,
  walkSections,
} from "@/firmware/uefi/sectionParser";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { FV } from "@/firmware/uefi/volumeFormat";

/**
 * `EFI_FFS_FILE_HEADER` and its variants.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS
 */
export const FFS = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.headerSize */
  headerSize: 0x18,
  /**
   * FFSv3 large file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.largeHeaderSize
   */
  largeHeaderSize: 0x20,
  /**
   * Lenovo's large file in an FFSv2 Revision 2 volume — not in any
   * specification, and in plenty of laptops.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.lenovoHeaderSize
   */
  lenovoHeaderSize: 0x1c,

  /**
   * The same bit means different things depending on the *volume's* revision,
   * not the file's, which is the trap in this structure.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.tailPresent
   */
  tailPresent: 0x01, // volume revision 1
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.largeFile */
  largeFile: 0x01, // FFSv3, and Lenovo in FFSv2 rev 2
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.fixed */
  fixed: 0x04,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.checksumBit */
  checksumBit: 0x40,

  /**
   * What the body checksum field holds when the file does not have one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.fixedChecksum
   */
  fixedChecksum: 0x5a, // volume revision 1
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.fixedChecksum2 */
  fixedChecksum2: 0xaa, // revision 2

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.padType */
  padType: 0xf0,
  /**
   * `RECOVERY_STARTUP_AP_DATA_X86_128K`: what EDK2's GenFv writes into the pad
   * file in front of the Volume Top File — `jmp far F000:FFD0`, then zeros and
   * two bytes the reference matches as written.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.startupApDataX86_128K
   */
  startupApDataX86_128K: Uint8Array.of(
    0xea,
    0xd0,
    0xff,
    0x00,
    0xf0,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x27,
    0x2d
  ),
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.rawType */
  rawType: 0x01,
  /**
   * `EFI_FV_FILETYPE_ALL`: never a file's real type, and read the way a raw
   * file is where it turns up.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.allType
   */
  allType: 0x00,
  /**
   * In the file's *state* byte, not its attributes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.erasePolarity
   */
  erasePolarity: 0x80,
} as const;

/**
 * What a file's state byte says (§5.5).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FileState
 */
export const FileState = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FileState.headerValid */
  headerValid: 0x02,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FileState.headerInvalid */
  headerInvalid: 0x20,
} as const;

/**
 * Whether the state marks the file's header as not to be trusted — not marked
 * valid, or marked invalid — read under the volume's erase polarity *and* under
 * the file's own polarity bit. A file marked so owes no checksum: the firmware
 * does not take its header, and a sum over it says nothing. Under one reading
 * only it is a file written under the other polarity, which `1.bin` has one of,
 * valid the other way round, so its checksums are still checked. Nothing for the
 * volume's polarity when the file is read without its volume.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FileState.marksHeaderInvalid
 */
export function marksHeaderInvalid(
  state: number,
  volumeErasePolarity: boolean | undefined
): boolean {
  const invalid = (logical: number) =>
    (logical & FileState.headerInvalid) !== 0 || (logical & FileState.headerValid) === 0;
  // Under an erase polarity of 1 a bit is set by clearing it, so the byte reads
  // inverted.
  const logical = (polarity: boolean) => (polarity ? ~state & 0xff : state);
  const own = invalid(logical((state & FFS.erasePolarity) !== 0));
  if (volumeErasePolarity === undefined) return own;
  return own && invalid(logical(volumeErasePolarity));
}

/**
 * A volume's erase polarity, from its header's attributes (§3.5); nothing for a
 * node that is not a volume or a header that does not read.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FileState.erasePolarity
 */
export function volumeErasePolarity(volume: UEFINode, reader: ImageReader): boolean | undefined {
  if (volume.kind !== "volume") return undefined;
  const attributes = reader.uint32(volume.header.start + 0x2c);
  return attributes === undefined ? undefined : (attributes & FV.erasePolarity) !== 0;
}

/**
 * Every file's body is a run of sections except these two, which are the bytes
 * they say they are.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.hasSections
 */
export function hasSections(type: number): boolean {
  return type !== FFS.rawType && type !== FFS.padType;
}

/**
 * AMI's ROM holes: files whose place in the flash is fixed and whose body is the
 * vendor's, not structure (`AMI_ROM_HOLE_FILE_GUID_0..15`).
 *
 * `05CA01FC-0FC1-11DC-9011-00173153EBA8` up to `05CA020B-…`: the first dword
 * counts, the rest is the same.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.isRomHole
 */
export function isRomHole(name: EFIGUID): boolean {
  const bytes = guidBytes(name);
  const first =
    ((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8) | ((bytes[2] ?? 0) << 16)) +
    (bytes[3] ?? 0) * 0x100_0000;
  return (
    first >= 0x05ca_01fc &&
    first <= 0x05ca_020b &&
    bytes.subarray(4).every((byte, index) => byte === ROM_HOLE_TAIL[index])
  );
}

const ROM_HOLE_TAIL = guidBytes(guid("05CA01FC-0FC1-11DC-9011-00173153EBA8")).subarray(4);

/**
 * The files whose body is an AMI NVAR store (§9): the store itself, and the
 * two sets of defaults the firmware falls back to.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.holdsNvarStore
 */
export function holdsNvarStore(name: EFIGUID, type: number): boolean {
  return (
    (type === FFS.rawType || type === FFS.allType) &&
    (guidEquals(name, nvramNvarStoreFileGuid) ||
      guidEquals(name, nvramNvarPeiExternalDefaultsFileGuid) ||
      guidEquals(name, nvramNvarBbDefaultsFileGuid))
  );
}

const FILE_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: "Raw",
  2: "Freeform",
  3: "Security core",
  4: "PEI core",
  5: "DXE core",
  6: "PEIM",
  7: "Driver",
  8: "Combined PEIM/driver",
  9: "Application",
  10: "MM module",
  11: "Volume image",
  12: "Combined MM/DXE",
  13: "MM core",
  14: "MM standalone",
  15: "MM core standalone",
  240: "Pad file",
};

/**
 * Unknown codes keep their number, which is the only thing there is to say
 * about a vendor type nobody documented.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#FFS.typeName
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypeNames.swift#UEFITypeNames.file
 */
export function fileTypeName(type: number): string {
  const known = FILE_TYPE_NAMES[type];
  if (known !== undefined) return known;
  if (type >= 0xc0 && type <= 0xdf) return "OEM file";
  if (type >= 0xe0 && type <= 0xef) return "Debug file";
  return `File type 0x${type.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#Parser.ParsedFile */
export interface ParsedFile {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#Parser.ParsedFile.node */
  readonly node: UEFINode;
  /**
   * Header through tail, before the walk aligns to the next file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#Parser.ParsedFile.size
   */
  readonly size: number;
}

/**
 * One FFS file.
 *
 * Nothing means the volume's body cannot be walked past this point — a size of
 * zero or a header that does not fit — and the caller stops rather than looping
 * on the same offset.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#Parser.parseFile
 */
export function parseFile(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly limit: number;
    readonly ffsVersion: number;
    readonly volumeRevision: number;
    readonly volumeErasePolarity?: boolean | undefined;
    readonly depth: number;
  }
): ParsedFile | undefined {
  const { offset, limit, ffsVersion, volumeRevision, depth } = options;
  const reader = parser.reader;

  const name = reader.guid(offset);
  const headerChecksum = reader.uint8(offset + 0x10);
  const bodyChecksum = reader.uint8(offset + 0x11);
  const type = reader.uint8(offset + 0x12);
  const attributes = reader.uint8(offset + 0x13);
  const shortSize = reader.uint24(offset + 0x14);
  const state = reader.uint8(offset + 0x17);
  if (
    name === undefined ||
    headerChecksum === undefined ||
    bodyChecksum === undefined ||
    type === undefined ||
    attributes === undefined ||
    shortSize === undefined ||
    state === undefined
  ) {
    parser.note({ kind: "truncated", structure: "fileHeader" }, offset);
    return undefined;
  }

  const measured = fileSize(parser, { offset, shortSize, attributes, ffsVersion, volumeRevision });
  const headerSize = measured.headerSize;
  const size = measured.size;
  if (size === undefined) {
    parser.note({ kind: "truncated", structure: "fileHeader" }, offset + 0x18);
    return undefined;
  }
  if (size === 0) {
    parser.note({ kind: "zeroSize", structure: "fileHeader" }, offset + 0x14);
    return undefined;
  }
  if (size < headerSize) {
    parser.note(
      { kind: "sizeMismatch", structure: "fileHeader", stored: size, computed: headerSize },
      offset + 0x14
    );
    return undefined;
  }

  let end = offset + size;
  if (end > limit) {
    parser.note({ kind: "truncated", structure: "fileBody" }, offset + 0x14);
    end = limit;
    if (end - offset < headerSize) return undefined;
  }

  // FFSv1 keeps two bytes of tail after the body, and nothing else does.
  const tailSize =
    volumeRevision === 1 && (attributes & FFS.tailPresent) !== 0 && end - offset > headerSize
      ? 2
      : 0;
  const body: ImageRange = { start: offset + headerSize, end: end - tailSize };
  const tail: ImageRange = { start: end - tailSize, end };

  // A file its own state marks invalid is reported as that, and its checksums
  // are not held against it (§5.5).
  if (marksHeaderInvalid(state, options.volumeErasePolarity)) {
    parser.note({ kind: "fileHeaderMarkedInvalid", state }, offset + 0x17);
  } else {
    verifyFileChecksums(parser, {
      offset,
      headerSize,
      body,
      headerChecksum,
      bodyChecksum,
      attributes,
      volumeRevision,
    });
  }
  if (type > 0x0f && type !== FFS.padType) {
    parser.note({ kind: "unknownType", structure: "fileHeader", code: type }, offset + 0x12);
  }

  // A file's erase polarity is its own, taken from its state byte rather than
  // from the volume, so that a volume holding files written under both
  // polarities still reads.
  const emptyByte = (state & FFS.erasePolarity) !== 0 ? 0xff : 0x00;
  let children: UEFINode[] = [];
  let romHole = false;
  if (holdsNvarStore(name, type) && body.end > body.start) {
    // The body is the store, with no header of its own; when it does not read
    // as one, the file stays a leaf and the parse says why.
    children = parseNvarStore(parser, body, { emptyByte, probe: false, depth: depth + 1 }) ?? [];
  } else if ((type === FFS.rawType || type === FFS.allType) && body.end > body.start) {
    // A raw file's body is whatever its owner put there, read the way the
    // reference reads it (`parseFileBody`): an AMI ROM hole is the vendor's and
    // stays whole, and fixed; a Phoenix hash file is read by the protected
    // ranges; anything else is sections when it reads as sections, and
    // otherwise a raw area — which is where volumes, microcode and the rest are
    // found inside one.
    if (isRomHole(name)) {
      romHole = true;
    } else if (!guidEquals(name, PHOENIX_HASH_FILE)) {
      if (readsAsSectionRun(parser, body, ffsVersion)) {
        children = walkSections(parser, body, {
          ffsVersion,
          emptyByte,
          depth: depth + 1,
          fileGuid: name,
        });
      } else {
        // A raw area with nothing in it leaves the file a leaf, as the
        // reference leaves it: one padding row the size of the body would say
        // nothing the file's own row does not.
        const found = scanRawArea(parser, body, emptyByte, depth + 1);
        children = found.some((one) => one.kind !== "padding" || one.children.length > 0)
          ? found
          : [];
      }
    }
  } else if (hasSections(type) && body.end > body.start) {
    children = walkSections(parser, body, {
      ffsVersion,
      emptyByte,
      depth: depth + 1,
      fileGuid: name,
    });
  } else if (type === FFS.padType && body.end > body.start) {
    children = padFileBody(parser, body, emptyByte);
  }

  const node = makeNode({
    kind: "file",
    subtype: type,
    // A pad file's GUID is filler — all ones, as a rule — and names nothing, so
    // the file is called what it is.
    name:
      type === FFS.padType
        ? L("Padding file")
        : (nameOfGuid(name) ?? userInterfaceName(parser, children) ?? fileTypeName(type)),
    guid: name,
    header: { start: offset, end: offset + headerSize },
    body,
    tail,
    isFixed: (attributes & FFS.fixed) !== 0 || romHole,
    children,
  });
  return { node, size: end - offset };
}

/**
 * A pad file's body, the way UEFITool's `parsePadFileBody` reads it: an erased
 * body is nothing; otherwise the erased bytes up to the first written one —
 * rounded down to eight, and only when there are eight — are free space, and the
 * rest is either the Startup AP data or data that has no business in a pad file,
 * which is reported.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FileParser.swift#Parser.padFileBody
 */
function padFileBody(parser: Parser, body: ImageRange, emptyByte: number): UEFINode[] {
  const firstWritten = parser.reader.firstOffsetNotEqualTo(body, emptyByte);
  if (firstWritten === undefined) return [];
  let dataStart = body.start;
  const nodes: UEFINode[] = [];
  const leading = firstWritten - body.start;
  if (leading >= 8) {
    dataStart = body.start + Math.floor(leading / 8) * 8;
    nodes.push(
      makeSpan({
        kind: "freeSpace",
        name: L("Free space"),
        range: { start: body.start, end: dataStart },
        isErased: true,
      })
    );
  }
  const data: ImageRange = { start: dataStart, end: body.end };
  const signature = FFS.startupApDataX86_128K;
  const found = parser.reader.bytesAt(dataStart, signature.length);
  if (found?.every((byte, index) => byte === signature[index]) === true) {
    nodes.push(
      makeNode({
        kind: "startupApData",
        subtype: Sub.x86128kStartupApDataEntry,
        name: "Startup AP data",
        header: { start: dataStart, end: dataStart },
        body: data,
        isFixed: true,
      })
    );
  } else {
    parser.note({ kind: "nonUEFIDataInPadFile" }, dataStart);
    // A vendor that keeps a Boot Guard manifest or the FIT itself in a pad file
    // gets it named, under the row the reference shows.
    // The data is one padding row, and what the FIT names in it are that row's
    // rows — which become the Non-UEFI data's own.
    const pieces =
      readingFITComponents(parser, parser.padding(data.start, data.end, emptyByte), emptyByte)[0]
        ?.children ?? [];
    nodes.push(
      makeNode({
        kind: "padding",
        name: L("Non-UEFI data"),
        header: { start: dataStart, end: dataStart },
        body: data,
        children: pieces,
      })
    );
  }
  return nodes;
}

/**
 * The name a person gave the file, if one of its sections carries one.
 *
 * Worth going looking for: it is the only readable name most files have, and
 * without it a volume is three hundred rows of GUIDs.
 */
function userInterfaceName(parser: Parser, sections: readonly UEFINode[]): string | undefined {
  for (const section of sections) {
    if (section.kind !== "section") continue;
    if (section.subtype === Section.userInterface) {
      const text = ucs2String(parser, section.body);
      if (text !== undefined) return text;
    }
    const nested = userInterfaceName(parser, section.children);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * The header's own size depends on a bit whose meaning depends on the volume.
 * A missing size means the extended field is off the end of the image.
 */
function fileSize(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly shortSize: number;
    readonly attributes: number;
    readonly ffsVersion: number;
    readonly volumeRevision: number;
  }
): { headerSize: number; size: number | undefined } {
  const { offset, shortSize, attributes, ffsVersion, volumeRevision } = options;
  const isLarge = (attributes & FFS.largeFile) !== 0;
  if (ffsVersion === 3 && isLarge) {
    return { headerSize: FFS.largeHeaderSize, size: parser.reader.uint64(offset + 0x18) };
  }
  if (ffsVersion === 2 && volumeRevision === 2 && isLarge) {
    return { headerSize: FFS.lenovoHeaderSize, size: parser.reader.uint32(offset + 0x18) };
  }
  return { headerSize: FFS.headerSize, size: shortSize };
}

/**
 * The header sum leaves out the two checksum bytes and the state byte, because
 * those are written after it is computed and changed again every time the file
 * is marked.
 */
function verifyFileChecksums(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly headerSize: number;
    readonly body: ImageRange;
    readonly headerChecksum: number;
    readonly bodyChecksum: number;
    readonly attributes: number;
    readonly volumeRevision: number;
  }
): void {
  const { offset, headerSize, body, headerChecksum, bodyChecksum, attributes } = options;
  const header = parser.reader.bytesAt(offset, headerSize);
  const state = parser.reader.uint8(offset + 0x17);
  if (header !== undefined && state !== undefined) {
    const sum = (sum8(header) - headerChecksum - bodyChecksum - state) & 0xff;
    const computed = (0x100 - sum) & 0xff;
    if (computed !== headerChecksum) {
      parser.note(
        {
          kind: "checksumMismatch",
          structure: "fileHeader",
          stored: headerChecksum,
          computed,
        },
        offset + 0x10
      );
    }
  }

  if (body.end <= body.start) return;
  let computed: number;
  if ((attributes & FFS.checksumBit) !== 0) {
    const sum = sum8Of(body, parser.reader);
    if (sum === undefined) return;
    computed = (0x100 - sum) & 0xff;
  } else {
    computed = options.volumeRevision === 1 ? FFS.fixedChecksum : FFS.fixedChecksum2;
  }
  if (computed !== bodyChecksum) {
    parser.note(
      { kind: "checksumMismatch", structure: "fileBody", stored: bodyChecksum, computed },
      offset + 0x11
    );
  }
}
