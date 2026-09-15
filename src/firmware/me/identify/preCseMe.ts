import { find, has, tagBytes, u16 } from "@/firmware/me/bytes";

/**
 * The classic ME 2–10 `$SKU` attributes — the summary's `SKU` and `Chipset
 * Support` rows — plus the two other facts only a pre-CSE image carries: its
 * production-ready bit and, on ME 7, the downgrade blacklist.
 *
 * The `$SKU` sits a short way after the operational manifest and is found by
 * scanning for `$SKU[\x03-\x04]\x00\x00\x00`. Its eight attribute bytes are read
 * the way upstream's big-endian ctypes bitfields read them: `Value1` is bytes
 * 0–2, the ME 7 slim flag is byte 3's top bit, Patsburg + SKU Type (3 bits) + SKU
 * Size (4 bits, in half megabytes) are byte 4, and `Value10` is bytes 5–7. ME 2–6
 * use the top four bytes as one big-endian word instead, and map constants.
 *
 * Ported from `Packages/MEFirmware/Identify/PreCSEME.swift`.
 */

const SKU_TAG = tagBytes("$SKU");
const DAT_TAG = tagBytes("$DAT");
const IFRP_TAG = tagBytes("IFRP");

/**
 * The decoded `$SKU` header and its attribute split.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes
 */
export interface SKUAttributes {
  /**
   * Region-relative offset of the tag.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.offset
   */
  readonly offset: number;
  /**
   * 3 (ME 2–6) or 4 (ME 7–10).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.sizeDwords
   */
  readonly sizeDwords: number;
  /**
   * The top four attribute bytes, big-endian — ME 2–6 only.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.skuMe
   */
  readonly skuMe: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.value1 */
  readonly value1: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.slim */
  readonly slim: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.patsburg */
  readonly patsburg: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.skuType */
  readonly skuType: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.skuSize */
  readonly skuSize: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Attributes.value10 */
  readonly value10: number;
}

/**
 * The summary rows the `$SKU` fills. Independent of each other: a part may carry
 * a platform yet an unrecognised SKU, or the other way round.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Summary
 */
export interface PreCSESummary {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Summary.sku */
  readonly sku: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Summary.platform */
  readonly platform: string | undefined;
  /**
   * The Patsburg bit, which only ME 7–8 give a meaning to.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.Summary.patsburgSupport
   */
  readonly patsburgSupport: boolean | undefined;
}

/**
 * One blacklist entry: the minor, hotfix and build of the newest refused firmware.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.BlacklistEntry
 */
export interface BlacklistEntry {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.BlacklistEntry.minor */
  readonly minor: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.BlacklistEntry.hotfix */
  readonly hotfix: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.BlacklistEntry.build */
  readonly build: number;
}

/**
 * The two Downgrade Blacklist entries of an ME 7 manifest, at fixed offsets from
 * its tag — 0x6DF and 0x6EB past upstream's `start_man_match`, the byte before
 * the tag, which is this engine's manifest base plus 0x1B. A zero build word is
 * upstream's "Empty": nothing blacklisted on that line.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.downgradeBlacklist
 */
export function downgradeBlacklist(
  bytes: Uint8Array,
  manifestBase: number
): {
  readonly sevenZero: BlacklistEntry | undefined;
  readonly sevenOne: BlacklistEntry | undefined;
} {
  const tag = manifestBase + 0x1b;
  return { sevenZero: entry(bytes, tag + 0x6df), sevenOne: entry(bytes, tag + 0x6eb) };
}

function entry(bytes: Uint8Array, at: number): BlacklistEntry | undefined {
  if (!has(bytes, at, 6)) return undefined;
  const build = u16(bytes, at + 4);
  if (build === 0) return undefined;
  return { minor: u16(bytes, at), hotfix: u16(bytes, at + 2), build };
}

/**
 * The production-ready bit of a pre-CSE ME 8–10 or TXE image: past the manifest
 * sits a `$DAT` marker — the tag, twenty bytes, then `IFRP` — and the byte 0x10
 * into that match is the bit. Nothing when the marker is not there.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.productionReady
 */
export function preCseProductionReady(
  bytes: Uint8Array,
  manifestBase: number
): boolean | undefined {
  const tagOffset = manifestBase + 0x1b;
  if (tagOffset < 0 || tagOffset >= bytes.length) return undefined;
  let scan = tagOffset;
  for (;;) {
    const start = find(bytes, DAT_TAG, scan, bytes.length);
    if (start < 0) return undefined;
    const tail = start + 4 + 20;
    if (tail + 4 > bytes.length) return undefined;
    if (find(bytes, IFRP_TAG, tail, tail + 4) === tail) return (bytes[start + 0x10] ?? 0) !== 0;
    scan = start + 1;
  }
}

/**
 * The first `$SKU` attributes after the manifest, mapped to the summary rows.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.summary
 */
export function preCseSummary(options: {
  readonly bytes: Uint8Array;
  readonly manifestBase: number;
  readonly major: number;
  readonly minor: number;
  readonly hotfix: number;
  readonly build: number;
}): PreCSESummary | undefined {
  const attributes = scanSkuAttributes(options.bytes, options.manifestBase);
  return attributes === undefined ? undefined : mapSummary(attributes, options);
}

/**
 * Locates and decodes the first plausible `$SKU` after `manifestBase`.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Identify/PreCSEME.swift#PreCSEME.scan
 */
export function scanSkuAttributes(
  bytes: Uint8Array,
  manifestBase: number
): SKUAttributes | undefined {
  let low = Math.min(Math.max(manifestBase, 0), bytes.length);
  while (low + 12 <= bytes.length) {
    const at = find(bytes, SKU_TAG, low, bytes.length);
    if (at < 0 || at + 12 > bytes.length) return undefined;
    const sizeByte = bytes[at + 4] ?? 0;
    if (
      (sizeByte !== 3 && sizeByte !== 4) ||
      bytes[at + 5] !== 0 ||
      bytes[at + 6] !== 0 ||
      bytes[at + 7] !== 0 ||
      bytes.length < at + 16
    ) {
      // A `$SKU` not followed by an attributes header — keep scanning.
      low = at + 1;
      continue;
    }
    const b = (index: number) => bytes[at + 8 + index] ?? 0;
    return {
      offset: at,
      sizeDwords: sizeByte,
      skuMe: ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0,
      value1: (b(0) << 16) | (b(1) << 8) | b(2),
      slim: (b(3) & 0x80) !== 0,
      patsburg: (b(4) & 0x80) !== 0,
      skuType: (b(4) >> 4) & 0x7,
      skuSize: b(4) & 0xf,
      value10: (b(5) << 16) | (b(6) << 8) | b(7),
    };
  }
  return undefined;
}

const summary = (
  sku: string | undefined,
  platform: string | undefined,
  patsburgSupport?: boolean
): PreCSESummary => ({ sku, platform, patsburgSupport });

/** Each major's own SKU and platform, from the constants or the bitfield. */
function mapSummary(
  a: SKUAttributes,
  version: {
    readonly major: number;
    readonly minor: number;
    readonly hotfix: number;
    readonly build: number;
  }
): PreCSESummary {
  const { major, minor, hotfix, build } = version;
  const me = a.skuMe;
  switch (major) {
    case 2: // ICH8 / ICH8M
      return summary(
        me === 0x0000_0000 ? "AMT" : me === 0x0200_0000 ? "QST" : undefined,
        minor >= 5 ? "ICH8M" : "ICH8"
      );
    case 3: {
      // ICH9 / ICH9DO
      let sku: string | undefined;
      if (me === 0x0e00_0000 || me === 0x0000_0000) sku = "AMT";
      else if (me === 0x0600_0000) sku = "ASF";
      else if (me === 0x0200_0000) sku = "QST";
      return summary(sku, "ICH9");
    }
    case 4: {
      // ICH9M / ICH9M-E
      let sku: string | undefined;
      if (me === 0xac20_0000 || me === 0xac00_0000 || me === 0x0400_0000) sku = "AMT + TPM";
      else if (me === 0x8c20_0000 || me === 0x8c00_0000 || me === 0x0c00_0000) sku = "AMT";
      else if (me === 0xa020_0000 || me === 0xa000_0000) sku = "TPM";
      return summary(sku, "ICH9M");
    }
    case 5: {
      // ICH10D / ICH10DO
      let sku: string | undefined;
      if (me === 0x3e08_0000) sku = "Digital Office";
      else if (me === 0x060d_0000) sku = "Base Consumer";
      else if (me === 0x0608_0000) sku = "Digital Home or Base Corporate (?)";
      return summary(sku, "ICH10");
    }
    case 6: {
      // Ibex Peak
      const ignition = me === 0x0000_0000;
      let sku: string | undefined;
      if (ignition) sku = hotfix === 50 ? "Ignition CCK" : "Ignition IBX";
      else if (me === 0x701c_0000) sku = "1.5MB";
      else if (me === 0x77dc_ee00 || me === 0x77fc_ee00 || me === 0xf7fe_fe00) sku = "5MB MB";
      else if (me === 0x77dc_6e00 || me === 0x77fc_6e00 || me === 0xf7fe_7e00) sku = "5MB DT";
      return summary(sku, ignition && hotfix === 50 ? "CCK" : "IBX");
    }
    case 7: {
      // Cougar Point
      let sku: string | undefined;
      if (a.slim) sku = "Slim";
      else if (a.skuSize === 3) sku = "1.5MB";
      else if (
        a.skuSize === 10 ||
        (build === 1041 && hotfix === 0 && minor === 0 && a.skuSize === 1)
      ) {
        sku = "5MB";
      }
      return summary(sku, a.patsburg ? "CPT/PBG" : "CPT", a.patsburg);
    }
    case 8: // Panther Point
      return summary(
        a.skuSize === 3 ? "1.5MB" : a.skuSize === 10 ? "5MB" : undefined,
        "CPT/PBG/PPT",
        a.patsburg
      );
    case 9: {
      // Lynx Point / Wildcat Point / Lynx Point-LP
      let platform: string | undefined;
      if (minor === 0) platform = "LPT";
      else if (minor === 1) platform = "LPT/WPT";
      else if (minor === 5 || minor === 6) platform = "LPT-LP";
      return summary(skuTypeLabel(a.skuType), platform);
    }
    case 10: // Wildcat Point-LP
      return summary(skuTypeLabel(a.skuType), minor === 0 ? "WPT-LP" : undefined);
    default:
      return summary(undefined, undefined);
  }
}

/** The ME 9/10 SKU Type label. */
function skuTypeLabel(skuType: number): string | undefined {
  switch (skuType) {
    case 0:
      return "5MB";
    case 1:
      return "1.5MB";
    case 2:
      return "Slim";
    default:
      return undefined;
  }
}
