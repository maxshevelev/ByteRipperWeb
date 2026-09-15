import type { ImageRange } from "@/firmware/imageReader";
import { DEFAULT_EMPTY_BYTE, type Parser } from "@/firmware/uefi/parserState";
import { scanRawArea } from "@/firmware/uefi/rawScan";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * The Intel flash descriptor: the first `0x1000` bytes of a full SPI dump, and
 * the map of everything else in it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor
 */
export const Descriptor = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.signature */
  signature: 0x0ff0_a55a,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.size */
  size: 0x1000,
  /**
   * `FLASH_DESCRIPTOR_MAP`, straight after the header.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.mapOffset
   */
  mapOffset: 0x14,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.versionOffset */
  versionOffset: 0x20,
  /**
   * Every `*Base` field holds bits [11:4] of a real offset, so the real one is
   * `base << 4` and anything above this is a broken descriptor.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.maxBase
   */
  maxBase: 0xe0,
  /**
   * `0xFFFFFFFF` in the version field means the field is reserved, which means
   * a version 1 descriptor — and those have five regions, not sixteen.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.reservedVersion
   */
  reservedVersion: 0xffff_ffff,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Descriptor.version1RegionCount */
  version1RegionCount: 5,
} as const;

/**
 * The regions a descriptor can describe, in the order their base/limit pairs
 * appear in the region section. The order is the format's, not ours.
 */
export const FLASH_REGIONS = [
  "descriptor",
  "bios",
  "me",
  "gbe",
  "pdr",
  "devExp1",
  "bios2",
  "microcode",
  "ec",
  "devExp2",
  "ie",
  "tgbe1",
  "tgbe2",
  "reserved1",
  "reserved2",
  "ptt",
] as const;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#FlashRegionType */
export type FlashRegionType = (typeof FLASH_REGIONS)[number];

const REGION_LABELS: Readonly<Record<FlashRegionType, string>> = {
  descriptor: "Descriptor region",
  bios: "BIOS region",
  me: "ME region",
  gbe: "GbE region",
  pdr: "PDR region",
  devExp1: "Device expansion 1 region",
  bios2: "Secondary BIOS region",
  microcode: "Microcode region",
  ec: "EC region",
  devExp2: "Device expansion 2 region",
  ie: "IE region",
  tgbe1: "10GbE 1 region",
  tgbe2: "10GbE 2 region",
  reserved1: "Reserved region 1",
  reserved2: "Reserved region 2",
  ptt: "PTT region",
};

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#FlashRegionType.label */
export function regionLabel(type: FlashRegionType): string {
  return REGION_LABELS[type];
}

/**
 * Which regions are read further. A BIOS region is volumes and padding, a
 * microcode region is microcode images; ME, GbE and the rest are formats of
 * their own and are kept whole.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#FlashRegionType.readsAsRawArea
 */
export function readsAsRawArea(type: FlashRegionType): boolean {
  return type === "bios" || type === "bios2" || type === "devExp1" || type === "microcode";
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Parser.hasDescriptorSignature */
export function hasDescriptorSignature(parser: Parser, offset: number): boolean {
  return (
    parser.reader.uint32(offset) === Descriptor.signature ||
    parser.reader.uint32(offset + 0x10) === Descriptor.signature
  );
}

/**
 * An Intel image is one node over the whole image — a descriptor and the
 * regions it maps, laid out in offset order with the gaps kept.
 *
 * The wrapping node is the root UEFITool shows as `Image/Intel`: its body is
 * the whole file, and everything a descriptor describes sits under it rather
 * than beside it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Parser.parseIntelImage
 */
export function parseIntelImage(parser: Parser, range: ImageRange, depth: number): UEFINode[] {
  return [
    makeNode({
      kind: "intelImage",
      subtype: Sub.intelImage,
      name: "Intel image",
      header: { start: range.start, end: range.start },
      body: range,
      isFixed: true,
      children: intelImageChildren(parser, range, depth),
    }),
  ];
}

interface Region {
  readonly type: FlashRegionType;
  readonly range: ImageRange;
}

/**
 * What an Intel image contains: the descriptor region, the regions the map
 * names, and the padding that fills the gaps between them.
 */
function intelImageChildren(parser: Parser, range: ImageRange, depth: number): UEFINode[] {
  const base = range.start;
  const regions = readRegions(parser, base, range.end);
  if (regions.length === 0) {
    parser.note({ kind: "truncated", structure: "flashDescriptor" }, base + Descriptor.mapOffset);
    const end = Math.min(base + Descriptor.size, range.end);
    return [
      descriptorNode({ start: base, end }),
      ...scanRawArea(parser, { start: end, end: range.end }, DEFAULT_EMPTY_BYTE, depth),
    ];
  }

  const nodes: UEFINode[] = [];
  let claimed = base;
  for (const region of [...regions].sort((left, right) => left.range.start - right.range.start)) {
    // Regions that run into each other mean a descriptor nobody can trust; the
    // first one keeps the bytes and the second is dropped rather than drawn on
    // top of it.
    if (region.range.start < claimed) {
      parser.note({ kind: "overlappingRegions" }, region.range.start);
      continue;
    }
    nodes.push(...parser.padding(claimed, region.range.start, DEFAULT_EMPTY_BYTE));
    nodes.push(regionNode(region, depth));
    claimed = region.range.end;
  }
  nodes.push(...parser.padding(claimed, range.end, DEFAULT_EMPTY_BYTE));
  return nodes;
}

/**
 * The range `type` occupies in this image, straight from the descriptor's
 * region table — no raw-area scan, whether or not the region has ever been
 * expanded. This is what lets the ME analyser ask for the ME region's bytes
 * without either scanning the file itself or waiting for the BIOS region's own
 * volumes to be walked.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DescriptorParser.swift#Parser.flashRegionRange
 */
export function flashRegionRange(
  parser: Parser,
  type: FlashRegionType,
  base: number,
  limit: number
): ImageRange | undefined {
  return readRegions(parser, base, limit).find((region) => region.type === type)?.range;
}

/**
 * The region section, at `RegionBase << 4`. Empty when the descriptor's own map
 * cannot be believed — which the caller turns into a raw scan rather than into
 * nothing.
 */
function readRegions(parser: Parser, base: number, limit: number): Region[] {
  const map = parser.reader.uint32(base + Descriptor.mapOffset);
  const version = parser.reader.uint32(base + Descriptor.versionOffset);
  if (map === undefined || version === undefined) return [];

  const regionBase = (map >>> 16) & 0xff;
  if (regionBase === 0 || regionBase > Descriptor.maxBase) return [];
  const section = base + regionBase * 16;
  const count =
    version === Descriptor.reservedVersion ? Descriptor.version1RegionCount : FLASH_REGIONS.length;

  // The descriptor's own region is not read from the table: its base and limit
  // are both zero, which is the table's way of saying "absent". It is the first
  // `0x1000` bytes, always.
  const regions: Region[] = [
    { type: "descriptor", range: { start: base, end: Math.min(base + Descriptor.size, limit) } },
  ];
  for (let index = 1; index < count; index++) {
    const entry = section + index * 4;
    const type = FLASH_REGIONS[index];
    const first = parser.reader.uint16(entry);
    const last = parser.reader.uint16(entry + 2);
    if (type === undefined || first === undefined || last === undefined) break;
    // A region is absent when its limit is zero, and the base and limit hold
    // only the top sixteen bits of a 32-bit address.
    if (last === 0 || first > last) continue;
    const start = base + first * 0x1000;
    const end = base + (last * 0x1000 + 0xfff) + 1;
    if (start >= limit) {
      parser.note({ kind: "truncated", structure: "flashDescriptor" }, entry);
      continue;
    }
    if (end > limit) parser.note({ kind: "truncated", structure: "flashDescriptor" }, entry);
    regions.push({ type, range: { start, end: Math.min(end, limit) } });
  }
  return regions;
}

/**
 * A region as the descriptor lays it out, and nothing of what is inside it: the
 * linear signature scan of a BIOS region is one of the two genuinely expensive
 * things in this parser, so it is always left for the materialization to run
 * when something actually asks. A region that is a format of its own — ME, GbE
 * — is not expandable at all: it has no raw area to scan.
 */
function regionNode(region: Region, depth: number): UEFINode {
  if (region.type === "descriptor") return descriptorNode(region.range);
  return makeNode({
    kind: "region",
    subtype: FLASH_REGIONS.indexOf(region.type),
    name: regionLabel(region.type),
    header: { start: region.range.start, end: region.range.start },
    body: region.range,
    // Regions are laid out by the descriptor, and moving one means rewriting it.
    isFixed: true,
    isExpandable: readsAsRawArea(region.type),
    childDepth: depth + 1,
  });
}

function descriptorNode(range: ImageRange): UEFINode {
  const split = Math.min(range.start + Descriptor.mapOffset, range.end);
  return makeNode({
    kind: "flashDescriptor",
    subtype: FLASH_REGIONS.indexOf("descriptor"),
    name: regionLabel("descriptor"),
    header: { start: range.start, end: split },
    body: { start: split, end: range.end },
    isFixed: true,
  });
}
