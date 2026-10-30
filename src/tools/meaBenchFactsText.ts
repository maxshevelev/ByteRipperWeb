import type {
  BootGuardProfile,
  HardwareBinding,
  ManufacturingBasis,
  ManufacturingLock,
  ManufacturingState,
  OEMKeyHash,
} from "@/firmware/me/models/manufacturingFacts";

/**
 * The facts a repair bench asks of a dump it is about to flash: whether the image closes
 * Manufacturing on its first boot, what the board has done, which Boot Guard profile the
 * image is built for, which OEM public key hash it carries and whether it binds its SPI part.
 * Ours — MEAnalyzer prints none of them. Their **values** are English in every language, like
 * the tools' own option words: the finding a technician quotes is not translated.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText
 */

/**
 * The Manufacturing verdict as one phrase, naming the mechanism that decided it: two of them
 * do, and which one is at work is the difference between an image the workshop built to stay
 * open and one straight from a manufacturer.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.manufacturingState
 */
// help: panel.me.manufacturing
export function manufacturingStateText(
  state: ManufacturingState,
  basis: ManufacturingBasis | undefined
): string {
  switch (state) {
    case "willClose":
      return basis?.flag === true
        ? "Will close on the EOM flag"
        : "Will close on the descriptor's rights";
    case "willNotClose":
      return "Will not close";
    case "unexpectedCombination":
      return "Will close on the EOM flag, with the descriptor open";
    case "unknown":
      return "Not readable from this image";
    case "noSwitch":
      return "No such switch in this firmware";
  }
}

const byteHex = (byte: number) => `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`;

/**
 * The board's own record — the live `/home/mca/manuf_lock` — as the two settled states or a
 * byte this reading does not know.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.manufacturingLock
 */
export function manufacturingLockText(lock: ManufacturingLock): string {
  switch (lock.kind) {
    case "locked":
      return "Locked";
    case "open":
      return "Not locked";
    case "other":
      return `Unexpected value ${byteHex(lock.byte)}`;
  }
}

/**
 * What the Manufacturing verdict was read from, as short as it can be said: "EOM: off,
 * descriptor: open". Evidence, not a second verdict; a fact the image could not supply is
 * left out rather than filled with a dash. Empty when there is nothing to say.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.manufacturingEvidence
 */
export function manufacturingEvidence(
  state: ManufacturingState,
  basis: ManufacturingBasis | undefined
): string {
  if (basis === undefined) return "";
  const clauses: string[] = [];
  if (basis.flag !== undefined) clauses.push(basis.flag ? "EOM: on" : "EOM: off");
  // The verdict names the open descriptor in its own words, so the clause would only repeat it.
  if (state !== "unexpectedCombination" && basis.descriptorOpen !== undefined) {
    clauses.push(basis.descriptorOpen ? "descriptor: open" : "descriptor: locked");
  }
  return clauses.join(", ");
}

/**
 * The profile's own name: Intel's abbreviations, kept in every language.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.profileName
 */
export function profileName(profile: BootGuardProfile): string {
  return { "0": "No_FVME", "3": "VM", "4": "FVE", "5": "FVME" }[profile];
}

/**
 * The Boot Guard profile as MFIT and MEInfo print it: the number first, because that is what a
 * technician quotes and what a fuse is burned to.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.bootGuardProfile
 */
export const bootGuardProfileText = (profile: BootGuardProfile): string =>
  `${profile} - ${profileName(profile)}`;

/**
 * Whether the platform binds its SPI part to the chipset, in the tool's own value words.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.hardwareBinding
 */
export function hardwareBindingText(value: HardwareBinding): string {
  switch (value.kind) {
    case "disabled":
      return "Disabled";
    case "enabled":
      return "Enabled";
    case "other":
      return `Unexpected value ${byteHex(value.byte)}`;
    case "notInImage":
      return "Not recorded in this image";
  }
}

/**
 * The OEM public key hash, byte by byte, or which of the three findings that are not a value
 * it is — three different states of a boot chain, which the help explains.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.oemPublicKeyHash
 */
export function oemPublicKeyHashText(value: OEMKeyHash): string {
  switch (value.kind) {
    case "hash":
      return spacedBytes(value.hex);
    case "allZeros":
      return "Not set (all zeros)";
    case "erased":
      return "Not set (the area is erased)";
    case "unrecognized":
      return "Layout not recognized";
  }
}

/**
 * A key's hex as a row shows it: **byte by byte, a space between them**, so a bench can hold
 * it against a repair tool's report without counting characters.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEABenchFactsText.swift#MEAText.spacedBytes
 */
export function spacedBytes(hex: string): string {
  return (hex.match(/.{1,2}/g) ?? []).join(" ");
}
