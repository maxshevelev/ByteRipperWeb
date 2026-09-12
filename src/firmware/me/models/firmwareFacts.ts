/**
 * The facts an ME analysis reports, as values.
 *
 * They are the vocabulary the whole ME half speaks in, so they live apart from
 * any of the parsers that fill them: a family is a family whether it was decided
 * by a key, a module name or a version.
 *
 * Ported from `Packages/MEFirmware/Models/FirmwareAnalysis.swift`.
 */

/**
 * The engine family, as identified from the manifest's RSA public key.
 *
 * `unknown` is a real answer and not a failure: a key the database does not
 * list belongs to firmware nobody has catalogued, and saying so is better than
 * naming the nearest family.
 */
export type FirmwareFamily =
  | "me"
  | "csme"
  | "txe"
  | "cstxe"
  | "sps"
  | "cssps"
  | "gsc"
  | "pmc"
  | "pchc"
  | "phy"
  | "orom"
  | "unknown";

export interface MEVersion {
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
  /** The MEU fields, where the manifest has them. */
  readonly meMajor: number | undefined;
  readonly meMinor: number | undefined;
  readonly meHotfix: number | undefined;
  readonly meBuild: number | undefined;
}

export const versionText = (version: {
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}): string => `${version.major}.${version.minor}.${version.hotfix}.${version.build}`;

/** The version of the Flash Image Tool an image was built with. */
export interface FITVersion {
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}

export type ReleaseType = "production" | "preProduction" | "romBypass" | "unknown";

export function releaseText(release: ReleaseType): string {
  switch (release) {
    case "production":
      return "Production";
    case "preProduction":
      return "Pre-Production";
    case "romBypass":
      return "ROM-Bypass";
    case "unknown":
      return "Unknown";
  }
}

/**
 * The kind of image: an OEM or stock IFWI with a real `$FPT` (`extracted`), a
 * stock image with no FIT, an update image whose whole firmware is the update
 * trio, or — on an unidentified region — the raw-partition placeholder.
 */
export type FirmwareType = "region" | "extracted" | "update" | "stock" | "unknown";

/** Whether Intel's own update tool can update this image in place. */
export type FWUpdateSupport = "yes" | "no" | "impossible";

/**
 * What the database records about power-down mitigation.
 *
 * Three of these five are the database saying it does not know, and they are
 * kept apart because the database itself keeps them apart — a panel showing
 * "Unknown" for all three would be throwing away what the row said.
 */
export type PowerDownMitigation = "yes" | "no" | "unknown" | "unknown1" | "unknown2";

export function powerDownMitigationFrom(token: string): PowerDownMitigation | undefined {
  switch (token) {
    case "YPDM":
      return "yes";
    case "NPDM":
      return "no";
    case "UPDM1":
      return "unknown1";
    case "UPDM2":
      return "unknown2";
    case "UPDM":
      return "unknown";
    default:
      return undefined;
  }
}

export function powerDownMitigationText(value: PowerDownMitigation): string {
  switch (value) {
    case "yes":
      return "Yes";
    case "no":
      return "No";
    case "unknown":
      return "Unknown";
    case "unknown1":
      return "Unknown 1";
    case "unknown2":
      return "Unknown 2";
  }
}

/**
 * The file system's state: initialised once a reserved or indexed file set
 * appears, configured once the configuration and home files do, and
 * unconfigured otherwise.
 */
export type MFSState = "unconfigured" | "initialized" | "configured" | "error";

/** One row of the Flash Partition Table, as the analysis reports it. */
export interface FPTRegionRow {
  /**
   * Its place in the table.
   *
   * Two erased rows have the same name, the same offset and the same size, and
   * the only thing that tells them apart is where in the table they sit — which
   * is a fact about the row and not a detail of how it is displayed.
   */
  readonly index: number;
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly flags: number;
}
