import type { ImageRange } from "@/firmware/imageReader";
import { readingAMDMicrocode } from "@/firmware/uefi/amdMicrocode";
import { parseCapsule } from "@/firmware/uefi/capsuleParser";
import { hasDescriptorSignature, parseIntelImage } from "@/firmware/uefi/descriptorParser";
import { DVAR, parseDvarStore } from "@/firmware/uefi/dvarParser";
import { readingECFirmwareIn } from "@/firmware/uefi/ecFirmware";
import { readingFITComponents } from "@/firmware/uefi/fitComponents";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import { parseFlashDeviceMap, readingMapRegions } from "@/firmware/uefi/flashDeviceMapParser";
import { readingHPSignatureBlocks } from "@/firmware/uefi/hpSignatureBlock";
import { Microcode, parseMicrocode } from "@/firmware/uefi/microcodeParser";
import { DEFAULT_EMPTY_BYTE, type Parser } from "@/firmware/uefi/parserState";
import { opensPicture, PICTURE_SIGNATURES, parsePicture } from "@/firmware/uefi/picture";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { FV } from "@/firmware/uefi/volumeFormat";
import { parseVolume } from "@/firmware/uefi/volumeParser";

/**
 * What kind of thing this is: an update capsule, a full flash dump with an
 * Intel descriptor, or — the common case for a dump off a chip — bytes to be
 * searched for anything recognisable.
 *
 * Called again for a capsule's body, because what is inside an envelope is one
 * of the same three things.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#Parser.parseTopLevel
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
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIParser.swift#Parser.scanRawArea
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
    // Candidates are found with the platform's own byte search rather than by
    // stepping: `indexOf` on a typed array is native and vectorised, and this
    // loop would otherwise run once per byte of the image. Each signature is
    // looked for by its rarest fixed byte and confirmed with three more reads,
    // so a 16 MB raw area costs two native passes and a few thousand checks
    // instead of sixteen million.
    //
    // The two searches are merged rather than run one after the other: a
    // structure claims the bytes after it, so candidates have to be considered
    // in the order they lie in the file.
    const limit = bytes.length - 4;
    /**
     * The next candidate position at or after `from`, by `search`'s byte: where the
     * dword the signature is read as would start, or -1.
     */
    const next = (search: Search, from: number): number => {
      const raw = bytes.indexOf(search.byte, from + search.before);
      const position = raw - search.before;
      return raw < 0 || position > limit ? -1 : position;
    };
    const at = SEARCHES.map((search) => next(search, 0));

    for (;;) {
      // The searches are considered together rather than one after the other: a
      // structure claims the bytes after it, so candidates have to be taken in the
      // order they lie in the file.
      let which = -1;
      for (let candidate = 0; candidate < at.length; candidate++) {
        const found = at[candidate] ?? -1;
        if (found < 0) continue;
        if (which < 0 || found < (at[which] ?? 0)) which = candidate;
      }
      if (which < 0) break;
      const index = at[which] ?? 0;

      const dword =
        ((bytes[index] ?? 0) |
          ((bytes[index + 1] ?? 0) << 8) |
          ((bytes[index + 2] ?? 0) << 16) |
          ((bytes[index + 3] ?? 0) << 24)) >>>
        0;
      if (
        dword === FV.signature ||
        dword === Microcode.headerType ||
        dword === FlashDeviceMap.signature ||
        dword === DVAR.signature ||
        opensPicture(dword)
      ) {
        const found = elementAtSignature(parser, dword, offset + index, range, emptyByte, depth);
        if (found !== undefined) {
          nodes.push(...parser.padding(claimed, nodeRange(found).start, emptyByte));
          nodes.push(found);
          claimed = nodeRange(found).end;
          offset = claimed;
          continue scan;
        }
      }
      at[which] = next(SEARCHES[which] as Search, index + 1);
    }

    if (end === range.end) break;
    offset = end - 3; // so a signature straddling the window is still seen
  }

  // Whatever the last window left: the tail after the last structure, or the
  // whole range when nothing was found at all. The scan has crossed the range
  // whether or not a signature announced itself.
  parser.progressed(range.end);
  nodes.push(...parser.padding(claimed, range.end, emptyByte));
  // What tables elsewhere name, then what announces itself only in padding — each read
  // into the padding as rows of its own.
  let read = readingMapRegions(parser, nodes, emptyByte, depth);
  read = readingFITComponents(parser, read, emptyByte);
  read = readingECFirmwareIn(parser, read, emptyByte);
  read = readingHPSignatureBlocks(parser, read, emptyByte);
  return readingAMDMicrocode(parser, read, emptyByte);
}

/**
 * One native byte search: the byte, and how many bytes before it the signature's
 * dword starts. A signature is looked for by its rarest fixed byte.
 */
interface Search {
  readonly byte: number;
  readonly before: number;
}

/**
 * The structures that announce themselves, each by one byte:
 *
 * - `_` of `_FVH`, `0x01` of a microcode header's `HeaderType` and `H` of the flash
 *   device map's `HFDM`, and the `V` of Dell's `DVAR`;
 * - a JPEG opens `FF D8 FF`, and `FF` is what an erased chip is made of, so it is
 *   found by the `D8` after it;
 * - a PNG by its `0x89`, a GIF by its `G`, a BMP by its `B` — and the opening of
 *   each is checked on the bytes around before anything is read.
 */
const SEARCHES: readonly Search[] = [
  { byte: FV.signature & 0xff, before: 0 },
  { byte: Microcode.headerType & 0xff, before: 0 },
  { byte: FlashDeviceMap.signature & 0xff, before: 0 },
  // `DVAR`'s second byte, `V`.
  { byte: (DVAR.signature >>> 8) & 0xff, before: 1 },
  { byte: 0xd8, before: 1 },
  { byte: PICTURE_SIGNATURES.png & 0xff, before: 0 },
  { byte: PICTURE_SIGNATURES.gif & 0xff, before: 0 },
  { byte: PICTURE_SIGNATURES.bmp & 0xff, before: 0 },
];

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
  emptyByte: number,
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
  if (dword === FlashDeviceMap.signature) return parseFlashDeviceMap(parser, offset, range.end);
  if (dword === DVAR.signature) return parseDvarStore(parser, offset, range.end, emptyByte);
  // A picture announces itself in a dword, a BMP in two bytes, and its header has
  // to check out field by field before it is one.
  if (opensPicture(dword)) return parsePicture(parser, offset, range.end);
  return undefined;
}
