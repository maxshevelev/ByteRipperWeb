import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum8 } from "@/firmware/uefi/checksums";
import { type EFIGUID, guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap, regionTypeName } from "@/firmware/uefi/flashDeviceMapFormat";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import { walkStores } from "@/firmware/uefi/nvramParser";
import type { Parser } from "@/firmware/uefi/parserState";
import { addressDiffFromTail } from "@/firmware/uefi/secondPass";
import { makeNode, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * `INSYDE_FLASH_DEVICE_MAP_HEADER` and its entries.
 *
 * An Insyde H2O flash device map is not an FFS file: it is a store the raw-area
 * scan finds by its signature, the way a volume or a microcode is found. What it
 * holds is a list of regions with their digests — the ranges the firmware checks
 * at boot.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift`.
 */

/**
 * One entry of a map, as the firmware reads it: where its region is in the
 * address space and how long it is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry
 */
export interface FlashDeviceMapEntry {
  /**
   * Where the entry itself is in the file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.offset
   */
  readonly offset: number;
  /**
   * The region's type, the entry's first GUID.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.type
   */
  readonly type: EFIGUID;
  /**
   * `FdBaseAddress + RegionOffset`, in 32 bits as the reference computes it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.address
   */
  readonly address: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.size */
  readonly size: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.attributes */
  readonly attributes: number;
}

/**
 * Where the entry's region is in the file, given the image's mapping. Nothing
 * when the address lies below the image.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.Entry.range
 */
export function flashDeviceMapEntryRange(
  entry: FlashDeviceMapEntry,
  addressDiff: number
): ImageRange | undefined {
  if (entry.address < addressDiff) return undefined;
  const start = entry.address - addressDiff;
  return { start, end: start + entry.size };
}

/**
 * Every entry of the map `store` heads, in the order it lists them. Empty for a
 * store whose entry layout is not the known one: its node has no entry rows
 * then.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.entries
 */
export function flashDeviceMapEntries(store: UEFINode, reader: ImageReader): FlashDeviceMapEntry[] {
  if (store.kind !== "flashDeviceMapStore") return [];
  const base = reader.uint64(store.header.start + FlashDeviceMap.baseAddressOffset);
  if (base === undefined) return [];
  const found: FlashDeviceMapEntry[] = [];
  for (const entry of store.children) {
    const at = entry.header.start;
    if (entry.kind !== "flashDeviceMapEntry" || entry.guid === undefined) continue;
    const offset = reader.uint64(at + FlashDeviceMap.regionOffsetOffset);
    const size = reader.uint64(at + FlashDeviceMap.regionSizeOffset);
    const attributes = reader.uint32(at + FlashDeviceMap.attributesOffset);
    if (offset === undefined || size === undefined || attributes === undefined) continue;
    found.push({
      offset: at,
      type: entry.guid,
      // The same arithmetic the protected ranges use: 32 bits, as the reference
      // does.
      address: ((base >>> 0) + (offset >>> 0)) >>> 0,
      size: size >>> 0,
      attributes,
    });
  }
  return found;
}

/**
 * A store the raw-area scan found by its signature. Nothing when the header does
 * not hold together — a size that does not fit what is left of the area, a data
 * offset outside it — which is the scan's cue to keep looking and no defect.
 *
 * The whole store is fixed: it is rebuilt in place whatever its entries say.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#Parser.parseFlashDeviceMap
 */
export function parseFlashDeviceMap(
  parser: Parser,
  offset: number,
  limit: number
): UEFINode | undefined {
  const size = parser.reader.uint32(offset + 4);
  const dataOffset = parser.reader.uint32(offset + 8);
  const entrySize = parser.reader.uint32(offset + 0x0c);
  const format = parser.reader.uint8(offset + 0x10);
  const revision = parser.reader.uint8(offset + 0x11);
  if (
    size === undefined ||
    dataOffset === undefined ||
    entrySize === undefined ||
    format === undefined ||
    revision === undefined ||
    size < FlashDeviceMap.headerSize ||
    offset + size > limit ||
    dataOffset < FlashDeviceMap.headerSize ||
    dataOffset > size
  ) {
    return undefined;
  }
  if (revision > FlashDeviceMap.maxRevision) {
    parser.note({ kind: "unknownRevision", structure: "flashDeviceMap", revision }, offset + 0x11);
    return undefined;
  }

  // Reported, not required.
  const header = parser.reader.bytes({ start: offset, end: offset + FlashDeviceMap.headerSize });
  if (header !== undefined) {
    const stored = header[FlashDeviceMap.checksumOffset] ?? 0;
    const zeroed = Uint8Array.from(header);
    zeroed[FlashDeviceMap.checksumOffset] = 0;
    const computed = (0x100 - sum8(zeroed)) & 0xff;
    if (computed !== stored) {
      parser.note(
        { kind: "checksumMismatch", structure: "flashDeviceMap", stored, computed },
        offset + FlashDeviceMap.checksumOffset
      );
    }
  }

  const end = offset + size;
  const body: ImageRange = { start: offset + dataOffset, end };
  const entries: UEFINode[] = [];
  if (entrySize === FlashDeviceMap.entrySize && format === FlashDeviceMap.entryFormat) {
    for (let entry = body.start; entry + entrySize <= end; entry += entrySize) {
      const guid = parser.reader.guid(entry);
      entries.push(
        makeNode({
          kind: "flashDeviceMapEntry",
          name:
            (guid === undefined ? undefined : (regionTypeName(guid) ?? nameOfGuid(guid))) ??
            "Flash device map entry",
          guid,
          header: { start: entry, end: entry + entrySize },
          body: { start: entry + entrySize, end: entry + entrySize },
        })
      );
    }
  } else {
    // A layout nobody has described: the store stays a leaf.
    parser.note({ kind: "unknownFlashDeviceMapEntries", size: entrySize, format }, offset + 0x0c);
  }

  return makeNode({
    kind: "flashDeviceMapStore",
    name: "Insyde flash device map",
    header: { start: offset, end: body.start },
    body,
    isFixed: true,
    children: entries,
  });
}

/**
 * `nodes` — what a raw-area scan found — with the regions its flash device maps
 * name read out of the padding (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * Insyde's map lays out the whole image, and some of what it names sits outside
 * every volume with no signature of its own: the EC firmware, the BIOS version
 * table, the SMBIOS update, the passwords, the default variables. The scan reads
 * those bytes as padding, and so does UEFITool. Each such range that lies wholly
 * inside a stretch of padding becomes a region named by its type, and the padding
 * around it stays padding. Nothing is searched for: a region is only where the
 * map puts one, and a range already read as something else — a volume, the NVRAM
 * stores — is left to what read it.
 *
 * A `VAR_DEFAULT` region holds a run of `$VSS` stores — the firmware's default
 * variables — and is walked the way an NVRAM volume's body is. The other regions
 * are leaves: what is inside them is read, where it is read at all, by the
 * region's own type.
 *
 * The map gives physical addresses, and this runs before the second pass has
 * worked out the mapping — so it takes it from a Volume Top File at the image's
 * tail, as address resolution does first. An image with no VTF at its tail — a
 * BIOS region followed by another region — keeps the ranges as padding.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#Parser.readingMapRegions
 */
export function readingMapRegions(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number,
  depth: number
): UEFINode[] {
  const maps = nodes.filter((node) => node.kind === "flashDeviceMapStore");
  if (maps.length === 0) return [...nodes];
  const addressDiff = addressDiffFromTail(parser);
  if (addressDiff === undefined) return [...nodes];

  const regions: { readonly type: EFIGUID; readonly range: ImageRange }[] = [];
  for (const map of maps) {
    for (const entry of flashDeviceMapEntries(map, parser.reader)) {
      const range = flashDeviceMapEntryRange(entry, addressDiff);
      if (range === undefined) continue;
      // A board can carry the map twice, and both copies name the same ranges.
      const type = entry.type;
      if (
        range.end > range.start &&
        !regions.some(
          (one) =>
            guidEquals(one.type, type) &&
            one.range.start === range.start &&
            one.range.end === range.end
        )
      ) {
        regions.push({ type, range });
      }
    }
  }
  // In address order, so where two entries overlap the one that starts first is
  // placed and the other, no longer inside padding, stays out.
  regions.sort((left, right) => left.range.start - right.range.start);

  const result = [...nodes];
  for (const region of regions) {
    const index = result.findIndex((node) => {
      const around = nodeRange(node);
      return (
        node.kind === "padding" &&
        around.start <= region.range.start &&
        region.range.end <= around.end
      );
    });
    if (index < 0) continue;
    let children: UEFINode[] = [];
    if (guidEquals(region.type, FlashDeviceMap.variableDefaults)) {
      const stores = walkStores(parser, region.range, emptyByte, depth + 1);
      // A region nobody has written holds no stores, and says so by having no
      // children.
      if (stores.some((node) => node.kind !== "padding" && node.kind !== "freeSpace")) {
        children = stores;
      }
    }
    const around = nodeRange(result[index] as UEFINode);
    result.splice(
      index,
      1,
      ...parser.padding(around.start, region.range.start, emptyByte),
      makeNode({
        kind: "flashDeviceMapRegion",
        name: regionTypeName(region.type) ?? nameOfGuid(region.type) ?? "Flash device map region",
        guid: region.type,
        header: { start: region.range.start, end: region.range.start },
        body: region.range,
        // The map pins it: it is where the map says, or the firmware does not
        // find it.
        isFixed: true,
        isErased: children.length === 0 && parser.reader.isFilled(region.range, emptyByte),
        children,
      }),
      ...parser.padding(region.range.end, around.end, emptyByte)
    );
  }
  return result;
}
