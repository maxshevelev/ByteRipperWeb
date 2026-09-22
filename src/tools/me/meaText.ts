import type { ManifestFormat } from "@/firmware/me/layout/manifest";
import type { FirmwareFamily, FWUpdateSupport } from "@/firmware/me/models/firmwareFacts";

/**
 * The one voice behind every label and value the ME panel shows — the summary,
 * the tree's second column, the detail. Ported from upstream's `MEAText`.
 *
 * Offsets are bare uppercase hex; sizes carry their decimal byte count; flags
 * and CRCs are padded to their width.
 */

const upper = (value: number) => value.toString(16).toUpperCase();
const pad = (value: number, width: number) => String(value).padStart(width, "0");

/**
 * `0x`-prefixed, no padding — offsets and small counts.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.hex
 */
export const hex = (value: number): string => `0x${upper(value)}`;
/**
 * Padded to one byte, e.g. an extension tag.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.hexByte
 */
export const hexByte = (value: number): string => `0x${upper(value).padStart(2, "0")}`;
/**
 * Padded to two bytes, e.g. a BPDT partition type.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.hex16
 */
export const hex16 = (value: number): string => `0x${upper(value).padStart(4, "0")}`;
/**
 * Padded to four bytes, e.g. a region's flags word.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.hex32
 */
export const hex32 = (value: number): string => `0x${upper(value >>> 0).padStart(8, "0")}`;

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.offset */
export const offsetText = hex;

/**
 * A byte count in hex and in decimal, so neither has to be worked out from the
 * other. Zero is not worth two spellings: the area holds nothing, and says so.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.size
 */
export const sizeText = (value: number): string =>
  value === 0 ? "Empty" : `${hex(value)} (${value} bytes)`;

/**
 * The compact second line `0x… · 0x…` (offset · size).
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.range
 */
export const rangeText = (offset: number, size: number): string =>
  `${hex(offset)} · ${size === 0 ? "Empty" : hex(size)}`;

/**
 * The file range a row stands for; nothing when there are no bytes.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.rangeValue
 */
export function rangeValue(
  offset: number,
  size: number
): { readonly start: number; readonly end: number } | undefined {
  return offset >= 0 && size > 0 ? { start: offset, end: offset + size } : undefined;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.count */
export function countText(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  return noun.endsWith("y") ? `${count} ${noun.slice(0, -1)}ies` : `${count} ${noun}s`;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.yesNo */
export const yesNo = (value: boolean): string => (value ? "Yes" : "No");

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.family */
export function familyText(family: FirmwareFamily): string {
  switch (family) {
    case "me":
      return "ME";
    case "csme":
      return "CSME";
    case "txe":
      return "TXE";
    case "cstxe":
      return "CSTXE";
    case "sps":
      return "SPS";
    case "cssps":
      return "CSSPS";
    case "gsc":
      return "GSC";
    case "pmc":
      return "PMC";
    case "pchc":
      return "PCHC";
    case "phy":
      return "PHY";
    case "orom":
      return "OROM";
    case "unknown":
      return "Unknown";
  }
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.manifestFormat */
export function manifestFormatText(format: ManifestFormat): string {
  switch (format as string) {
    case "r0":
      return "R0";
    case "r1":
      return "R1";
    case "r2":
      return "R2";
    default:
      return "Unknown";
  }
}

/**
 * A one-word enum value as a word, with the few camel-case ones by hand.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.title
 */
export function titleText(value: string): string {
  switch (value) {
    case "production":
      return "Production";
    case "preProduction":
      return "Pre-production";
    case "romBypass":
      return "ROM Bypass";
    default:
      return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1);
  }
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.version */
export const plainVersion = (major: number, minor: number, hotfix: number, build: number): string =>
  `${major}.${minor}.${hotfix}.${build}`;

/**
 * A firmware version as upstream writes it, which is not one shape for every
 * family: an (CS)SPS pads every field, a PMC whichever field its platform
 * generation keeps at two digits, a PCHC or PHY its build to four. Keyed by the
 * variant token, which is what tells `PMCADP` from `PMCDG2`.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.firmwareVersion
 */
export function firmwareVersionText(
  variant: string,
  major: number,
  minor: number,
  hotfix: number,
  build: number
): string {
  if (variant === "SPS" || variant === "CSSPS") {
    return `${pad(major, 2)}.${pad(minor, 2)}.${pad(hotfix, 2)}.${pad(build, 3)}`;
  }
  if (["PMCAPL", "PMCBXT", "PMCGLK", "PMCDG"].some((one) => variant.startsWith(one))) {
    return plainVersion(major, minor, hotfix, build);
  }
  if (
    ["PMCCNP", "PMCWTL", "PMCIDV"].some((one) => variant.startsWith(one)) &&
    (major < 30 || major === 3232)
  ) {
    return `${pad(major, 2)}.${minor}.${hotfix}.${build}`;
  }
  if (variant.startsWith("PMC")) return `${major}.${minor}.${pad(hotfix, 2)}.${build}`;
  if (variant.startsWith("PCHC") || variant.startsWith("PHY")) {
    return `${major}.${minor}.${hotfix}.${pad(build, 4)}`;
  }
  return plainVersion(major, minor, hotfix, build);
}

/**
 * The Manifest Extension Utility version, its build padded to four as the console prints it.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.manifestExtensionUtility
 */
export const meuText = (major: number, minor: number, hotfix: number, build: number): string =>
  `${major}.${minor}.${hotfix}.${pad(build, 4)}`;

/**
 * Each letter of a stepping record is a stepping of its own: "BA" is B and A.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.chipsetStepping
 */
export const chipsetSteppingText = (letters: string): string => [...letters].join(", ");

/**
 * The two-bit storage field: 0 Undefined, 1 UFS, 2 SPI, and anything else as itself.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.nvmCompatibility
 */
export function nvmCompatibilityText(raw: number): string {
  switch (raw) {
    case 0:
      return "Undefined";
    case 1:
      return "UFS";
    case 2:
      return "SPI";
    default:
      return `Unknown (${raw})`;
  }
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.date */
export const dateText = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/**
 * A Downgrade Blacklist entry as upstream writes it — `<= 7.1.2.1000` — the newest
 * firmware of that ME 7 line the image refuses to be downgraded to. The row's own
 * label names the line, so the major is always 7.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.downgradeBlacklist
 */
export const downgradeBlacklistText = (entry: {
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}): string => `<= 7.${entry.minor}.${entry.hotfix}.${entry.build}`;

/**
 * "Impossible" is upstream's own word for an image no added partition would make updatable.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAValueText.swift#MEAText.fwUpdateSupport
 */
export function fwUpdateSupportText(value: FWUpdateSupport): string {
  switch (value) {
    case "yes":
      return "Yes";
    case "no":
      return "No";
    case "impossible":
      return "Impossible";
  }
}
