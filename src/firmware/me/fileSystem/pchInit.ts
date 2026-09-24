import type { FileTable } from "@/firmware/me/data/fileTable";
import {
  decodeConfigIDRecords,
  decodeConfigRecords,
  type MFSConfigDecode,
  type MFSConfigIDDecode,
  type MFSLowLevelFile,
  type MFSRawConfigIDRecord,
} from "@/firmware/me/fileSystem/mfs";
import type {
  MFSPCHInit,
  MFSPCHInitChipset,
  MFSPCHInitRecord,
} from "@/firmware/me/models/fileSystemFacts";

/**
 * The chipset initialisation tables of an Intel Configuration stream — upstream
 * `mphytbl` and `pch_init_anl`.
 *
 * A configuration stream is a list of *file* records over one blob of bytes:
 * each record says where its file's content sits inside that same blob. A
 * record named `mphytbl*` is a chipset init table, whose first bytes name a
 * chipset, a stepping nibble and a table revision. Which rule reads the nibble
 * is decided by the identity and the manifest's date, so this runs after
 * identification.
 *
 * Three streams carry one, and upstream reads all three through the same
 * `mfs_cfg_anl`:
 *
 * - the MFS volume's low-level file 6 in the **named** (0x1C) layout (CSME
 *   11/12 and their analogues), whose records spell the file name themselves;
 * - the same file 6 in the **ID-keyed** (0xC) layout (CSME 13–16), whose
 *   records carry a File ID and are named by the `FTBL` row `FileTable.dat`
 *   keys under it;
 * - the FTPR `$CPD` module **`intl.cfg`**, which is file 6 kept as a module.
 *
 * The third one *wins*: upstream prefers the FTPR copy over the MFS one and
 * overwrites `pch_init_final` with whatever it yields, empty included (MEA.py
 * 5999–6009). That is the only source a CSME 15/16 image has — its FTBL volume
 * carries no file 6 at all, which is why those images read no chipset until
 * `intl.cfg` is read.
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
 * One configuration record reduced to what the chipset scan needs: what the
 * file is called, and where its bytes sit in the stream carrying it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.NamedRecord
 */
interface NamedRecord {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

/** How the ID-keyed layouts look a record's name up in `FileTable.dat`. */
export interface PCHNaming {
  readonly fileTable: FileTable | undefined;
  readonly platform: number;
  readonly dictionary: number;
}

/**
 * The **named** (0x1C) Intel Configuration of an MFS volume: low-level file 6
 * and the records the volume decode already read out of it. Nothing when the
 * volume carries no file 6, no configuration owned by it, or no `mphytbl*`
 * record in it.
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
  const records = config.records
    .filter((one) => !one.isFolder)
    .map((one) => ({ name: one.name, offset: one.offset, size: one.size }));
  return decodeStream(intel.content, records, identity);
}

/**
 * The **ID-keyed** (0xC) Intel Configuration of an MFS volume: the same
 * low-level file 6, whose records name nothing themselves — the `FTBL` row
 * `FileTable.dat` keys under each record's File ID does (upstream
 * `mfs_cfg_anl`'s 0xC branch, MEA.py 8546). Without a table no record can be
 * recognised as a chipset table, and the answer is nothing rather than a guess.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.decode
 */
export function decodePchInitByID(
  files: readonly MFSLowLevelFile[],
  configurationsByID: readonly MFSConfigIDDecode[],
  naming: PCHNaming,
  identity: PCHIdentity
): MFSPCHInit | undefined {
  const intel = files.find((one) => one.index === 6);
  const config = configurationsByID.find((one) => one.owningFile === 6);
  if (intel === undefined || config === undefined) return undefined;
  return decodeStream(intel.content, named(config.records, naming), identity);
}

/**
 * An Intel Configuration read straight off its own bytes — the FTPR `$CPD`
 * module `intl.cfg`, which upstream hands to `mfs_cfg_anl` exactly as it hands
 * it a volume's file 6 (MEA.py 6008). `recordSize` is the identity's own
 * `get_cfg_rec_size`: the 0xC layout needs the file table to name its records,
 * the 0x1C one does not.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.decode
 */
export function decodePchInitStream(
  stream: Uint8Array,
  recordSize: number,
  naming: PCHNaming,
  identity: PCHIdentity
): MFSPCHInit | undefined {
  const records =
    recordSize === 0x1c
      ? (decodeConfigRecords(stream) ?? [])
          .filter((one) => !one.isFolder)
          .map((one) => ({ name: one.name, offset: one.offset, size: one.size }))
      : named(decodeConfigIDRecords(stream) ?? [], naming);
  return decodeStream(stream, records, identity);
}

/**
 * What `FileTable.dat` calls each ID-keyed record's file, as the *base name*
 * upstream tests (`rec_name = os.path.basename(rec_file)`, MEA.py 8552). A
 * record the table has no row for reads as upstream's own `/Unknown/<ID>.bin`
 * fallback, which no chipset table is ever called.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.named
 */
function named(
  records: readonly MFSRawConfigIDRecord[],
  naming: PCHNaming
): readonly NamedRecord[] {
  return records.map((record) => {
    const path = naming.fileTable?.recordForFileID(
      record.fileID,
      naming.platform,
      naming.dictionary
    )?.path;
    const name =
      path === undefined
        ? `${record.fileID.toString(16).toUpperCase().padStart(8, "0")}.bin`
        : (path.split("/").at(-1) ?? "");
    return { name, offset: record.offset, size: record.size };
  });
}

/**
 * One configuration stream → the Chipset Initialization Table facts. Nothing
 * when the stream holds no `mphytbl*` file with bytes behind it: upstream's
 * `pch_init_info` then stays empty and `pch_init_anl` returns its empty list.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/FileSystem/PCHInit.swift#PCHInitDecoder.decode
 */
function decodeStream(
  stream: Uint8Array,
  records: readonly NamedRecord[],
  identity: PCHIdentity
): MFSPCHInit | undefined {
  const decoded: MFSPCHInitRecord[] = [];
  for (const record of records) {
    if (
      !record.name.startsWith("mphytbl") ||
      record.size <= 0 ||
      record.offset < 0 ||
      record.offset + record.size > stream.length
    ) {
      continue;
    }
    const table = decodePchTable(
      stream.subarray(record.offset, record.offset + record.size),
      identity
    );
    if (table !== undefined) decoded.push(table);
  }
  return decoded.length === 0
    ? undefined
    : { records: decoded, chipsets: aggregatePchInit(decoded) };
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
