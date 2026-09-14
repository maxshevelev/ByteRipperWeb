import type { FirmwareEndLayout } from "@/firmware/me/layout/firmwareEnd";
import type { FPTPartition } from "@/firmware/me/layout/fpt";
import type {
  FirmwareFamily,
  FirmwareType,
  FWUpdateSupport,
} from "@/firmware/me/models/firmwareFacts";

/**
 * Row 15's FWUpdate Support: whether Intel's FWUpdate tool can update this image
 * in place.
 *
 * The answer is not about the engine but about the independent firmware beside
 * it. FWUpdate rewrites the engine's partitions and leaves the independent ones
 * where they are, so it needs each one its platform requires to sit in the
 * region's own `$FPT`. An image whose PMC lives inside an IFWI boot partition has
 * it where FWUpdate does not write, and the answer is No however complete the
 * image looks.
 *
 * `impossible` is upstream's own third answer: a Corporate extracted image with
 * no uncharted partition (or one the probe found past the padding) cannot be made
 * updatable by adding one, and a CSME 16 firmware at offset 0 with its padding
 * present is in the same position.
 *
 * Ported from `Packages/MEFirmware/Engine/FWUpdateSupport.swift`.
 */

/** Which independent firmware kinds the region's own `$FPT` lists, non-empty. */
export interface IUPPresence {
  readonly pmc: boolean;
  readonly pchc: boolean;
  readonly phy: boolean;
}

/** The names each kind goes by in a `$FPT`. */
export const PMC_PARTITION_NAMES: readonly string[] = ["PMCP", "PCOD"];
export const PCHC_PARTITION_NAMES: readonly string[] = ["PCHC"];
export const PHY_PARTITION_NAMES: readonly string[] = ["PPHY", "NPHY", "SPHY", "PHYP"];

export function iupPresence(partitions: readonly FPTPartition[]): IUPPresence {
  let pmc = false;
  let pchc = false;
  let phy = false;
  for (const part of partitions) {
    if (part.empty) continue;
    if (PMC_PARTITION_NAMES.includes(part.name)) pmc = true;
    if (PCHC_PARTITION_NAMES.includes(part.name)) pchc = true;
    if (PHY_PARTITION_NAMES.includes(part.name)) phy = true;
  }
  return { pmc, pchc, phy };
}

/**
 * The answer for a CSME 12-or-newer image, or nothing for anything else.
 *
 * `sku` is the engine's own SKU text ("Corporate H"): its first word says
 * Corporate, and the letters after it are the tie-breaker between the CSME 15.0
 * rules.
 */
export function fwUpdateSupport(options: {
  readonly family: FirmwareFamily;
  readonly major: number;
  readonly minor: number;
  readonly type: FirmwareType;
  readonly sku: string;
  readonly iup: IUPPresence;
  readonly layout: FirmwareEndLayout;
  readonly fptStart: number;
}): FWUpdateSupport | undefined {
  const { family, major, minor, type, sku, iup, layout, fptStart } = options;
  if (family !== "csme" || major < 12) return undefined;

  if (
    type === "extracted" &&
    sku.startsWith("Corporate") &&
    (layout.unchartedProbeHit || !layout.hasUnchartedPartition)
  ) {
    return "impossible";
  }
  // CSME 16 at the very start of the image, with its optional padding present:
  // FWUpdate will not take one that is padded.
  if (major >= 16 && layout.alignmentPresent > 0 && fptStart === 0) return "impossible";

  const letters = sku.split(" ").at(-1) ?? "";
  let needsPCHC = true;
  let needsPHY = true;
  const version = `${major}.${minor}`;
  if (major === 12) {
    needsPCHC = false;
    needsPHY = false;
  } else if (["13.0", "13.50", "14.0", "14.5", "15.40", "16.0"].includes(version)) {
    needsPHY = false;
  } else if (version === "15.0") {
    // The Tiger Point split: an LP part needs no Physical, an H one does.
    needsPHY = letters !== "LP";
  }

  const complete = iup.pmc && (!needsPCHC || iup.pchc) && (!needsPHY || iup.phy);
  return complete ? "yes" : "no";
}
