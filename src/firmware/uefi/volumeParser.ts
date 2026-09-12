import type { ImageRange } from "@/firmware/imageReader";
import { alignUp, checksum16 } from "@/firmware/uefi/checksums";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { FFS, parseFile } from "@/firmware/uefi/fileParser";
import { ffsVersionOfFileSystem, nameOfGuid } from "@/firmware/uefi/knownGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import { scanRawArea } from "@/firmware/uefi/rawScan";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/** `EFI_FIRMWARE_VOLUME_HEADER` and what follows from it. */
export const FV = {
  /**
   * `_FVH`, which sits at a fixed `0x28` from the start of the header. The
   * search is for the signature and the header is found by stepping back —
   * there is nothing at offset zero of a volume worth matching on.
   */
  signature: 0x4856_465f,
  signatureOffset: 0x28,
  /** Up to the block map. */
  headerSize: 0x38,
  blockMapEntrySize: 8,
  /** A block map long enough to be a loop rather than a map. */
  maxBlockMapEntries: 0x1000,
  erasePolarity: 0x0000_0800,
  checksumOffset: 0x32,
} as const;

/**
 * A volume header that passed every test — which is what separates a volume
 * from four bytes of compressed data that happen to read `_FVH`.
 */
export interface VolumeHeader {
  readonly offset: number;
  readonly fileSystem: EFIGUID;
  readonly fvLength: number;
  readonly attributes: number;
  readonly headerLength: number;
  readonly checksum: number;
  readonly revision: number;
  /** Header through extended header, aligned — where the body starts. */
  readonly headerSize: number;
  /** Σ NumBlocks · Length, the volume's size as the block map tells it. */
  readonly blockMapSize: number | undefined;
  /** The extended header the volume points at runs off the end of the image. */
  readonly extendedHeaderMissing: boolean;
}

/** What an unwritten byte in this volume reads as, inherited by everything in it. */
export function volumeEmptyByte(header: VolumeHeader): number {
  return (header.attributes & FV.erasePolarity) !== 0 ? 0xff : 0x00;
}

/**
 * Reads and validates a header.
 *
 * Pure: a candidate that fails leaves no diagnostic, because a false `_FVH`
 * inside compressed data is not a defect in the image — and an image with a
 * hundred of them would otherwise arrive with a hundred complaints.
 */
export function readVolumeHeader(parser: Parser, offset: number): VolumeHeader | undefined {
  const reader = parser.reader;
  // The signature first, and on its own. This is asked at every unclaimed byte
  // of an NVRAM walk — twelve recognisers a byte, and this is the last of them
  // — so the seven reads below must not be paid by the bytes that are not a
  // volume at all. Upstream measured it on a 16 MiB image with a 258 KiB run of
  // written-over padding: 409 ms of the walk's 473 was this function reading a
  // GUID, a length and five more fields before looking at the four bytes that
  // decide.
  if (reader.uint32(offset + FV.signatureOffset) !== FV.signature) return undefined;

  const fileSystem = reader.guid(offset + 0x10);
  const fvLength = reader.uint64(offset + 0x20);
  const attributes = reader.uint32(offset + 0x2c);
  const headerLength = reader.uint16(offset + 0x30);
  const checksum = reader.uint16(offset + 0x32);
  const extHeaderOffset = reader.uint16(offset + 0x34);
  const revision = reader.uint8(offset + 0x37);
  if (
    fileSystem === undefined ||
    fvLength === undefined ||
    attributes === undefined ||
    headerLength === undefined ||
    checksum === undefined ||
    extHeaderOffset === undefined ||
    revision === undefined
  ) {
    return undefined;
  }

  if (revision !== 1 && revision !== 2) return undefined;
  if (fvLength < FV.headerSize + 2 * FV.blockMapEntrySize) return undefined;
  if (fvLength >= 0xffff_ffff) return undefined;
  if (headerLength < FV.headerSize) return undefined;
  const alignedHeader = alignUp(headerLength, 8);
  if (alignedHeader === undefined) return undefined;
  if (reader.range(offset, alignedHeader) === undefined) return undefined;

  let headerSize: number = headerLength;
  let extendedHeaderMissing = false;
  if (revision > 1 && extHeaderOffset !== 0) {
    const extSize = reader.uint32(offset + extHeaderOffset + 0x10);
    if (extSize !== undefined && extSize > 0) headerSize = extHeaderOffset + extSize;
    else extendedHeaderMissing = true;
  }
  const aligned = alignUp(headerSize, 8);
  if (aligned === undefined || aligned > fvLength) return undefined;

  return {
    offset,
    fileSystem,
    fvLength,
    attributes,
    headerLength,
    checksum,
    revision,
    headerSize: aligned,
    blockMapSize: blockMapSize(parser, offset + FV.headerSize),
    extendedHeaderMissing,
  };
}

/**
 * The block map is a second opinion about the volume's size. A volume whose two
 * sizes disagree is damaged but still worth reading, so this is reported and
 * `FvLength` is believed.
 */
function blockMapSize(parser: Parser, offset: number): number | undefined {
  let total = 0;
  let at = offset;
  for (let entry = 0; entry < FV.maxBlockMapEntries; entry++) {
    const blocks = parser.reader.uint32(at);
    const length = parser.reader.uint32(at + 4);
    if (blocks === undefined || length === undefined) return undefined;
    if (blocks === 0 && length === 0) return total;
    total += blocks * length;
    at += FV.blockMapEntrySize;
  }
  return undefined;
}

/**
 * A volume and everything in it. Nothing when the header does not check out,
 * which is the scanner's cue to keep looking.
 */
export function parseVolume(
  parser: Parser,
  options: { readonly offset: number; readonly limit: number; readonly depth: number }
): UEFINode | undefined {
  const { offset, limit, depth } = options;
  const header = readVolumeHeader(parser, offset);
  if (header === undefined) return undefined;

  let size = header.fvLength;
  if (offset + size > limit) {
    parser.note({ kind: "truncated", structure: "volumeBody" }, offset);
    size = limit - offset;
  }
  if (header.blockMapSize !== undefined && header.blockMapSize !== header.fvLength) {
    parser.note(
      {
        kind: "sizeMismatch",
        structure: "volumeHeader",
        stored: header.fvLength,
        computed: header.blockMapSize,
      },
      offset + 0x20
    );
  }
  if (header.extendedHeaderMissing) {
    parser.note({ kind: "truncated", structure: "volumeExtendedHeader" }, offset + 0x34);
  }
  verifyVolumeChecksum(parser, header);

  const bodyStart = Math.min(offset + header.headerSize, offset + size);
  const body: ImageRange = { start: bodyStart, end: offset + size };

  // The file walk of the body is the other expensive half of this parser — a
  // few hundred files, each read back for its own sections — and is always left
  // for the materialization to run when something asks for this volume's
  // children. The header, which is what says the volume is a volume at all, has
  // already been read and checked above.
  return makeNode({
    kind: "volume",
    subtype: header.revision,
    name: nameOfGuid(header.fileSystem) ?? "Volume",
    guid: header.fileSystem,
    header: { start: offset, end: bodyStart },
    body,
    isFixed: false,
    isExpandable: body.end > body.start,
    childDepth: depth,
  });
}

/**
 * Over `HeaderLength` bytes and not over the whole header: the extended header
 * is outside the sum, and including it is the mistake that makes every
 * Revision 2 volume look corrupt.
 */
function verifyVolumeChecksum(parser: Parser, header: VolumeHeader): void {
  const read = parser.reader.bytesAt(header.offset, header.headerLength);
  if (read === undefined) return;
  const bytes = Uint8Array.from(read);
  bytes[FV.checksumOffset] = 0;
  bytes[FV.checksumOffset + 1] = 0;
  const computed = checksum16(bytes);
  if (computed === undefined || computed === header.checksum) return;
  parser.note(
    {
      kind: "checksumMismatch",
      structure: "volumeHeader",
      stored: header.checksum,
      computed,
    },
    header.offset + FV.checksumOffset
  );
}

/**
 * A volume's children, derived when something expands it — scoped to that one
 * node rather than restarting the parse from the image root.
 */
export function volumeChildren(
  parser: Parser,
  header: VolumeHeader,
  body: ImageRange,
  depth: number,
  walkNvram?: (body: ImageRange, emptyByte: number, depth: number) => UEFINode[] | undefined
): UEFINode[] {
  if (body.end <= body.start) return [];
  if (depth >= parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, header.offset);
    return [];
  }
  const emptyByte = volumeEmptyByte(header);
  // An NVRAM store volume is read as a run of stores, not as FFS files — its
  // file-system GUID is not an FFS version, so it has to be checked before the
  // FFS dispatch would call it unknown.
  if (walkNvram !== undefined) {
    const stores = walkNvram(body, emptyByte, depth + 1);
    if (stores !== undefined) return stores;
  }
  const ffsVersion = ffsVersionOfFileSystem(header.fileSystem);
  if (ffsVersion === undefined) {
    // A volume we cannot read the inside of still keeps its bytes.
    parser.note({ kind: "unknownFileSystem", guid: header.fileSystem }, header.offset + 0x10);
    return [];
  }
  return walkVolumeBody(parser, body, {
    ffsVersion,
    volumeRevision: header.revision,
    emptyByte,
    depth: depth + 1,
  });
}

/**
 * The file walk: files back to back, each one aligned up to eight, until an
 * all-empty header says the rest is free space.
 */
export function walkVolumeBody(
  parser: Parser,
  body: ImageRange,
  options: {
    readonly ffsVersion: number;
    readonly volumeRevision: number;
    readonly emptyByte: number;
    readonly depth: number;
  }
): UEFINode[] {
  const { ffsVersion, volumeRevision, emptyByte, depth } = options;
  const nodes: UEFINode[] = [];
  let offset = body.start;

  while (offset < body.end) {
    if (body.end - offset < FFS.headerSize) {
      nodes.push(nonUEFIData(parser, { start: offset, end: body.end }, emptyByte, depth));
      break;
    }
    if (parser.reader.isFilled({ start: offset, end: offset + FFS.headerSize }, emptyByte)) {
      nodes.push(...freeSpace(parser, offset, body.end, body, emptyByte, depth));
      break;
    }
    const file = parseFile(parser, {
      offset,
      limit: body.end,
      ffsVersion,
      volumeRevision,
      depth,
    });
    if (file === undefined) break;

    nodes.push(file.node);
    const up = alignUp(offset + file.size - body.start, 8);
    if (up === undefined) break;
    const next = body.start + up;
    if (next <= offset) break;
    // The bytes a file's size stops short of the next eight-byte boundary
    // belong to nobody, and a byte in no node is a byte that cannot be written
    // back.
    nodes.push(...parser.padding(offset + file.size, Math.min(next, body.end), emptyByte));
    offset = next;
  }
  return nodes;
}

/**
 * The tail of a volume's body.
 *
 * Usually all erased; when it is not, the bytes after the last erased one are
 * data somebody put there on purpose. Keeping them as a node of their own is
 * what makes them visible at all.
 */
function freeSpace(
  parser: Parser,
  start: number,
  end: number,
  body: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode[] {
  const firstUsed = parser.reader.firstOffsetNotEqualTo({ start, end }, emptyByte);
  if (firstUsed === undefined) {
    return [
      makeSpan({ kind: "freeSpace", name: "Free space", range: { start, end }, isErased: true }),
    ];
  }
  // Back to the eight-byte boundary at or before the byte: what follows a
  // volume's free space starts aligned, whatever it turns out to be.
  let boundary = firstUsed;
  const up = alignUp(firstUsed - body.start, 8);
  if (up !== undefined && up !== firstUsed - body.start) boundary = body.start + up - 8;

  const nodes: UEFINode[] = [];
  if (boundary > start) {
    nodes.push(
      makeSpan({
        kind: "freeSpace",
        name: "Free space",
        range: { start, end: boundary },
        isErased: true,
      })
    );
  }
  nodes.push(nonUEFIData(parser, { start: boundary, end }, emptyByte, depth));
  return nodes;
}

/**
 * Bytes inside a volume that are not files. Searched all the same: vendors put
 * whole volumes and runs of microcode in the space after a volume's files, and
 * leaving it as one opaque block would hide them.
 */
export function nonUEFIData(
  parser: Parser,
  range: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode {
  const node = makeSpan({
    kind: "nonUEFIData",
    name: "Non-UEFI data",
    range,
    isErased: parser.reader.isFilled(range, emptyByte),
  });
  if (!node.isErased && depth < parser.limits.maxDepth) {
    const found = scanRawArea(parser, range, emptyByte, depth + 1);
    // Nothing but padding means the search found nothing, and a single padding
    // child that repeats its parent is noise.
    if (found.some((child) => child.kind !== "padding")) node.children = found;
  }
  return node;
}
