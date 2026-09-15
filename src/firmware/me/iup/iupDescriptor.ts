import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/**
 * What the independent (IUP) firmware families — PMC, PCHC and PHY — say about
 * the chipset they are built for, from the manifest identity alone:
 *
 * - `platform` — the Chipset Support label (`TGP`, `CMP-V`, `WTL`);
 * - `sku` — the Chipset SKU letter for PMC and PHY (`H`, `LP`, `N`, `V`), where
 *   the family derives one (PCHC never does);
 * - `chipsetStepping` — the PMC stepping letter decoded from the manifest's
 *   hotfix or major. PCHC and PHY surface none.
 *
 * Ported from `Packages/MEFirmware/IUP/IUP.swift` (upstream `pmc_anl`,
 * `pchc_anl` and `phy_anl`).
 */

/** @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor.Facts */
export interface IUPFacts {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor.Facts.platform */
  readonly platform: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor.Facts.sku */
  readonly sku: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor.Facts.chipsetStepping */
  readonly chipsetStepping: string | undefined;
}

/** The stepping letter table: index 0…15 → A…P. */
const STEPPING_LETTERS = "ABCDEFGHIJKLMNOP";

const steppingLetter = (index: number): string => STEPPING_LETTERS[Math.min(index, 0xf)] ?? "?";

/** The general-branch Chipset SKU by the manifest's minor. */
const SKU_BY_MINOR = ["SoC", "LP", "H", "N", "M"] as const;

/**
 * The facts of an identified IUP family; nothing for any other family.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor
 * @upstream Packages/MEFirmware/Sources/MEFirmware/IUP/IUP.swift#IUPDescriptor.facts
 */
export function iupFacts(options: {
  readonly family: FirmwareFamily;
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
}): IUPFacts | undefined {
  switch (options.family) {
    case "pmc":
      return pmc(options.variant, options.major, options.minor, options.hotfix);
    case "pchc":
      return pchc(options.variant);
    case "phy":
      return phy(options.variant);
    default:
      return undefined;
  }
}

/**
 * The platform defaults to the token's last three characters and the stepping
 * to the hotfix's tens; then the per-token overrides.
 */
function pmc(variant: string, major: number, minor: number, hotfix: number): IUPFacts | undefined {
  if (variant.length < 3 || variant === "Unknown") return undefined;

  let platform = variant.slice(-3);
  let stepping = steppingLetter(Math.floor(hotfix / 10));
  let sku: string | undefined;

  if (variant === "PMCCNP" && major !== 300 && major !== 30) {
    // A pre-12.0.0.1033 CNP: the old SKU naming from the hotfix, the stepping
    // from the major. A hotfix outside those two leaves the SKU unknown.
    if (hotfix === 0) sku = "H";
    else if (hotfix === 2) sku = "LP";
    stepping = steppingLetter(Math.floor(major / 10));
  } else if (variant === "PMCCMPV") {
    sku = "V";
    platform = "CMP-V";
  } else if (variant === "PMCWTL") {
    sku = "H";
    stepping = "B";
    platform = "WTL";
  } else if (isAtomPmc(variant)) {
    platform = variant.slice(3, 6);
    stepping = variant.at(-1) ?? "?";
  } else {
    sku = SKU_BY_MINOR[minor];
  }

  // The summary prints no SKU row for an APL, BXT, GLK or DG part, and no
  // stepping row for a DG one: the facts equal the rows upstream renders.
  if (isAtomPmc(variant) || variant.startsWith("PMCDG")) sku = undefined;
  return {
    platform,
    sku,
    chipsetStepping: variant.startsWith("PMCDG") ? undefined : stepping,
  };
}

const isAtomPmc = (variant: string): boolean =>
  variant.startsWith("PMCAPL") || variant.startsWith("PMCBXT") || variant.startsWith("PMCGLK");

/** `CMP-V` for its token, else the last three characters. No SKU, no stepping. */
function pchc(variant: string): IUPFacts | undefined {
  if (variant.length < 3 || variant === "Unknown") return undefined;
  return {
    platform: variant === "PCHCCMPV" ? "CMP-V" : variant.slice(-3),
    sku: undefined,
    chipsetStepping: undefined,
  };
}

/** The last three characters; the SKU is the fourth, except a DG part's, which is G. */
function phy(variant: string): IUPFacts | undefined {
  if (variant.length < 4 || variant === "Unknown") return undefined;
  return {
    platform: variant.slice(-3),
    sku: variant.startsWith("PHYDG") ? "G" : variant.charAt(3),
    chipsetStepping: undefined,
  };
}
