import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/**
 * Which PCH or SoC a CSE firmware is built for, named from its own version.
 *
 * For CSME this names a platform *only when the image carries no chipset
 * initialisation table*: where one exists it already says which chipset and
 * stepping the firmware initialises, and naming a platform beside it would be a
 * second, vaguer answer to a question already answered. That gate is why the row
 * is absent on most CSME images and present on the ones whose file system holds
 * no such table.
 *
 * Not ported: the SPS names, which upstream takes from an extension's SKU cell
 * before falling back to the initialisation table, and the GSC ones. Those
 * families come back with nothing, and the row stays off rather than showing a
 * guess.
 *
 * Ported from `Packages/MEFirmware/Identify/CSEPlatform.swift`.
 */

/**
 * What is known about the image's chipset initialisation table — the thing
 * whose presence decides whether a CSME platform is named at all.
 *
 * `unknown` is the honest answer for a file-table volume that holds files: a
 * full decode of its configuration would find any initialisation table in it,
 * and until that is ported this engine cannot say the table is *absent*. Naming
 * a platform on a "maybe" would print a row upstream leaves off.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/CSEPlatform.swift#CSEPlatformNames.ChipsetInitTable
 */
export type ChipsetInitTable = "present" | "absent" | "unknown";

/**
 * The platform name, or nothing when this family and version name none.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/CSEPlatform.swift#CSEPlatformNames
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/CSEPlatform.swift#CSEPlatformNames.name
 */
export function csePlatformName(options: {
  readonly family: FirmwareFamily;
  readonly major: number;
  readonly minor: number;
  readonly chipsetInitTable: ChipsetInitTable;
}): string | undefined {
  const { family, major, minor, chipsetInitTable } = options;
  if (family === "csme") {
    // The initialisation table, where there is one, is the better answer and
    // takes the row instead.
    return chipsetInitTable === "absent" ? csmePlatform(major, minor) : undefined;
  }
  if (family === "cstxe") return cstxePlatform(major, minor);
  return undefined;
}

function csmePlatform(major: number, minor: number): string | undefined {
  const key = `${major}.${minor}`;
  switch (key) {
    case "11.0":
      return "SPT"; // Sunrise Point
    case "11.5":
    case "11.6":
    case "11.7":
    case "11.8":
      return "SPT/KBP"; // and Union Point
    case "11.10":
    case "11.11":
    case "11.12":
      return "BSF/GCF"; // Basin and Glacier Falls
    case "11.20":
    case "11.21":
    case "11.22":
      return "LBG"; // Lewisburg
    case "12.0":
      return "CNP"; // Cannon Point
    case "13.0":
      return "ICP"; // Ice Point
    case "13.30":
      return "LKF"; // Lakefield
    case "13.50":
      return "JSP"; // Jasper Point
    case "14.0":
    case "14.1":
      return "CMP-H/LP"; // Comet Point
    case "14.5":
      return "CMP-V";
    case "15.0":
      return "TGP"; // Tiger Point
    case "15.40":
      return "MCC"; // Mule Creek Canyon
    case "16.0":
      return "ADP"; // Alder Point
    case "16.1":
      return "ADP/RPP"; // Raptor Point
    default:
      return undefined;
  }
}

/** CSTXE names its platform whatever the file system holds: no gate on these. */
function cstxePlatform(major: number, minor: number): string | undefined {
  const key = `${major}.${minor}`;
  switch (key) {
    case "3.0":
    case "3.1":
      return "APL"; // Apollo Lake
    case "3.2":
      return "BXT"; // Broxton
    case "4.0":
      return "GLK"; // Gemini Lake
    default:
      return undefined;
  }
}
