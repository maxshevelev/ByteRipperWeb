import { filledWith, find, has, tag, tagBytes, u8, u16, u32 } from "@/firmware/me/bytes";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import { type LayoutInfo, layoutTable } from "@/firmware/me/layout/ifwi";

/**
 * The Flash Partition Table — the spine every other ME structure hangs off.
 *
 * The v2.1 entry starts at the same 0x20 offset as v1 and v2, and the partition
 * count sits at 0x04 in all of them, so one decoder reads every version; only
 * the header's own checksum and redundancy handling differ.
 *
 * Offsets are relative to the start of the region handed in, which is how a
 * caller analysing a slice measures everything.
 *
 * Ported from `Packages/MEFirmware/Layout/FPT.swift`.
 */

const FPT_TAG = tagBytes("$FPT");

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition */
export interface FPTPartition {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition.flags */
  readonly flags: number;
  /**
   * The offset field is absent, or the size is zero, or — for a bounded size —
   * the whole content is erased. A partition a vendor reserved and never filled.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Partition.empty
   */
  readonly empty: boolean;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result */
export interface FPTResult {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.headerVersion */
  readonly headerVersion: number;
  /**
   * After the dispatch below, which sees through a v2.1 written with a v2.0 tag.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.resolvedVersion
   */
  readonly resolvedVersion: number;
  /**
   * Where partitions are measured from, which is not always the marker.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.fptStart
   */
  readonly fptStart: number;
  /**
   * The header's FIT fields, raw. The 0 and 0xFFFF markers are kept rather than
   * turned into absence: what tests them is the firmware-type classifier, and it
   * tests the marker itself.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.fitMajor
   */
  readonly fitMajor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.fitMinor */
  readonly fitMinor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.fitHotfix */
  readonly fitHotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.fitBuild */
  readonly fitBuild: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.partitions */
  readonly partitions: readonly FPTPartition[];
  /**
   * The CSE Layout Table that precedes the `$FPT`, when there is one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.Result.cseLayout
   */
  readonly cseLayout: LayoutInfo | undefined;
}

/**
 * The first `$FPT` that passes the plausibility filter: the tag, then a small
 * nonzero partition count and three zero bytes behind it.
 *
 * Four ASCII bytes turn up in compressed data often enough that the tag alone is
 * not an anchor; a count in `[1, 0x7F]` with a zeroed high half is.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.findAnchor
 */
export function findFptAnchor(
  bytes: Uint8Array,
  range?: { readonly start: number; readonly end: number }
): number | undefined {
  const low = range?.start ?? 0;
  const high = Math.min(range?.end ?? bytes.length, bytes.length);
  for (let scan = low; scan < high; ) {
    const found = find(bytes, FPT_TAG, scan, high);
    if (found < 0) return undefined;
    if (found + 8 <= high) {
      const count = u8(bytes, found + 4);
      if (
        count >= 0x01 &&
        count <= 0x7f &&
        u8(bytes, found + 5) === 0 &&
        u8(bytes, found + 6) === 0 &&
        u8(bytes, found + 7) === 0
      ) {
        return found;
      }
    }
    scan = found + 1;
  }
  return undefined;
}

/**
 * Decodes the `$FPT` whose header begins at `anchor`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.decode
 */
export function decodeFpt(bytes: Uint8Array, anchor: number): FPTResult | undefined {
  // The header and at least one entry.
  if (!has(bytes, anchor, 0x40)) return undefined;
  const count = u32(bytes, anchor + 0x04);
  if (count === 0 || !has(bytes, anchor, 0x20 + count * 0x20)) return undefined;

  const headerVersion = u8(bytes, anchor + 0x08);
  const headerLength = u8(bytes, anchor + 0x0a);
  let resolvedVersion = headerVersion;
  if (headerVersion === 0x20) {
    // A v2.0 tag whose second checksum word is neither erased nor zero is
    // really a v2.1 — a v2.1 header a tool wrote with the older tag.
    const secondWord = u16(bytes, anchor + 0x16);
    if (secondWord !== 0 && secondWord !== 0xffff) resolvedVersion = 0x21;
  }

  // A whole-flash image carries its Flash Descriptor, and the Layout Table sits
  // at the Engine region's base; a bare ME region is probed at its own start.
  const region = meRegion(bytes);
  const cseLayout = layoutTable(bytes, region?.base ?? 0);
  const start = fptStart(bytes, {
    anchor,
    version: headerVersion,
    headerLength,
    hasLayoutTable: cseLayout !== undefined,
  });

  const partitions: FPTPartition[] = [];
  for (let index = 0; index < count; index++) {
    const entry = anchor + 0x20 + index * 0x20;
    // An erased name, or a count field reading past the real entries, gives a
    // name of nonsense — which is the signal, so it is not smoothed away.
    const name = tag(bytes, entry, 4);
    const rawOffset = u32(bytes, entry + 0x08);
    const rawSize = u32(bytes, entry + 0x0c);
    const offset = start + rawOffset;
    const empty =
      rawOffset === 0 ||
      rawOffset === 0xffff_ffff ||
      rawSize === 0 ||
      (rawSize !== 0xffff_ffff && erased(bytes, offset, rawSize));
    partitions.push({ name, offset, size: rawSize, flags: u32(bytes, entry + 0x1c), empty });
  }

  return {
    headerVersion,
    resolvedVersion,
    fptStart: start,
    fitMajor: u16(bytes, anchor + 0x18),
    fitMinor: u16(bytes, anchor + 0x1a),
    fitHotfix: u16(bytes, anchor + 0x1c),
    fitBuild: u16(bytes, anchor + 0x1e),
    partitions,
    cseLayout,
  };
}

/**
 * Where partitions are measured from: the `$FPT` marker minus 0x10, unless a
 * CSE Layout Table marks this `$FPT` as the IFWI engine's data table, or an
 * erased CSE-header window or a v1.0 header says the marker is the base itself.
 *
 * The 0x10 is the whole of it. A pre-IFWI engine's `$FPT` sits 0x10 into its
 * region and its partitions measure from the region's base — measuring them
 * from the marker puts every partition on a CSME 11 image 0x10 bytes too high,
 * which is a real defect this rule exists to prevent.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.fptStart
 */
export function fptStart(
  bytes: Uint8Array,
  options: {
    readonly anchor: number;
    readonly version: number;
    readonly headerLength: number;
    readonly hasLayoutTable: boolean;
  }
): number {
  const { anchor, version, headerLength, hasLayoutTable } = options;
  if (anchor === 0) return 0;
  let start = anchor - 0x10;

  if (hasLayoutTable && (version === 0x20 || version === 0x21) && headerLength === 0x20) {
    start = anchor;
  } else {
    // An erased CSE-header window 0x1000 before the marker — a run of zeros then
    // sixteen erased bytes — means this `$FPT` is the region's base.
    const window = anchor - 0x1000;
    if (
      window >= 0 &&
      (zeroThenErased(bytes, window, 0x50) || zeroThenErased(bytes, window, 0x48))
    ) {
      start = anchor;
    }
  }
  if (start === anchor - 0x10 && version === 0x10 && headerLength === 0x20) start = anchor;
  return start;
}

/** `zeros` zero bytes followed by sixteen erased ones. */
function zeroThenErased(bytes: Uint8Array, at: number, zeros: number): boolean {
  return filledWith(bytes, at, zeros, 0x00) && filledWith(bytes, at + zeros, 0x10, 0xff);
}

/**
 * Finds the first `$FPT` — inside the Engine region when the image is whole
 * flash, else anywhere — and decodes it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FPT.swift#FPTParser.parseFirst
 */
export function parseFirstFpt(bytes: Uint8Array): FPTResult | undefined {
  const region = meRegion(bytes);
  const anchor =
    region === undefined
      ? findFptAnchor(bytes)
      : findFptAnchor(bytes, { start: region.base, end: region.base + region.size });
  return anchor === undefined ? undefined : decodeFpt(bytes, anchor);
}

/**
 * Whether a partition's content is erased.
 *
 * An empty window reads as erased, and one that runs past the region does not:
 * a partition whose fields point outside stays non-empty, which is what keeps a
 * wrong field from reading as an unused slot.
 */
function erased(bytes: Uint8Array, at: number, count: number): boolean {
  if (at < 0 || count <= 0) return true;
  if (!has(bytes, at, count)) return false;
  return filledWith(bytes, at, count, 0xff);
}
