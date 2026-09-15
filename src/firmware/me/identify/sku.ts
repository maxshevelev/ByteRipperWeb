/**
 * The CSME `SKU` row — "Consumer H" and its kind. A faithful port of three
 * upstream pieces:
 *
 * - the SKU-type selection: the label from `CSE_Ext_0C`'s SKU Type unless
 *   `CSE_Ext_0F_R2` carries a *meaningful* Firmware SKU. The revised block's
 *   reserved and early placeholder values (`CON`, `COR`, `NA`, `ALL`) are
 *   ignored, so the real `0x0C` value wins.
 * - the database cells: the matched MEA.dat row supplies the PCH platform, and
 *   on CSME 12 and newer a match *overrides* the extension-derived platform.
 * - the platform letter: with no row, the CSME 12.0.0 alpha's SKU Platform
 *   field, else the capability bits 8 `H` / 9 `LP`, with the CSME 14.5 `H → V`
 *   and CSME 13 Slim `LP → N` corrections on that last path.
 *
 * CSME 11 composes the same label with a letter of its own: from 11.0.0.1205 the
 * `CSE_Ext_0C` SKU Platform field says it (0 Halo, 1 Low Power), and only an
 * older build sends upstream into the Huffman-decompressed `kernel` module for a
 * byte pattern — not ported, so such a firmware falls back to its database row,
 * as upstream's last resort does. The order is the other way round from CSME 12+:
 * there the database overrides the extensions, here it only fills in for them.
 *
 * Ported from `Packages/MEFirmware/Identify/SKU.swift`.
 */

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Label */
interface Label {
  readonly display: string;
  readonly code: string;
}

const label = (display: string, code: string): Label => ({ display, code });

/** `CSE_Ext_0C` SKU Type → label. */
const EXT12: Readonly<Record<number, Label>> = {
  0: label("Corporate", "COR"),
  1: label("Consumer", "CON"),
  2: label("Slim", "SLM"),
  3: label("Server", "SVR"),
  5: label("Chrome", "CHR"),
};

/** `CSE_Ext_0F_R2` Firmware SKU → label. */
const EXT15: Readonly<Record<number, Label>> = {
  0: label("Undefined", "NA"),
  1: label("Corporate", "COR"),
  2: label("Consumer", "CON"),
  3: label("Slim", "SLM"),
  4: label("Lite", "LIT"),
  5: label("Server", "SVR"),
  6: label("Atom", "ATM"),
  255: label("All", "ALL"),
};

const NONE = label("", "");
const UNKNOWN = label("Unknown", "UNK");

/**
 * The decoded facts the composition needs.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts
 */
export interface SKUFacts {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.variant */
  readonly variant: string;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.major */
  readonly major: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.build */
  readonly build: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.year */
  readonly year: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.month */
  readonly month: number;
  /**
   * `CSE_Ext_0C` SKU Type; nothing when the chain carries no 0x0C.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.skuType
   */
  readonly skuType: number | undefined;
  /**
   * `CSE_Ext_0C` capabilities, raw.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.skuCaps
   */
  readonly skuCaps: number | undefined;
  /**
   * `CSE_Ext_0C` SKU Platform; only meaningful for CSME 11 and the 12.0.0 alpha.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.skuPlatform
   */
  readonly skuPlatform: number | undefined;
  /**
   * `CSE_Ext_0F_R2` Firmware SKU; nothing when 0x0F is absent or unrevised.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.fwSku
   */
  readonly fwSku: number | undefined;
  /**
   * The matched MEA.dat firmware row.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.Facts.databaseRow
   */
  readonly databaseRow: string | undefined;
}

/**
 * The CSME `SKU` text, or nothing when there is no determinate value.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/SKU.swift#SKU.csme
 */
export function csmeSku(facts: SKUFacts): string | undefined {
  if (facts.variant !== "CSME" || facts.major < 11) return undefined;

  // Absent blocks read as an empty label, so a genuine "no 0x0C, no 0x0F" chain
  // yields nothing to name the SKU with.
  const oc = facts.skuType === undefined ? NONE : (EXT12[facts.skuType] ?? UNKNOWN);
  const of = facts.fwSku === undefined ? NONE : (EXT15[facts.fwSku] ?? UNKNOWN);

  let type: Label;
  if (oc.code !== "UNK" && ["", "NA", "ALL", "CON", "COR", "ATM"].includes(of.code)) {
    type = oc;
  } else if (!["", "NA", "ALL"].includes(of.code)) {
    type = of;
  } else {
    type = UNKNOWN;
  }
  if (type.display.length === 0) return undefined;

  if (facts.major === 11) {
    const letter = csme11Platform(facts);
    return letter === undefined ? undefined : `${type.display} ${letter}`;
  }

  let platform: string;
  if (facts.databaseRow !== undefined) {
    // A database match overrides every extension source.
    platform = platformCell(facts.databaseRow) ?? "Unknown";
  } else if (isCSME12Alpha(facts)) {
    platform = halfLetter(facts.skuPlatform) ?? "Unknown";
  } else {
    // LP wins when both bits are set: upstream checks it first.
    const caps = facts.skuCaps;
    if (caps !== undefined && (caps & (1 << 9)) !== 0) platform = "LP";
    else if (caps !== undefined && (caps & (1 << 8)) !== 0) platform = "H";
    else platform = "Unknown";
    // Corrections applied only on this extension-derived path.
    if (facts.major === 14 && facts.minor === 5 && platform === "H") platform = "V";
    else if (facts.major === 13 && type.display === "Slim" && platform === "LP") platform = "N";
  }
  return `${type.display} ${platform}`;
}

/** 0 Halo, 1 Low Power. */
const halfLetter = (value: number | undefined): string | undefined =>
  value === 0 ? "H" : value === 1 ? "LP" : undefined;

/**
 * CSME 11's letter: the extension on 11.0.0.1205 and later, else the database
 * row's own cell. Nothing when neither says one.
 */
function csme11Platform(facts: SKUFacts): string | undefined {
  const extensionSaysIt =
    facts.minor > 0 || facts.hotfix > 0 || (facts.build >= 1205 && facts.build !== 7101);
  if (extensionSaysIt) {
    const letter = halfLetter(facts.skuPlatform);
    if (letter !== undefined) return letter;
  }
  return facts.databaseRow === undefined ? undefined : platformCell(facts.databaseRow);
}

/** The PCH platform cell of a CSME database row. */
function platformCell(row: string): string | undefined {
  const cells = row.split("_");
  const cell = cells[2];
  return cells.length > 2 && cell !== undefined && cell.length > 0 ? cell : undefined;
}

/**
 * The CSME 12.0.0 alpha gate: pre-2018-08 engineering builds read the platform
 * from the SKU Platform field instead of the capabilities. The year is compared
 * with 0x2018 exactly as upstream compares it.
 */
function isCSME12Alpha(facts: SKUFacts): boolean {
  return (
    facts.major === 12 &&
    facts.minor === 0 &&
    facts.hotfix === 0 &&
    facts.build >= 7000 &&
    facts.year < 0x2018 &&
    facts.month < 8
  );
}
