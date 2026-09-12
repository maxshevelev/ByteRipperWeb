import type { ImageRange } from "@/firmware/imageReader";
import { type EFIGUID, guid, guidEquals } from "@/firmware/uefi/efiGuid";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The stores an NVRAM volume's body is read as.
 *
 * An NVRAM volume is not FFS: its body is a run of stores, each announcing
 * itself with a signature or a GUID, with free space and padding between them.
 * The walk below is upstream's, and the store recognisers it calls are the
 * largest single file in that package — they land in their own commit. Until
 * then this walk finds no stores, which is exactly what upstream's does for a
 * volume whose stores it does not recognise: the body comes out as free space
 * and padding, which is honest rather than wrong.
 */

/** NVRAM_MAIN_STORE_VOLUME_GUID. */
export const NVRAM_MAIN_STORE_VOLUME = guid("FFF12B8D-7696-4C8B-A985-2747075B4F50");
/** NVRAM_ADDITIONAL_STORE_VOLUME_GUID. */
export const NVRAM_ADDITIONAL_STORE_VOLUME = guid("00504624-8A59-4EEB-BD0F-6B36E96128E0");

/** Whether a volume's file-system GUID says its body is a run of stores. */
export function isStoreVolume(candidate: EFIGUID): boolean {
  return (
    guidEquals(candidate, NVRAM_MAIN_STORE_VOLUME) ||
    guidEquals(candidate, NVRAM_ADDITIONAL_STORE_VOLUME)
  );
}

/**
 * The body of an NVRAM volume, or nothing when this volume is not one.
 *
 * The recursion budget is the parser's own: a store can wrap another volume
 * body, which can wrap another. The bound is inclusive because the volume
 * parser already spends the level below `maxDepth` on this body.
 */
export function walkNvramVolumeBody(
  parser: Parser,
  fileSystem: EFIGUID,
  body: ImageRange,
  emptyByte: number,
  depth: number
): UEFINode[] | undefined {
  if (!isStoreVolume(fileSystem)) return undefined;
  if (depth > parser.limits.maxDepth) {
    parser.note({ kind: "recursionLimit" }, body.start);
    return [];
  }

  const nodes: UEFINode[] = [];
  let paddingStart = body.start;
  let storeOffset = body.start;

  while (storeOffset < body.end) {
    // Free space is a run of the erase byte, and no store starts with the erase
    // byte, so a whole run is jumped in one step instead of paying a recogniser
    // probe for every erased byte. Real NVRAM volumes end in hundreds of
    // kilobytes of free space; stepping it byte by byte would try every
    // recogniser at each one — and the last of them a full volume-header read.
    if (parser.reader.uint8(storeOffset) === emptyByte) {
      storeOffset =
        parser.reader.firstOffsetNotEqualTo({ start: storeOffset, end: body.end }, emptyByte) ??
        body.end;
      continue;
    }
    // The store recognisers go here, in the order the reference parser tries
    // them: first match wins. With none of them yet, every byte that is not the
    // erase byte belongs to the padding run that started where the last store
    // ended.
    storeOffset += 1;
  }
  nodes.push(...nvramPadding(parser, paddingStart, body.end, emptyByte));
  paddingStart = body.end;
  return nodes;
}

/**
 * A run of bytes between NVRAM stores. All the erase byte is free space;
 * anything in it is padding somebody put there.
 */
function nvramPadding(parser: Parser, start: number, end: number, emptyByte: number): UEFINode[] {
  if (start >= end) return [];
  const range: ImageRange = { start, end };
  if (parser.reader.isFilled(range, emptyByte)) {
    return [makeSpan({ kind: "freeSpace", name: "Free space", range, isErased: true })];
  }
  return [makeSpan({ kind: "padding", name: "Padding", range, isErased: false })];
}
