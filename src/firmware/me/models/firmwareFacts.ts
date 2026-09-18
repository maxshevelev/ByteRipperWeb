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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareFamily
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

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version */
export interface MEVersion {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.major */
  readonly major: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.build */
  readonly build: number;
  /**
   * The MEU fields, where the manifest has them.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.meMajor
   */
  readonly meMajor: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.meMinor */
  readonly meMinor: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.meHotfix */
  readonly meHotfix: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.meBuild */
  readonly meBuild: number | undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#Version.text */
export const versionText = (version: {
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}): string => `${version.major}.${version.minor}.${version.hotfix}.${version.build}`;

/**
 * The version of the Flash Image Tool an image was built with.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FITVersion
 */
export interface FITVersion {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FITVersion.major */
  readonly major: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FITVersion.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FITVersion.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FITVersion.build */
  readonly build: number;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#ReleaseType */
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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareType
 */
export type FirmwareType = "region" | "extracted" | "update" | "stock" | "unknown";

/**
 * Whether Intel's own update tool can update this image in place.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FWUpdateSupport
 */
export type FWUpdateSupport = "yes" | "no" | "impossible";

/**
 * What the database records about power-down mitigation.
 *
 * Three of these five are the database saying it does not know, and they are
 * kept apart because the database itself keeps them apart — a panel showing
 * "Unknown" for all three would be throwing away what the row said.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#PowerDownMitigation
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
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#MFSState
 */
export type MFSState = "unconfigured" | "initialized" | "configured" | "error";

/**
 * One row of the Flash Partition Table, as the analysis reports it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FPTRegion
 */
export interface FPTRegionRow {
  /**
   * Its place in the table.
   *
   * Two erased rows have the same name, the same offset and the same size, and
   * the only thing that tells them apart is where in the table they sit — which
   * is a fact about the row and not a detail of how it is displayed.
   */
  readonly index: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FPTRegion.name */
  readonly name: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FPTRegion.offset */
  readonly offset: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FPTRegion.size */
  readonly size: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FPTRegion.flags */
  readonly flags: number;
}

/**
 * `UTFL_Header`'s fixed length — what `offset` points at is this many bytes,
 * and a reader showing the structure needs to say so.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.size
 */
export const UNLOCK_TOKEN_FLAGS_SIZE = 0x20;

/**
 * The flags a debug unlock token ends with — upstream `UTFL_Header` (MEA.py
 * 2038).
 *
 * An FPT partition named `UTOK` or `STKN` carries a signed unlock token, and
 * may end with a 0x20-byte structure tagged `UTFL`. One per such partition that
 * has one; a token without the structure is listed nowhere, which is upstream's
 * reading too — it calls the structure optional and says nothing when the tag
 * is absent.
 *
 * `delayedAuthMode` is kept as the raw byte it is. Upstream words 0 and 1 as No
 * and Yes and anything else as "Unknown (n)", which is the panel's job: the
 * model says what the byte held. `reservedHex` is the 27 trailing bytes in
 * storage order (upstream prints the same bytes as one little-endian value).
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags
 */
export interface UnlockTokenFlags {
  /**
   * The partition the structure ends — `UTOK` or `STKN`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.partition
   */
  readonly partition: string;
  /**
   * Where the 0x20 bytes begin in the image.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.offset
   */
  readonly offset: number;
  /**
   * The Delayed Authentication Mode byte, raw.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.delayedAuthMode
   */
  readonly delayedAuthMode: number;
  /**
   * The 27 reserved bytes, in storage order.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#UnlockTokenFlags.reservedHex
   */
  readonly reservedHex: string;
}
