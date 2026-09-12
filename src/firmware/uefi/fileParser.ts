import type { ImageRange } from "@/firmware/imageReader";
import { sum8, sum8Of } from "@/firmware/uefi/checksums";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import { Section, ucs2String, walkSections } from "@/firmware/uefi/sectionParser";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/** `EFI_FFS_FILE_HEADER` and its variants. */
export const FFS = {
  headerSize: 0x18,
  /** FFSv3 large file. */
  largeHeaderSize: 0x20,
  /**
   * Lenovo's large file in an FFSv2 Revision 2 volume — not in any
   * specification, and in plenty of laptops.
   */
  lenovoHeaderSize: 0x1c,

  /**
   * The same bit means different things depending on the *volume's* revision,
   * not the file's, which is the trap in this structure.
   */
  tailPresent: 0x01, // volume revision 1
  largeFile: 0x01, // FFSv3, and Lenovo in FFSv2 rev 2
  fixed: 0x04,
  checksumBit: 0x40,

  /** What the body checksum field holds when the file does not have one. */
  fixedChecksum: 0x5a, // volume revision 1
  fixedChecksum2: 0xaa, // revision 2

  padType: 0xf0,
  rawType: 0x01,
  /** In the file's *state* byte, not its attributes. */
  erasePolarity: 0x80,
} as const;

/**
 * Every file's body is a run of sections except these two, which are the bytes
 * they say they are.
 */
export function hasSections(type: number): boolean {
  return type !== FFS.rawType && type !== FFS.padType;
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
 */
export function fileTypeName(type: number): string {
  const known = FILE_TYPE_NAMES[type];
  if (known !== undefined) return known;
  if (type >= 0xc0 && type <= 0xdf) return "OEM file";
  if (type >= 0xe0 && type <= 0xef) return "Debug file";
  return `File type 0x${type.toString(16).toUpperCase().padStart(2, "0")}`;
}

export interface ParsedFile {
  readonly node: UEFINode;
  /** Header through tail, before the walk aligns to the next file. */
  readonly size: number;
}

/**
 * One FFS file.
 *
 * Nothing means the volume's body cannot be walked past this point — a size of
 * zero or a header that does not fit — and the caller stops rather than looping
 * on the same offset.
 */
export function parseFile(
  parser: Parser,
  options: {
    readonly offset: number;
    readonly limit: number;
    readonly ffsVersion: number;
    readonly volumeRevision: number;
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

  verifyFileChecksums(parser, {
    offset,
    headerSize,
    body,
    headerChecksum,
    bodyChecksum,
    attributes,
    volumeRevision,
  });
  if (type > 0x0f && type !== FFS.padType) {
    parser.note({ kind: "unknownType", structure: "fileHeader", code: type }, offset + 0x12);
  }

  // A file's erase polarity is its own, taken from its state byte rather than
  // from the volume, so that a volume holding files written under both
  // polarities still reads.
  const emptyByte = (state & FFS.erasePolarity) !== 0 ? 0xff : 0x00;
  let children: UEFINode[] = [];
  if (hasSections(type) && body.end > body.start) {
    children = walkSections(parser, body, { ffsVersion, emptyByte, depth: depth + 1 });
  }

  const node = makeNode({
    kind: "file",
    subtype: type,
    name: nameOfGuid(name) ?? userInterfaceName(parser, children) ?? fileTypeName(type),
    guid: name,
    header: { start: offset, end: offset + headerSize },
    body,
    tail,
    isFixed: (attributes & FFS.fixed) !== 0,
    children,
  });
  return { node, size: end - offset };
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
