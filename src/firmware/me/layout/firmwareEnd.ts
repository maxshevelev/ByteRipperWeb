import { find, tagBytes } from "@/firmware/me/bytes";
import type { FPTPartition } from "@/firmware/me/layout/fpt";
import { DATA_SLOT_NAME, type LayoutInfo } from "@/firmware/me/layout/ifwi";

/**
 * Row 18's firmware size — how far the engine firmware itself reaches, measured
 * from the `$FPT` start. That is not the size of the region or of the file
 * carrying it: on a CSME 12 dump the firmware ends at 0x27C000 inside a 16 MiB
 * file whose ME region is 0x6E0000 long.
 *
 * Three parts, exactly as upstream:
 *
 * - the end of the partition that *starts* last in the `$FPT` — that entry's own
 *   end rather than the greatest end of all of them. An offset or size at 0 or
 *   0xFFFFFFFF is a field that says nothing, and its entry does not win.
 * - on an IFWI image, the CSE Layout Table total instead: the table itself, plus
 *   the larger of that `$FPT` end and the Data partition, plus every
 *   Boot/Temp/ELog partition, minus every entry nested inside another.
 * - the whole rounded up to the next 4 KiB — except on CSME 16 and newer, whose
 *   MFIT-built images are unaligned and which upstream stopped rounding.
 *
 * Nothing when the answer would need a leg that is not ported: an ME 2–6 image
 * whose last entry carries no size (upstream walks that partition's `$MME`
 * submodules for the end), or a table with no partitions at all.
 *
 * Ported from `Packages/MEFirmware/Layout/FirmwareEnd.swift`.
 */

/**
 * An offset or size at or past this is an erased field, not a position.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.maxSize
 */
const MAX_SIZE = 0xffff_ffff;

/**
 * The 4 KiB the firmware is padded to.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.alignment
 */
const ALIGNMENT = 0x1000;

const CPD_TAG = tagBytes("$CPD");

/**
 * What the walk learns about an image's tail beyond the size itself: the facts
 * FWUpdate Support is decided from, which come out of this same arithmetic
 * rather than being worked out twice.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.Layout
 */
export interface FirmwareEndLayout {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.Layout.firmwareSize */
  readonly firmwareSize: number | undefined;
  /**
   * An uncharted `$CPD` partition follows the last charted one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.Layout.hasUnchartedPartition
   */
  readonly hasUnchartedPartition: boolean;
  /**
   * The probe that *searched* for an uncharted `$CPD` in the 8 KiB after the last
   * charted partition found one further along, rather than right at the end.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.Layout.unchartedProbeHit
   */
  readonly unchartedProbeHit: boolean;
  /**
   * How much of the 4 KiB padding the firmware wants is present in the buffer.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.Layout.alignmentPresent
   */
  readonly alignmentPresent: number;
}

export interface FirmwareEndInput {
  readonly bytes: Uint8Array;
  readonly partitions: readonly FPTPartition[];
  readonly fptStart: number;
  readonly cseLayout: LayoutInfo | undefined;
  readonly hasFlashDescriptor: boolean;
  readonly ignores4KAlignment: boolean;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.firmwareSize */
export const firmwareSize = (input: FirmwareEndInput): number | undefined =>
  firmwareEndLayout(input).firmwareSize;

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Layout/FirmwareEnd.swift#FirmwareEndCalculator.layout
 */
export function firmwareEndLayout(input: FirmwareEndInput): FirmwareEndLayout {
  const { bytes, partitions, fptStart, cseLayout } = input;
  let size: number | undefined;
  let hasUnchartedPartition = false;
  let unchartedProbeHit = false;
  let alignmentPresent = 0;
  const facts = (): FirmwareEndLayout => ({
    firmwareSize: size,
    hasUnchartedPartition,
    unchartedProbeHit,
    alignmentPresent,
  });
  if (partitions.length === 0) return facts();

  // The partition that starts last, and its own end.
  let offsetLast = 0;
  let endLast = 0;
  for (const part of partitions) {
    const spi = part.offset;
    const end =
      spi > 0 && spi < MAX_SIZE && part.size > 0 && part.size < MAX_SIZE
        ? spi + part.size
        : MAX_SIZE;
    if (offsetLast < spi && spi < MAX_SIZE) {
      offsetLast = spi;
      endLast = end;
    }
  }
  // The ME 2–6 leg: no size on the last entry, so the end is only knowable by
  // walking its submodules. Not ported — and a 4 GiB answer would be worse than
  // none.
  if (endLast <= 0 || endLast === MAX_SIZE) return facts();

  // An uncharted partition can start up to 4 KiB past the last charted one, so
  // upstream looks for its `$CPD` there — on an image with neither a flash
  // descriptor nor a Layout Table, which are what make the search unnecessary.
  if (!input.hasFlashDescriptor && cseLayout === undefined && !startsWithCpd(bytes, endLast)) {
    const uncharted = firstCpd(bytes, endLast, 0x200b);
    if (uncharted !== undefined) {
      unchartedProbeHit = true;
      endLast = uncharted;
    }
  }
  // Whether one is there at all — right at the end, or where the probe moved it.
  hasUnchartedPartition = startsWithCpd(bytes, endLast);

  if (cseLayout !== undefined) endLast = layoutTotal(cseLayout, endLast);

  const measured = endLast - fptStart;
  if (measured <= 0) return facts();
  const remainder = measured % ALIGNMENT;
  if (remainder === 0) {
    size = measured;
    return facts();
  }
  // The firmware wants padding to the next 4 KiB; this is how much of it the
  // image actually carries.
  alignmentPresent = Math.max(0, Math.min(ALIGNMENT - remainder, bytes.length - endLast));
  size = input.ignores4KAlignment ? measured : measured + (ALIGNMENT - remainder);
  return facts();
}

/**
 * Upstream's IFWI total: the Layout Table, the larger of the `$FPT` end and the
 * Data partition, every other partition, less the nested ones.
 */
function layoutTotal(layout: LayoutInfo, fptEnd: number): number {
  // The table is 4 KiB unless its first real partition starts later, in which
  // case that is where the table's own space ends.
  let tableSize = ALIGNMENT;
  const starts = layout.slots
    .filter((slot) => !slot.empty)
    .map((slot) => slot.offset - layout.base);
  if (starts.length > 0) tableSize = Math.max(tableSize, Math.min(...starts));

  const dataSize = layout.slots.find((slot) => slot.name === DATA_SLOT_NAME)?.size ?? 0;
  // Boot 1…5 and, on IFWI 1.7, Temp and ELog.
  const bootSize = layout.slots
    .filter((slot) => slot.name !== DATA_SLOT_NAME)
    .reduce((sum, slot) => sum + slot.size, 0);

  // A partition wholly inside another is the same flash space counted twice —
  // the redundancy layouts do this — so it is subtracted once per containing
  // partition, exactly as upstream's nested pass counts it.
  let duplicate = 0;
  for (const inner of layout.slots) {
    for (const outer of layout.slots) {
      if (inner.name === outer.name) continue;
      if (inner.offset >= outer.offset && inner.offset + inner.size <= outer.offset + outer.size) {
        duplicate += inner.size;
      }
    }
  }
  return tableSize + Math.max(fptEnd, dataSize) + bootSize - duplicate;
}

function startsWithCpd(bytes: Uint8Array, at: number): boolean {
  return at >= 0 && at + 4 <= bytes.length && find(bytes, CPD_TAG, at, at + 4) === at;
}

/** The first `$CPD` wholly inside `length` bytes from `at`. */
function firstCpd(bytes: Uint8Array, at: number, length: number): number | undefined {
  if (at < 0 || at >= bytes.length) return undefined;
  const found = find(bytes, CPD_TAG, at, Math.min(at + length, bytes.length));
  return found < 0 ? undefined : found;
}
