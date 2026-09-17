import type { ImageRange } from "@/firmware/imageReader";
import { sum8 } from "@/firmware/uefi/checksums";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

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

/** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap */
export const FlashDeviceMap = {
  /**
   * `HFDM`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.signature
   */
  signature: 0x4d44_4648,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.headerSize */
  headerSize: 0x1c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.checksumOffset */
  checksumOffset: 0x13,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.baseAddressOffset */
  baseAddressOffset: 0x14,
  /**
   * The one entry layout known: `INSYDE_FLASH_DEVICE_MAP_ENTRY`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.entrySize
   */
  entrySize: 0x54,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.entryFormat */
  entryFormat: 0,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.maxRevision */
  maxRevision: 4,
  /**
   * The region's hash is not checked.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.modifiable
   */
  modifiable: 0x1,
  /**
   * The entry is not valid — which UEFITool does not look at.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.ignored
   */
  ignored: 0x2,
  /**
   * Offsets inside an entry.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.regionOffsetOffset
   */
  regionOffsetOffset: 0x20,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.regionSizeOffset */
  regionSizeOffset: 0x28,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.attributesOffset */
  attributesOffset: 0x30,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/FlashDeviceMapParser.swift#FlashDeviceMap.hashOffset */
  hashOffset: 0x34,
} as const;

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
          name: (guid === undefined ? undefined : nameOfGuid(guid)) ?? "Flash device map entry",
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
