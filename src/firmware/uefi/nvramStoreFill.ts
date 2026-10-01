import type { ImageReader } from "@/firmware/imageReader";
import { type EFIGUID, guidKey } from "@/firmware/uefi/efiGuid";
import { isAuthenticatedVss2Variable, NVRAM } from "@/firmware/uefi/nvramParser";
import type { UEFINode, UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * How full an NVRAM store is, and how much of it still counts
 * (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * A variable store is written by appending: a variable that changes gets a new
 * entry and the old one is marked, never overwritten in place, until the firmware
 * reclaims the store — copies what is current and erases the rest. So a store's
 * free space runs out long before its variables would fill it, and a store close
 * to full is a store close to a reclaim, which is where a power cut breaks
 * things. This counts what the parser already found: the bytes the free-space
 * nodes cover, and the entries by what their subtype says about them.
 *
 * Read off the node's children, so it is the same for every store format; an
 * NVAR store, which has no node of its own, is counted on the file, section or
 * entry whose body it is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill
 */
export interface NvramStoreFill {
  /**
   * The store's body: the room its entries are written into.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.size
   */
  readonly size: number;
  /**
   * Erased room the store can still write into.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.free
   */
  readonly free: number;
  /**
   * Entries whose value is the variable's value now.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.current
   */
  readonly current: number;
  /**
   * Entries a later one replaced: the earlier links of an NVAR chain, and a
   * marked entry whose variable — the same name and GUID — has a current entry in
   * the store.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.superseded
   */
  readonly superseded: number;
  /**
   * Marked entries of a variable the store no longer holds. A VSS store marks a
   * replaced entry and a deleted one alike; which of the two it was is told only
   * by whether the variable is still there. The tree names a marked VSS entry
   * `Invalid`, as UEFITool does, so its name is read here from where the variable
   * keeps it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.deleted
   */
  readonly deleted: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.used */
export const fillUsed = (fill: NvramStoreFill): number => fill.size - fill.free;

/**
 * The share of the store in use, in whole percent, rounded down — a store with
 * any room left never reads as 100.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.percentUsed
 */
export const fillPercentUsed = (fill: NvramStoreFill): number =>
  fill.size === 0 ? 0 : Math.floor((fillUsed(fill) * 100) / fill.size);

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.entryKinds */
const ENTRY_KINDS: ReadonlySet<UEFINodeKind> = new Set<UEFINodeKind>([
  "vssEntry",
  "sysFEntry",
  "evsaEntry",
  "nvarEntry",
]);

const isMarked = (entry: UEFINode): boolean =>
  entry.subtype === Sub.invalidNvarEntry ||
  entry.subtype === Sub.invalidLinkNvarEntry ||
  entry.subtype === Sub.invalidVssEntry ||
  entry.subtype === Sub.invalidSysFEntry ||
  entry.subtype === Sub.invalidEvsaEntry;

const keyOf = (name: string, guid: EFIGUID | undefined): string =>
  `${name}\u0000${guid === undefined ? "" : guidKey(guid)}`;

/**
 * The fill of the store `node` is, or nothing when it holds no entries. `reader`
 * reads the space the node is in.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.of
 */
export function nvramStoreFillOf(node: UEFINode, reader: ImageReader): NvramStoreFill | undefined {
  const entries = node.children.filter((child) => ENTRY_KINDS.has(child.kind));
  if (entries.length === 0) return undefined;
  const bodySize = node.body.end - node.body.start;
  const free = node.children
    .filter((child) => child.kind === "freeSpace")
    .reduce((sum, child) => sum + (child.body.end - child.body.start), 0);

  let current = 0;
  let superseded = 0;
  let deleted = 0;
  const live = new Set(
    entries
      .filter((entry) => !isMarked(entry) && entry.subtype !== Sub.linkNvarEntry)
      .map((entry) => keyOf(entry.name, entry.guid))
  );
  for (const entry of entries) {
    if (entry.subtype === Sub.linkNvarEntry) {
      superseded += 1;
    } else if (isMarked(entry)) {
      const name =
        entry.kind === "vssEntry"
          ? (variableName(entry, node.kind === "vss2Store", reader) ?? entry.name)
          : entry.name;
      if (name !== "" && live.has(keyOf(name, entry.guid))) superseded += 1;
      else deleted += 1;
    } else {
      current += 1;
    }
  }
  return { size: bodySize, free: Math.min(free, bodySize), current, superseded, deleted };
}

/**
 * A VSS variable's name: UCS-2 up to the first NUL. A `$VSS` variable's name opens
 * its body; a VSS2 variable's closes its header, after the standard or the
 * authenticated fields. Nothing when what is there does not read as one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramStoreFill.swift#NvramStoreFill.variableName
 */
function variableName(entry: UEFINode, inVss2: boolean, reader: ImageReader): string | undefined {
  let start = entry.body.start;
  let end = entry.body.end;
  if (inVss2) {
    const h = entry.header.start;
    const attributes = reader.uint32(h + 4);
    const lenName = reader.uint32(h + 8);
    const lenData = reader.uint32(h + 12);
    if (attributes === undefined || lenName === undefined || lenData === undefined) {
      return undefined;
    }
    const isAuth = isAuthenticatedVss2Variable({ attributes, lenName, lenData });
    start = h + (isAuth ? NVRAM.vssAuthHeaderSize : NVRAM.vssStandardHeaderSize);
    end = entry.header.end;
  }
  if (start >= end) return undefined;
  const length = Math.min(end - start, 0x200) & ~1;
  const bytes = length >= 2 ? reader.bytesAt(start, length) : undefined;
  if (bytes === undefined) return undefined;
  const units: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (unit === 0) break;
    if (unit < 0x20 || unit >= 0x7f) return undefined;
    units.push(unit);
  }
  return units.length === 0 ? undefined : String.fromCharCode(...units);
}
