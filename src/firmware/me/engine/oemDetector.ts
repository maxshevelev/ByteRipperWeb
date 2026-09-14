import { filledWith } from "@/firmware/me/bytes";
import type { FPTResult } from "@/firmware/me/layout/fpt";
import type {
  BootPartition,
  CodePartition,
  CPDModuleRow,
} from "@/firmware/me/models/firmwareAnalysis";

/**
 * Row 14's OEM Configuration — upstream's single `oem_signed or oemp_found or
 * utok_found`. Three independent facts, each read from a different corner of the
 * image:
 *
 * - `oem_signed`: the operational `$CPD` carries an `oem.key` module whose body
 *   is a *real* OEM key — non-empty and not Intel's placeholder. The raw stored
 *   bytes are read, because Intel ships the placeholder uncompressed and its
 *   VEN_ID 0xBCCB is visible in them.
 * - `oemp_found` / `utok_found`: a non-empty `OEMP` / `UTOK` / `STKN` partition
 *   whose first 0x10 bytes are not erased, in the region's own `$FPT` and in the
 *   IFWI boot partitions' tables. An `OEMP` must also not open with the
 *   placeholder.
 *
 * Always decidable from bytes: false when none of the three has positive
 * evidence, which is upstream's default on a plain Intel image.
 *
 * Module offsets here are absolute, where upstream's count from the `$CPD`: the
 * region-relative body is `module.offset - baseOffset` in this model, the same
 * byte upstream reaches as `cp.offset - baseOffset + module.offset`.
 *
 * Ported from `Packages/MEFirmware/Engine/OEMDetector.swift`.
 */

export function oemCustomized(options: {
  readonly fpt: FPTResult | undefined;
  readonly bootPartitions: readonly BootPartition[] | undefined;
  readonly codePartition: CodePartition | undefined;
  readonly bytes: Uint8Array;
  readonly baseOffset: number;
}): boolean {
  return (
    oemKeySigned(options.codePartition, options.bytes, options.baseOffset) ||
    oemOrUnlockPartition(options)
  );
}

/**
 * The operational `$CPD` carries a non-empty `fitc.cfg` — the configuration the
 * Flash Image Tool writes. Not part of row 14's answer: it is one of the four
 * things that raise the File System State to Configured.
 */
export function fitConfiguration(
  codePartition: CodePartition | undefined,
  bytes: Uint8Array,
  baseOffset: number
): boolean {
  return (
    codePartition?.modules.some(
      (module) =>
        module.name === "fitc.cfg" && populatedBody(module, bytes, baseOffset) !== undefined
    ) ?? false
  );
}

/**
 * The region range of a module's stored body, or nothing when the module is
 * upstream's `entry_empty`: a zero size, an offset past the end, or an entirely
 * erased full-size body. A body truncated at the end is not erased.
 */
function populatedBody(
  module: CPDModuleRow,
  bytes: Uint8Array,
  baseOffset: number
): readonly [number, number] | undefined {
  if (module.size <= 0) return undefined;
  const base = module.offset - baseOffset;
  if (base < 0 || base >= bytes.length) return undefined;
  const end = Math.min(base + module.size, bytes.length);
  if (end - base === module.size && filledWith(bytes, base, end - base, 0xff)) return undefined;
  return [base, end];
}

function oemKeySigned(
  codePartition: CodePartition | undefined,
  bytes: Uint8Array,
  baseOffset: number
): boolean {
  for (const module of codePartition?.modules ?? []) {
    if (module.name !== "oem.key") continue;
    const body = populatedBody(module, bytes, baseOffset);
    if (body === undefined) continue;
    const [start, end] = body;
    // A real key body does not open with the placeholder signature.
    if (containsPlaceholder(bytes, start, Math.min(start + 0x50, end))) continue;
    return true;
  }
  return false;
}

function oemOrUnlockPartition(options: {
  readonly fpt: FPTResult | undefined;
  readonly bootPartitions: readonly BootPartition[] | undefined;
  readonly bytes: Uint8Array;
  readonly baseOffset: number;
}): boolean {
  const { bytes, baseOffset } = options;
  const candidates = [
    ...(options.fpt?.partitions ?? []),
    // The boot tables' offsets are absolute in the analysed image.
    ...(options.bootPartitions ?? []).flatMap((boot) =>
      boot.entries.map((entry) => ({ ...entry, offset: entry.offset - baseOffset }))
    ),
  ];
  return candidates.some((part) => {
    if (part.name !== "OEMP" && part.name !== "UTOK" && part.name !== "STKN") return false;
    if (part.empty || part.size <= 0) return false;
    if (part.offset < 0 || part.offset >= bytes.length) return false;
    // Only an entirely erased *full* 0x10 window disqualifies it, so a head cut
    // short by the end of the region stays a candidate.
    if (filledWith(bytes, part.offset, 0x10, 0xff)) return false;
    const end = Math.min(part.offset + part.size, bytes.length);
    return !(
      part.name === "OEMP" &&
      containsPlaceholder(bytes, part.offset, Math.min(part.offset + 0x50, end))
    );
  });
}

/**
 * `bccb_pat`, `\xCB\xBC.{9}\x00\$MN2`: VEN_ID 0xBCCB little-endian, nine bytes
 * of anything, a NUL, then the key's `$MN2` recovery-manifest trailer.
 */
function containsPlaceholder(bytes: Uint8Array, from: number, to: number): boolean {
  const low = Math.max(from, 0);
  const high = Math.min(to, bytes.length);
  if (high - low < 16) return false;
  for (let at = low; at <= high - 16; at++) {
    if (
      bytes[at] === 0xcb &&
      bytes[at + 1] === 0xbc &&
      bytes[at + 11] === 0x00 &&
      bytes[at + 12] === 0x24 &&
      bytes[at + 13] === 0x4d &&
      bytes[at + 14] === 0x4e &&
      bytes[at + 15] === 0x32
    ) {
      return true;
    }
  }
  return false;
}
