import type { ImageRange } from "@/firmware/imageReader";
import { parseCapsule } from "@/firmware/uefi/capsuleParser";
import { hasDescriptorSignature, parseIntelImage } from "@/firmware/uefi/descriptorParser";
import { Microcode, parseMicrocode } from "@/firmware/uefi/microcodeParser";
import { DEFAULT_EMPTY_BYTE, type Parser } from "@/firmware/uefi/parserState";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { FV, parseVolume } from "@/firmware/uefi/volumeParser";

/**
 * What kind of thing this is: an update capsule, a full flash dump with an
 * Intel descriptor, or — the common case for a dump off a chip — bytes to be
 * searched for anything recognisable.
 *
 * Called again for a capsule's body, because what is inside an envelope is one
 * of the same three things.
 */
export function parseTopLevel(parser: Parser, range: ImageRange, depth: number): UEFINode[] {
  if (depth >= parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, range.start);
    return [];
  }

  let top: UEFINode[];
  const capsule = parseCapsule(parser, { offset: range.start, limit: range.end, depth });
  if (capsule !== undefined) {
    // A capsule claiming less than the file holds has something after it; the
    // trailing bytes stay as padding beside it.
    top = [capsule, ...parser.padding(nodeRange(capsule).end, range.end, DEFAULT_EMPTY_BYTE)];
  } else if (hasDescriptorSignature(parser, range.start)) {
    // The signature is checked at `0x10` as well as at `0x00`: the first
    // sixteen bytes are a reserved vector, `0xFF` on x86 and a real ARM reset
    // vector on some ARM images. An Intel image is already the one node over
    // the whole file, so it is returned as is.
    return parseIntelImage(parser, range, depth);
  } else {
    // Everything else — a lone volume off a chip, an NVRAM blob, bytes to be
    // searched — is a raw-area scan, and the scan decides the top of the tree.
    top = scanRawArea(parser, range, DEFAULT_EMPTY_BYTE, depth);
  }

  // The tree has one root. Several things at the top are a file that is more
  // than one image — a run of microcode with padding around it, a capsule with
  // bytes after it — and are grouped under the UEFI image node UEFITool always
  // shows as its root; the single thing a parse found is already a root of its
  // own, and is not wrapped in an image it is not.
  if (top.length <= 1) return top;
  return [
    makeNode({
      kind: "uefiImage",
      subtype: Sub.uefiImage,
      name: "UEFI image",
      header: { start: range.start, end: range.start },
      body: range,
      isFixed: true,
      children: top,
    }),
  ];
}

/**
 * Linear search for the structures that announce themselves.
 *
 * A BIOS region, the body of a padding element and an image with no flash
 * descriptor are all read the same way: walk the bytes looking for a signature,
 * and call everything in between padding. Byte by byte, not dword by dword —
 * nothing here guarantees a volume starts on a multiple of four, and images
 * where one does not are common enough that the reference parser gave up on the
 * shortcut too.
 */
export function scanRawArea(
  parser: Parser,
  range: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode[] {
  if (!parser.reader.has(range) || range.end - range.start < 4) {
    parser.progressed(range.end);
    return parser.padding(range.start, range.end, emptyByte);
  }
  const nodes: UEFINode[] = [];
  let claimed = range.start;
  let offset = range.start;
  const window = 1 << 20;

  scan: while (offset + 4 <= range.end) {
    // One report per window, on the byte the window starts at: parsing is
    // mostly this scan, so how much of the image it has crossed is how much of
    // the work is done. The report goes out before the window is searched
    // rather than after — it says "reached here", and a caller drawing a bar
    // wants it filled as the scan travels.
    parser.progressed(offset);
    const end = Math.min(offset + window, range.end);
    const bytes = parser.reader.bytes({ start: offset, end });
    if (bytes === undefined) break;
    let index = 0;
    while (index + 4 <= bytes.length) {
      const dword =
        ((bytes[index] ?? 0) |
          ((bytes[index + 1] ?? 0) << 8) |
          ((bytes[index + 2] ?? 0) << 16) |
          ((bytes[index + 3] ?? 0) << 24)) >>>
        0;
      const at = offset + index;
      const found = elementAtSignature(parser, dword, at, range, depth);
      if (found !== undefined) {
        nodes.push(...parser.padding(claimed, nodeRange(found).start, emptyByte));
        nodes.push(found);
        claimed = nodeRange(found).end;
        offset = claimed;
        continue scan;
      }
      index += 1;
    }
    if (end === range.end) break;
    offset = end - 3; // so a signature straddling the window is still seen
  }

  // Whatever the last window left: the tail after the last structure, or the
  // whole range when nothing was found at all. The scan has crossed the range
  // whether or not a signature announced itself.
  parser.progressed(range.end);
  nodes.push(...parser.padding(claimed, range.end, emptyByte));
  return nodes;
}

/**
 * A signature is a candidate, not a find: the four bytes turn up inside
 * compressed data all the time, and only a header that checks out makes an
 * element.
 *
 * Returning nothing here means "keep scanning", and it must leave no diagnostic
 * behind — a false candidate is not a defect in the image.
 */
function elementAtSignature(
  parser: Parser,
  dword: number,
  offset: number,
  range: ImageRange,
  depth: number
): UEFINode | undefined {
  if (dword === FV.signature) {
    if (offset < range.start + FV.signatureOffset) return undefined;
    return parseVolume(parser, {
      offset: offset - FV.signatureOffset,
      limit: range.end,
      depth,
    });
  }
  if (dword === Microcode.headerType) return parseMicrocode(parser, offset, range.end);
  return undefined;
}
