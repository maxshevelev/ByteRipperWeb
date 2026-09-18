import type { FileTable, FileTableEntry, FileTableResolution } from "@/firmware/me/data/fileTable";
import type { MFSVolume } from "@/firmware/me/models/fileSystemFacts";

/**
 * What an FTBL-mode MFS volume's low-level files are called, looked up in
 * `FileTable.dat` for the one platform and dictionary that volume's header
 * names (upstream `mfs_home13_anl`, MEA.py 8303).
 *
 * Why this is a value the panel carries rather than a field of the analysis:
 * such a volume has **no names in its bytes**. The FAT chains are numbered, and
 * the number is all the flash says; the path comes out of an upstream database.
 * The result model holds facts decoded from bytes and never database-derived
 * display text, so the join happens here, on the way to the rows — the engine
 * keeps saying `index` and `size`, and the panel is where a name is put on
 * them.
 *
 * `NO_FILE_NAMES` is a panel with nothing looked up: before the table arrives,
 * on a legacy volume (which names its own files through the home directory),
 * and on a machine that cannot reach the database at all. The rows then read as
 * they always have — `File 63` — which is the honest answer, not a gap.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames
 */
export interface MFSFileNames {
  /**
   * File index → the record that names it. One, not a list: upstream stops at
   * the first record claiming a `vfsId` (`break`, MEA.py 8444), and a `vfsId`
   * is claimed twice more often than not — the records it never reaches are
   * names the file does not have.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.entries
   */
  readonly entries: ReadonlyMap<number, FileTableEntry>;
  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the volume. Nothing when nothing was looked up.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.resolution
   */
  readonly resolution: FileTableResolution | undefined;
}

/**
 * Nothing looked up.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.none
 */
export const NO_FILE_NAMES: MFSFileNames = { entries: new Map(), resolution: undefined };

/**
 * The names for one volume: every present file's index looked up once, up
 * front, so the rows are built from a value and not from a search.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.init
 */
export function mfsFileNames(table: FileTable, volume: MFSVolume): MFSFileNames {
  if (table.isEmpty) return NO_FILE_NAMES;
  const resolution = table.resolve(volume.ftblPlatform, volume.ftblDictionary);
  if (resolution.missing) return { entries: new Map(), resolution };
  const found = new Map<number, FileTableEntry>();
  for (const index of new Set(volume.files.map((file) => file.index))) {
    const record = table.recordNamingFileIndex(index, resolution.platform, resolution.dictionary);
    if (record !== undefined) found.set(index, record);
  }
  return { entries: found, resolution };
}

/**
 * True when no name was found for any file — a table that does not describe
 * this volume at all. The panel then says nothing about naming rather than
 * claiming a table it could not use.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.isEmpty
 */
export const namesNothing = (names: MFSFileNames): boolean => names.entries.size === 0;

/**
 * The record naming `index`, or nothing.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.record
 */
export const recordForFile = (names: MFSFileNames, index: number): FileTableEntry | undefined =>
  names.entries.get(index);

/**
 * What the row is called, or nothing where the table names nothing for that
 * index — the row keeps its number then, the way upstream falls back to
 * `/Unknown/<idx>.bin`.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.path
 */
export const pathForFile = (names: MFSFileNames, index: number): string | undefined =>
  names.entries.get(index)?.path;

/**
 * How the table the names came from is named on the volume's own row: the
 * platform and dictionary in the form the file keys them by, and a word when
 * either was assumed rather than read from the volume (upstream warns in the
 * same place — `check_ftbl_pl` / `check_ftbl_id`).
 *
 * @upstream Modules/MEATool/Sources/MEATool/MFSFileNames.swift#MFSFileNames.tableLabel
 */
export function fileTableLabel(names: MFSFileNames): string | undefined {
  const resolution = names.resolution;
  if (resolution === undefined) return undefined;
  const digits = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
  const table = `${digits(resolution.platform)} / ${digits(resolution.dictionary)}`;
  if (resolution.missing) return `${table} — not in FileTable.dat`;
  const assumed = [
    resolution.assumedPlatform ? "platform" : undefined,
    resolution.assumedDictionary ? "dictionary" : undefined,
  ].filter((one): one is string => one !== undefined);
  if (assumed.length === 0) return table;
  return `${table} (assumed ${assumed.join(" and ")})`;
}
