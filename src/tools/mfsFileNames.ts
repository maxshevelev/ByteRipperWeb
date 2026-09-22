import type { FileTable, FileTableEntry, FileTableResolution } from "@/firmware/me/data/fileTable";
import type { MFSVolume } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";

/**
 * What an FTBL-mode MFS volume's low-level files are called, looked up in
 * `FileTable.dat` for the one platform and dictionary that volume's header
 * names (§11 of the ME tool; upstream `mfs_home13_anl`, MEA.py 8303).
 *
 * Why this is a value the panel carries rather than a field of the analysis:
 * such a volume has **no names in its bytes**. The FAT chains are numbered, and
 * the number is all the flash says; the path comes out of an upstream database.
 * The result model holds facts decoded from bytes and never DB-derived display
 * text (reference/result-model.md), so the join happens here, on the way to the
 * rows — the engine keeps saying `index` and `size`, and the panel is where a
 * name is put on them.
 *
 * `.none` is a panel with nothing looked up: before the table arrives, on a
 * legacy volume (which names its own files through the home directory), and on
 * a machine that cannot reach the database at all. The rows then read as they
 * always have — `File 63` — which is the honest answer, not a gap.
 *
 * Ported from `Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift`.
 */
export class MFSFileNames {
  /**
   * File index → the record that names it. One, not a list: upstream stops at
   * the first record claiming a `vfsID` (`break`, MEA.py 8444), and a `vfsID`
   * is claimed twice more often than not — the records it never reaches are
   * names the file does not have.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.entries
   */
  readonly entries: ReadonlyMap<number, FileTableEntry>;

  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the volume. `undefined` when nothing was looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.resolution
   */
  readonly resolution: FileTableResolution | undefined;

  /** @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.init */
  constructor(
    entries: ReadonlyMap<number, FileTableEntry>,
    resolution: FileTableResolution | undefined
  ) {
    this.entries = entries;
    this.resolution = resolution;
  }

  /**
   * Nothing looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.none
   */
  static readonly none = new MFSFileNames(new Map(), undefined);

  /**
   * The same value, back from the worker that looked it up.
   *
   * A structured clone carries the fields and not the class, so what arrives
   * has this shape and none of its behaviour. Rebuilding it here is what keeps
   * the boundary from leaking into every row that asks a name for a file.
   *
   * @web-only upstream's lookup crosses an actor boundary, which keeps the type
   */
  static received(held: MFSFileNames): MFSFileNames {
    return new MFSFileNames(held.entries, held.resolution);
  }

  /**
   * The names for one volume: every present file's index looked up once, up
   * front, so the rows are built from a value and not from a search.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.init
   */
  static forVolume(table: FileTable, volume: MFSVolume): MFSFileNames {
    if (table.isEmpty) return MFSFileNames.none;
    const resolution = table.resolve(volume.ftblPlatform, volume.ftblDictionary);
    if (resolution.missing) return new MFSFileNames(new Map(), resolution);
    const found = new Map<number, FileTableEntry>();
    for (const index of new Set(volume.files.map((one) => one.index))) {
      const record = table.recordForFileIndex(index, resolution.platform, resolution.dictionary);
      if (record !== undefined) found.set(index, record);
    }
    return new MFSFileNames(found, resolution);
  }

  /**
   * True when no name was found for any file — a table that does not describe
   * this volume at all. The panel then says nothing about naming rather than
   * claiming a table it could not use.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.isEmpty
   */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /**
   * The record naming `index`, or `undefined`.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.record
   */
  record(index: number): FileTableEntry | undefined {
    return this.entries.get(index);
  }

  /**
   * What the row is called, or `undefined` where the table names nothing for
   * that index — the row keeps its number then, the way upstream falls back to
   * `/Unknown/<idx>.bin`.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.path
   */
  path(index: number): string | undefined {
    return this.entries.get(index)?.path;
  }

  /**
   * How the table the names came from is named on the volume's own row: the
   * platform and dictionary in the form the file keys them by, and a word when
   * either was assumed rather than read from the volume (upstream warns in the
   * same place — `check_ftbl_pl` / `check_ftbl_id`).
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MFSFileNames.swift#MFSFileNames.tableLabel
   */
  get tableLabel(): string | undefined {
    const resolution = this.resolution;
    if (resolution === undefined) return undefined;
    const table = `${hexByte(resolution.platform)} / ${hexByte(resolution.dictionary)}`;
    if (resolution.missing) return `${table} — not in FileTable.dat`;
    const assumed = [
      resolution.assumedPlatform ? "platform" : undefined,
      resolution.assumedDictionary ? "dictionary" : undefined,
    ].filter((one): one is string => one !== undefined);
    if (assumed.length === 0) return table;
    return `${table} (assumed ${assumed.join(" and ")})`;
  }
}

/**
 * Whether this analysis has anything that needs `FileTable.dat` — the one
 * reading that makes the panel ask for it at all.
 *
 * Three things do, and they are the three the table exists for. An FTBL-mode
 * MFS volume cannot name its own files. An **EFS** volume is the sharper case:
 * its pages carry no directory, so without the table it lists nothing at all —
 * the fetch is not about a name there but about the file list existing. And an
 * ID-keyed Configuration record has no path without it. A legacy MFS volume
 * names its files through the home directory, and an empty file list has
 * nothing to put a name on; neither is worth 5 MB.
 *
 * Asked after the analysis rather than with it, and only once per analysis,
 * because the answer is what the analysis itself carries.
 *
 * Upstream asks the same question in `MEAParkedState.loadFileNames` — a private
 * function, so no anchor names it, and the guard is spelled out here as
 * `huffmanDictionariesWanted` spells out its own. The Configuration half is not
 * in that function's own guard: there the file IDs come from the analysis the
 * caller has already gathered, and here they are passed in for the same reason.
 */
export function fileTableWanted(analysis: FirmwareAnalysis, configIDs: readonly number[]): boolean {
  const mfs = analysis.mfsVolume;
  const wantsMFS = mfs?.usesFTBL === true && mfs.files.length > 0;
  return wantsMFS || analysis.efsVolume !== undefined || configIDs.length > 0;
}

/** Two upper-case hex digits — the form the file keys platform and dictionary by. */
function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}
