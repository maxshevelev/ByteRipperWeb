import type { MFSConfigDecode, MFSLowLevelFile } from "@/firmware/me/fileSystem/mfs";
import type {
  MFSPCHInit,
  MFSPCHInitChipset,
  MFSPCHInitRecord,
} from "@/firmware/me/models/fileSystemFacts";

/**
 * The chipset initialisation tables of a legacy volume's Intel Configuration —
 * upstream `mphytbl` and `pch_init_anl`.
 *
 * File 6's configuration stream lists file records named `mphytbl*`; each one's
 * content, sliced out of file 6 by the record's offset and size, is a table whose
 * first bytes name a chipset, a stepping nibble and a table revision. Which rule
 * reads the nibble is decided by the identity and the manifest's date, so this
 * runs after identification. A file-table volume never gets here.
 *
 * Ported from `Packages/MEFirmware/FileSystem/PCHInit.swift`.
 */

/**
 * `pch_dict`: chipset id → platform.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.platformLabels
 */
const PLATFORM_LABELS: Readonly<Record<number, string>> = {
  0: "LBG-H",
  3: "ICP-LP",
  4: "ICP-N",
  5: "ICP-H",
  6: "TGP-LP",
  7: "TGP/EBG-H",
  8: "SPT/KBP-LP",
  9: "SPT-H",
  11: "KBP/BSF/GCF-H",
  12: "CNP/CMP-LP",
  13: "CNP/CMP-H",
  14: "LKF-LP",
  15: "MCC-LP",
  16: "JSP-N",
  17: "EBG-H",
  18: "ADP-LP",
};

/** `pch_stp_val`: 0–15 → A–P. */
const STEPPING_LETTERS = "ABCDEFGHIJKLMNOP";

export interface PCHIdentity {
  readonly variant: string;
  readonly major: number;
  readonly minor: number;
  readonly build: number;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The tables of file 6, or nothing when its configuration lists none.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.decode
 */
export function decodePchInit(
  files: readonly MFSLowLevelFile[],
  configurations: readonly MFSConfigDecode[],
  identity: PCHIdentity
): MFSPCHInit | undefined {
  const intel = files.find((one) => one.index === 6);
  const config = configurations.find((one) => one.owningFile === 6);
  if (intel === undefined || config === undefined) return undefined;

  const records: MFSPCHInitRecord[] = [];
  for (const record of config.records) {
    if (
      record.isFolder ||
      !record.name.startsWith("mphytbl") ||
      record.size <= 0 ||
      record.offset < 0 ||
      record.offset + record.size > intel.content.length
    ) {
      continue;
    }
    const decoded = decodePchTable(
      intel.content.subarray(record.offset, record.offset + record.size),
      identity
    );
    if (decoded !== undefined) records.push(decoded);
  }
  return records.length === 0 ? undefined : { records, chipsets: aggregatePchInit(records) };
}

/**
 * One table: its chipset, its stepping letters and its revision.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.decodeTable
 */
export function decodePchTable(
  data: Uint8Array,
  identity: PCHIdentity
): MFSPCHInitRecord | undefined {
  // The new layout marks itself with two erased bytes at 4.
  const newLayout = data.length >= 6 && data[4] === 0xff && data[5] === 0xff;
  let chipsetID: number;
  let rawStep: number;
  let revision: number;
  if (newLayout) {
    if (data.length < 9) return undefined;
    chipsetID = data[7] ?? 0;
    rawStep = (data[8] ?? 0) >> 4;
    revision = data[6] ?? 0;
  } else {
    if (data.length < 4) return undefined;
    chipsetID = (data[3] ?? 0) >> 4;
    rawStep = (data[3] ?? 0) & 0xf;
    revision = data[2] ?? 0;
  }

  let chipset = PLATFORM_LABELS[chipsetID] ?? "Unknown";
  let stepping = "";
  const { variant, major, minor, build } = identity;
  const is = (v: string, m: number) => variant === v && major === m;
  const date = dateKey(identity.year, identity.month, identity.day);

  // Upstream's branch order, kept.
  if (is("CSSPS", 4) && minor === 4) {
    stepping = absolute(rawStep);
    chipset = "WTL";
  } else if (is("CSME", 11) || is("CSSPS", 4)) {
    // Before 2015-05-19 the stepping is unreliable, and stays unsaid.
    if (date >= dateKey(2015, 5, 19)) stepping = absolute(rawStep);
  } else if (is("CSME", 12) || is("CSSPS", 5)) {
    stepping = date >= dateKey(2018, 1, 25) ? bitfield(rawStep) : absolute(rawStep);
  } else if (is("CSME", 15) && minor === 40) {
    stepping =
      build >= 1000 && build < 7000
        ? (STEPPING_LETTERS[Math.floor(build / 1000) - 1] ?? "")
        : absolute(rawStep);
  } else if (is("CSME", 13) || is("CSME", 15) || is("CSME", 16) || is("CSSPS", 6)) {
    stepping = newLayout ? absolute(rawStep) : bitfield(rawStep);
  } else if (is("CSME", 14) && minor === 5) {
    stepping = absolute(rawStep);
    chipset = "CMP-V";
  } else if (is("CSME", 14)) {
    stepping = bitfield(rawStep);
  }
  return { chipset, stepping, revision };
}

/**
 * Each chipset in first-appearance order, with the union of its tables' letters
 * sorted highest first. Nothing when the first table decoded no stepping — the
 * early return upstream makes.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.aggregate
 */
export function aggregatePchInit(records: readonly MFSPCHInitRecord[]): MFSPCHInitChipset[] {
  const first = records[0];
  if (first === undefined || first.stepping.length === 0) return [];
  const letters = new Map<string, string>();
  for (const record of records) {
    letters.set(record.chipset, (letters.get(record.chipset) ?? "") + record.stepping);
  }
  return [...letters].map(([chipset, all]) => ({
    chipset,
    steppings: [...new Set(all)].sort().reverse().join(""),
  }));
}

const absolute = (rawStep: number): string => STEPPING_LETTERS[rawStep & 0xf] ?? "";

/** The set bits high to low as D, C, B, A; none set is A. */
function bitfield(rawStep: number): string {
  let result = "";
  for (let index = 0; index < 4; index++) {
    if ((rawStep & (1 << (3 - index))) !== 0) result += "DCBA"[index];
  }
  return result.length === 0 ? "A" : result;
}

const dateKey = (year: number, month: number, day: number): number =>
  year * 10_000 + month * 100 + day;
