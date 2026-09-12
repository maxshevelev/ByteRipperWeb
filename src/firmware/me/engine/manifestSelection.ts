import type { FPTResult } from "@/firmware/me/layout/fpt";
import type { Manifest } from "@/firmware/me/layout/manifest";
import { findPrecedingCpd } from "@/firmware/me/partition/cpd";

/**
 * Which of a region's manifests is the *operational* one — the copy the
 * analysis identifies against the database.
 *
 * A flash image carries many: every engine and independent-update partition has
 * its own directory and manifest, and the recovery copies add more. Taking the
 * first in byte order is what made real dumps report "not in the database": on a
 * CSME 12 or 15 image the first is the recovery copy, and the operational one is
 * the boot partition's.
 *
 * Ported from `Packages/MEFirmware/Engine/ManifestSelection.swift`.
 */

/** The partition names a `$FPT` jump targets. */
const FPT_ENGINE_NAMES = ["FTPR", "RCVY", "OPR1", "OPR", "COD1"];

/**
 * The directory names the fallback accepts, boot partition first: a region
 * holding both carries an operational copy and a recovery copy, and the identity
 * is the operational one's.
 */
const CPD_ENGINE_NAMES = ["FTPR", "RBEP"];

export function selectOperationalManifest(options: {
  /** Sorted by their region-relative base, as a scan returns them. */
  readonly candidates: readonly Manifest[];
  readonly fpt: FPTResult | undefined;
  readonly bytes: Uint8Array;
}): Manifest | undefined {
  const { candidates, fpt, bytes } = options;
  const first = candidates[0];
  if (first === undefined) return undefined;

  // First: the `$FPT`'s own engine partition. The first partition in entry
  // order whose name is in the set — with `CODE` accepted only where no
  // recovery partition exists — that *contains* a candidate.
  if (fpt !== undefined) {
    const names = fpt.partitions.map((one) => one.name);
    const hasRecovery = names.includes("RCVY") || names.includes("COD1");
    for (const partition of fpt.partitions) {
      const wanted =
        FPT_ENGINE_NAMES.includes(partition.name) || (partition.name === "CODE" && !hasRecovery);
      if (!wanted) continue;
      const end = partition.offset + partition.size;
      const hit = candidates.find((one) => one.base >= partition.offset && one.base < end);
      if (hit !== undefined) return hit;
    }
  }

  // Then: the name of the directory that owns the manifest. A whole-flash
  // region lands here — its single `$FPT` lists internal volumes rather than
  // the boot partitions, so the step above finds nothing — and this is what
  // actually picks the operational copy there.
  for (const wanted of CPD_ENGINE_NAMES) {
    for (const candidate of candidates) {
      const owner = findPrecedingCpd(bytes, candidate.base);
      if (owner?.header.partitionName === wanted) return candidate;
    }
  }

  // And last: the first, which keeps a single-manifest region working.
  return first;
}
