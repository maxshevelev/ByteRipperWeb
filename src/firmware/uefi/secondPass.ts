import { guidBytes, guidEquals } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { nameOfGuid, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import {
  flattened,
  isNodeCompressed,
  makeNode,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";

/**
 * `X86_RESET_VECTOR_DATA`, at fixed physical addresses inside the Volume Top
 * File.
 *
 * The last forty-eight bytes of the address space, which is where an x86 starts
 * executing. Worth reading because it is the one place that says, in the
 * image's own words, where it thinks it is loaded — and an image that disagrees
 * with itself here is an image somebody's tool has moved.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector
 */
export interface ResetVector {
  /**
   * Where the structure begins in the file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.offset
   */
  readonly offset: number;
  /**
   * Eight bytes at `0xFFFFFFD0`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.apEntryVector
   */
  readonly apEntryVector: Uint8Array;
  /**
   * `0xFFFFFFE0`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.peiCoreEntryPoint
   */
  readonly peiCoreEntryPoint: number;
  /**
   * Eight bytes at `0xFFFFFFF0` — the first instruction the processor runs.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.resetVector
   */
  readonly resetVector: Uint8Array;
  /**
   * `0xFFFFFFF8`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.apStartupSegment
   */
  readonly apStartupSegment: number;
  /**
   * `0xFFFFFFFC`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.bootFvBaseAddress
   */
  readonly bootFvBaseAddress: number;
}

/**
 * What EDK2 leaves in a field it did not fill in.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.placeholder
 */
export const RESET_VECTOR_PLACEHOLDER = 0x1234_5678;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.size */
export const RESET_VECTOR_SIZE = 0x30;
/**
 * The address the structure starts at.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.address
 */
export const RESET_VECTOR_ADDRESS = 0xffff_ffd0;
/** One past the last addressable byte. */
const ADDRESS_SPACE = 0x1_0000_0000;

/**
 * Whether a field holds an address at all, as opposed to the placeholder EDK2
 * leaves behind or an erased word. A caller following one of these without
 * asking ends up somewhere that was never meant to be anywhere.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#ResetVector.isFilledIn
 */
export function isFilledIn(field: number): boolean {
  return field !== RESET_VECTOR_PLACEHOLDER && field !== 0 && field !== 0xffff_ffff;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.SecondPass */
export interface SecondPass {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.SecondPass.addressDiff */
  readonly addressDiff: number | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.SecondPass.resetVector */
  readonly resetVector: ResetVector | undefined;
}

/**
 * Everything that needs an address rather than an offset.
 *
 * It can only run once the tree exists, because the one thing that ties this
 * image to an address is a node the first pass has to find: the last Volume Top
 * File, whose final byte is mapped at `0xFFFFFFFF`. Without it every address in
 * the image is unknowable, and the honest answer is to say so rather than to
 * assume the image is a full flash dump.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.runSecondPass
 */
export function runSecondPass(parser: Parser, roots: UEFINode[]): SecondPass {
  // No VTF is not a defect: a dump of one BIOS region, or of an EC, has none,
  // and `addressDiff` staying absent is the whole of what that means.
  const vtf = lastVolumeTopFile(roots);
  if (vtf === undefined) return { addressDiff: undefined, resetVector: undefined };
  const second = secondPassAnchoredOn(parser, vtf);
  // The VTF is the anchor for every address in the image, so moving it moves
  // everything.
  if (second.addressDiff !== undefined) markFixed(roots, nodeRange(vtf).start);
  return second;
}

/**
 * The mapping a given Volume Top File fixes, and what can be read with it.
 *
 * Separated from finding one because there are two ways to find one — the walk
 * above, and the tail look below.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.secondPass
 */
export function secondPassAnchoredOn(parser: Parser, vtf: UEFINode): SecondPass {
  const top = nodeRange(vtf).end;
  if (top > ADDRESS_SPACE) {
    parser.note({ kind: "addressesUnknown" }, nodeRange(vtf).start);
    return { addressDiff: undefined, resetVector: undefined };
  }
  const addressDiff = ADDRESS_SPACE - top;
  return { addressDiff, resetVector: readResetVector(parser, addressDiff, vtf) };
}

/**
 * The Volume Top File found where the format says it has to be, rather than by
 * walking to it.
 *
 * Its last byte is the last byte of the address space, so an image mapped flush
 * to the top of it ends *with* the VTF. Looking for the file's GUID in the last
 * few tens of kilobytes is a couple of reads; walking to it means scanning the
 * whole BIOS region for volume signatures and then walking the last volume's
 * files, which upstream measured at half a second on a 24 MiB dump — and every
 * panel that wants an address waits for it.
 *
 * Nothing when the tail holds no VTF whose size lands it exactly at the end: an
 * image mapped some other way, a region cut out of one, a dump with bytes
 * appended. The caller then walks, and gets the same answer the slow way.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.volumeTopFileInTail
 */
export function volumeTopFileInTail(parser: Parser, window = 0x10000): UEFINode | undefined {
  const count = parser.reader.count;
  if (count <= FFS.headerSize) return undefined;
  const start = count > window ? count - window : 0;
  const bytes = parser.reader.bytes({ start, end: count });
  if (bytes === undefined) return undefined;

  const wanted = guidBytes(VOLUME_TOP_FILE);
  let found: UEFINode | undefined;
  for (let index = 0; index + wanted.length <= bytes.length; index++) {
    let matches = true;
    for (let at = 0; at < wanted.length; at++) {
      if (bytes[index + at] !== wanted[at]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const header = start + index;
    // The size field of the FFS header this GUID would be the name of. It has
    // to land the file's last byte on the image's.
    const size = parser.reader.uint24(header + 0x14);
    if (size === undefined || size <= FFS.headerSize || header + size !== count) continue;
    found = makeNode({
      kind: "file",
      name: nameOfGuid(VOLUME_TOP_FILE) ?? "Volume Top File",
      guid: VOLUME_TOP_FILE,
      header: { start: header, end: header + FFS.headerSize },
      body: { start: header + FFS.headerSize, end: count },
      isFixed: true,
    });
  }
  return found;
}

/**
 * The *last* one: an image can hold several, and only the last is at the top of
 * the address space. A compressed one is no use — its address is wherever the
 * decompressor put it.
 */
function lastVolumeTopFile(roots: readonly UEFINode[]): UEFINode | undefined {
  let best: UEFINode | undefined;
  for (const root of roots) {
    for (const node of flattened(root)) {
      if (node.kind !== "file" || isNodeCompressed(node)) continue;
      if (node.guid === undefined || !guidEquals(node.guid, VOLUME_TOP_FILE)) continue;
      if (best === undefined || nodeRange(best).end < nodeRange(node).end) best = node;
    }
  }
  return best;
}

function readResetVector(
  parser: Parser,
  addressDiff: number,
  vtf: UEFINode
): ResetVector | undefined {
  const offset = RESET_VECTOR_ADDRESS - addressDiff;
  const range = nodeRange(vtf);
  // Inside the VTF, or it is not this image's reset vector.
  const apEntryVector = parser.reader.bytesAt(offset, 8);
  const peiCoreEntryPoint = parser.reader.uint32(offset + 0x10);
  const resetVector = parser.reader.bytesAt(offset + 0x20, 8);
  const apStartupSegment = parser.reader.uint32(offset + 0x28);
  const bootFvBaseAddress = parser.reader.uint32(offset + 0x2c);
  if (
    offset < range.start ||
    offset + RESET_VECTOR_SIZE > range.end ||
    apEntryVector === undefined ||
    peiCoreEntryPoint === undefined ||
    resetVector === undefined ||
    apStartupSegment === undefined ||
    bootFvBaseAddress === undefined
  ) {
    parser.note({ kind: "truncated", structure: "resetVector" }, range.start);
    return undefined;
  }
  return {
    offset,
    apEntryVector,
    peiCoreEntryPoint,
    resetVector,
    apStartupSegment,
    bootFvBaseAddress,
  };
}

/**
 * Marks the node starting at `offset`, wherever it is in the tree. By offset
 * and not by id, because ids are stamped only once the tree is finished and the
 * second pass runs before that.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/SecondPass.swift#Parser.markFixed
 */
export function markFixed(nodes: UEFINode[], offset: number): void {
  for (const node of nodes) {
    const range = nodeRange(node);
    if (range.start === offset) {
      node.isFixed = true;
      return;
    }
    if (offset >= range.start && offset < range.end) {
      markFixed(node.children, offset);
      return;
    }
  }
}
