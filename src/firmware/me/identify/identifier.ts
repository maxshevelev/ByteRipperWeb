import { hex, sha256 } from "@/firmware/me/crypto/digest";
import type { MEADatabase } from "@/firmware/me/data/meaDatabase";
import { variantByModule } from "@/firmware/me/identify/variantByModule";
import type { Manifest } from "@/firmware/me/layout/manifest";
import type { FirmwareFamily, ReleaseType } from "@/firmware/me/models/firmwareFacts";

/**
 * Turns a decoded manifest and the live database into the identity of a piece of
 * firmware: its family, its variant, its release and its version.
 *
 * Ported from `Packages/MEFirmware/Identify/Identifier.swift`.
 */

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity */
export interface Identity {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.family */
  readonly family: FirmwareFamily;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.variant */
  readonly variant: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.release */
  readonly release: ReleaseType;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.major */
  readonly major: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.build */
  readonly build: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.meMajor */
  readonly meMajor: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.meMinor */
  readonly meMinor: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.meHotfix */
  readonly meHotfix: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.meBuild */
  readonly meBuild: number | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.securityVersion */
  readonly securityVersion: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.databaseName */
  readonly databaseName: string | undefined;
  /**
   * The stepping the database records, where no chipset table names one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.chipsetStepping
   */
  readonly chipsetStepping: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.powerDownMitigation */
  readonly powerDownMitigation: string | undefined;
  /**
   * False when no real engine family could be determined at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.Identity.identified
   */
  readonly identified: boolean;
}

/**
 * The one RSA public key shared across ME 6–10, CSME 11 and TXE 0–2.
 *
 * The database classifies it as undecided, and the firmware's own major splits
 * it: one key, two families, and the version is the only thing that tells them
 * apart.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.sharedMEKeyHash
 */
export const SHARED_ME_KEY_HASH =
  "86C0E5EF0CFEFF6D810D68D83D8C6ECB68306A644C03C0446B646A3971D37894";

/**
 * The shared pre-key split, exposed on its own so it can be tested without
 * fabricating a key whose digest equals that constant.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.preKeyOverride
 */
export function preKeyOverride(keyHash: string | undefined, major: number): string | undefined {
  if (keyHash !== SHARED_ME_KEY_HASH) return undefined;
  if (major >= 6 && major <= 10) return "ME";
  // ME 2–5 and TXE 0–2 carry no MEU fields, and a major this low is a TXE.
  if (major <= 2) return "TXE";
  return undefined;
}

/**
 * A raw variant token as a family.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.family
 */
export function familyForVariant(token: string): FirmwareFamily {
  switch (token) {
    case "ME":
      return "me";
    case "CSME":
      return "csme";
    case "TXE":
      return "txe";
    case "CSTXE":
      return "cstxe";
    case "SPS":
      return "sps";
    case "CSSPS":
      return "cssps";
    case "GSC":
      return "gsc";
    default:
      // The per-platform tokens are many and their prefixes are the family.
      if (token.startsWith("PMC")) return "pmc";
      if (token.startsWith("PCHC")) return "pchc";
      if (token.startsWith("PHY")) return "phy";
      if (token.startsWith("OROM")) return "orom";
      return "unknown";
  }
}

/**
 * Identifies one manifest.
 *
 * `moduleNames` are the modules of the manifest's own directory, in order —
 * what names the firmware when no database key claims it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/Identifier.swift#Identifier.identify
 */
export function identify(options: {
  readonly manifest: Manifest;
  readonly database: MEADatabase;
  readonly hasRomBypass: boolean;
  readonly moduleNames?: readonly string[];
}): Identity {
  const { manifest, database, hasRomBypass } = options;
  const keyHash =
    manifest.rsaPublicKey === undefined ? undefined : hex(sha256(manifest.rsaPublicKey));
  const signatureHash =
    manifest.rsaSignature === undefined ? undefined : hex(sha256(manifest.rsaSignature));

  // First the database's own key line.
  let token = keyHash === undefined ? undefined : database.variantForKeyHash(keyHash);
  // Then the shared key, split by the firmware's major.
  const override = preKeyOverride(keyHash, manifest.major);
  if (override !== undefined) token = override;
  // Then the modules of its own directory, which is what recognises the
  // stitched independent firmware whose keys the database does not list.
  if (token === undefined || token === "Unknown" || token === "TBD") {
    const byModule = variantByModule({
      moduleNames: options.moduleNames ?? [],
      major: manifest.major,
      minor: manifest.minor,
      year: manifest.year,
      meuMajor: manifest.meMajor,
      meuMinor: manifest.meMinor,
    });
    if (byModule !== undefined) token = byModule;
  }

  const family = familyForVariant(token ?? "Unknown");
  const identified =
    family !== "unknown" && token !== undefined && token !== "Unknown" && token !== "TBD";

  // The release: a ROM-Bypass partition beats the manifest's own flag, and the
  // database's list of wrongly production-signed keys corrects the rest.
  let release: ReleaseType;
  if (hasRomBypass) release = "romBypass";
  else if (manifest.debugSigned) release = "preProduction";
  else {
    release =
      keyHash !== undefined && database.isPreProductionKey(keyHash)
        ? "preProduction"
        : "production";
  }

  // One search of the corpus for the firmware's own row, and both things read
  // off it: the manual cells, and the name the row itself gives the firmware.
  const databaseRow =
    signatureHash === undefined ? undefined : database.firmwareRowForSignatureHash(signatureHash);
  const cells = databaseRow === undefined ? undefined : database.cseCellsIn(databaseRow, family);

  return {
    family,
    variant: identified ? (token ?? "") : "",
    release,
    major: manifest.major,
    minor: manifest.minor,
    hotfix: manifest.hotfix,
    build: manifest.build,
    meMajor: manifest.meMajor,
    meMinor: manifest.meMinor,
    meHotfix: manifest.meHotfix,
    meBuild: manifest.meBuild,
    // Zero is a security version like any other, and every stitched independent
    // firmware has one. Only the erased word says nothing.
    securityVersion: manifest.svn !== 0xffff_ffff ? `${manifest.svn}` : undefined,
    databaseName: databaseRow,
    chipsetStepping: cells?.stepping,
    powerDownMitigation: cells?.pdm,
    identified,
  };
}
