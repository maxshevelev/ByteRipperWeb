import type {
  EfsTableEntry,
  FileTable,
  FileTableEntry,
  FileTableResolution,
} from "@/firmware/me/data/fileTable";
import type { EFSVolume } from "@/firmware/me/models/fileSystemFacts";

/**
 * What an EFS volume's files are called, and what the file table says about
 * them, looked up in `FileTable.dat` (upstream `efs_anl`, MEA.py 8817).
 *
 * An EFS volume needs *two* tables, which is what makes this a value of its own
 * rather than the MFS lookup with another key. `EFST` says where each file sits
 * in the volume's data area and what it is called; the `FTBL` rows beside it —
 * keyed by the same file ID — hold the path and the Integrity flag. The engine
 * has already used the halves it needs to cut the data area into files
 * (`EFSVolume.files`); what is looked up here is the text, which the result
 * model never carries: the name, the path and the flags the table states about
 * each file.
 *
 * `NO_EFS_NAMES` is a panel with nothing looked up: before the table arrives,
 * and on a machine that cannot reach the database. The engine's file list is
 * then empty too — a volume whose pages carry no directory has nothing to list
 * without the table — so there is nothing to name.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames
 */
export interface EFSFileNames {
  /**
   * File ID → the `EFST` record that names it.
   *
   * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.names
   */
  readonly names: ReadonlyMap<number, EfsTableEntry>;
  /**
   * File ID → the `FTBL` record that gives it a path and its flags. Missing
   * where no row claims the file — upstream prints an error and stores the file
   * anyway (MEA.py 8936), and the row here keeps its name.
   *
   * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.records
   */
  readonly records: ReadonlyMap<number, FileTableEntry>;
  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the MFS volume beside this one. Nothing when nothing
   * was looked up.
   *
   * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.resolution
   */
  readonly resolution: FileTableResolution | undefined;
  /**
   * The table revision the EFS System page names (`dictionaryRevision`).
   *
   * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.revision
   */
  readonly revision: number | undefined;
  /**
   * Whether that platform and dictionary carry an `EFST` at all, so the panel
   * can tell "no table for this volume" from "a table that named nothing in
   * it".
   *
   * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.hasTable
   */
  readonly hasTable: boolean;
}

/**
 * Nothing looked up.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.none
 */
export const NO_EFS_NAMES: EFSFileNames = {
  names: new Map(),
  records: new Map(),
  resolution: undefined,
  revision: undefined,
  hasTable: false,
};

/**
 * The names for one volume, looked up once up front.
 *
 * `platform` and `dictionary` are the **MFS** volume's, not this volume's own
 * Dictionary field: upstream hands `efs_anl` the values it read out of the MFS
 * volume header (MEA.py 5618), and the EFS page's Dictionary is only checked
 * against them (`matchesMFSDictionary`). −1 for either means no MFS volume
 * decoded alongside, which the table's own fallbacks then answer.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.init
 */
export function efsFileNames(
  table: FileTable,
  volume: EFSVolume,
  platform: number,
  dictionary: number
): EFSFileNames {
  if (table.isEmpty) return NO_EFS_NAMES;
  const resolution = table.resolve(platform, dictionary);
  const revision = volume.dictionaryRevision;
  const hasTable = table.hasEfst(resolution.platform, resolution.dictionary);
  const entries = table.efsEntries(resolution.platform, resolution.dictionary, revision) ?? [];
  const names = new Map<number, EfsTableEntry>();
  const records = new Map<number, FileTableEntry>();
  for (const entry of entries) {
    names.set(entry.fileId, entry);
    const record = table.recordNamingFileIndex(
      entry.fileId,
      resolution.platform,
      resolution.dictionary
    );
    if (record !== undefined) records.set(entry.fileId, record);
  }
  return { names, records, resolution, revision, hasTable };
}

/**
 * True when the lookup named nothing — no `EFST` for this volume, or none at
 * its revision.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.isEmpty
 */
export const efsNamesNothing = (names: EFSFileNames): boolean => names.names.size === 0;

/**
 * What the file is called, e.g. `BUP_MBP`.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.name
 */
export const efsNameFor = (names: EFSFileNames, fileId: number): string | undefined =>
  names.names.get(fileId)?.name;

/**
 * The `FTBL` row that describes the file, or nothing where none claims it.
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.record
 */
export const efsRecordFor = (names: EFSFileNames, fileId: number): FileTableEntry | undefined =>
  names.records.get(fileId);

/**
 * How the tables the rows were read from are named on the volume's own row: the
 * platform and dictionary in the form the file keys them by, the table revision
 * the volume asked for, and a word when either half was assumed rather than
 * named by the MFS volume (upstream warns in the same place — `check_ftbl_pl` /
 * `check_ftbl_id`).
 *
 * @upstream Modules/MEATool/Sources/MEATool/EFSFileNames.swift#EFSFileNames.tableLabel
 */
export function efsTableLabel(names: EFSFileNames): string | undefined {
  const resolution = names.resolution;
  const revision = names.revision;
  if (resolution === undefined || revision === undefined) return undefined;
  const digits = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
  const text = `${digits(resolution.platform)} / ${digits(resolution.dictionary)} rev ${digits(revision)}`;
  if (!names.hasTable) return `${text} — no EFST in FileTable.dat`;
  if (names.names.size === 0) return `${text} — no EFST at that revision`;
  const assumed = [
    resolution.assumedPlatform ? "platform" : undefined,
    resolution.assumedDictionary ? "dictionary" : undefined,
  ].filter((one): one is string => one !== undefined);
  return assumed.length === 0 ? text : `${text} (assumed ${assumed.join(" and ")})`;
}
