import type {
  FileTable,
  FileTableEFSEntry,
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
 * model never carries (reference/result-model.md): the name, the path and the
 * flags the table states about each file.
 *
 * `.none` is a panel with nothing looked up: before the table arrives, and on a
 * machine that cannot reach the database. The engine's file list is then empty
 * too — a volume whose pages carry no directory has nothing to list without the
 * table — so there is nothing to name.
 *
 * Ported from `Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift`.
 */
export class EFSFileNames {
  /**
   * File ID → the `EFST` record that names it.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.names
   */
  readonly names: ReadonlyMap<number, FileTableEFSEntry>;

  /**
   * File ID → the `FTBL` record that gives it a path and its flags. Missing
   * where no row claims the file — upstream prints an error and stores the file
   * anyway (MEA.py 8936), and the row here keeps its name.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.records
   */
  readonly records: ReadonlyMap<number, FileTableEntry>;

  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the MFS volume beside this one. `undefined` when
   * nothing was looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.resolution
   */
  readonly resolution: FileTableResolution | undefined;

  /**
   * The table revision the EFS System page names (`dictionaryRevision`).
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.revision
   */
  readonly revision: number | undefined;

  /**
   * Whether that platform and dictionary carry an `EFST` at all, so the panel
   * can tell "no table for this volume" from "a table that named nothing in it".
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.hasTable
   */
  readonly hasTable: boolean;

  /** @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.init */
  constructor(options: {
    readonly names: ReadonlyMap<number, FileTableEFSEntry>;
    readonly records: ReadonlyMap<number, FileTableEntry>;
    readonly resolution: FileTableResolution | undefined;
    readonly revision: number | undefined;
    readonly hasTable: boolean;
  }) {
    this.names = options.names;
    this.records = options.records;
    this.resolution = options.resolution;
    this.revision = options.revision;
    this.hasTable = options.hasTable;
  }

  /**
   * Nothing looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.none
   */
  static readonly none = new EFSFileNames({
    names: new Map(),
    records: new Map(),
    resolution: undefined,
    revision: undefined,
    hasTable: false,
  });

  /**
   * The same value, back from the worker that looked it up: a structured clone
   * carries the fields and not the class.
   *
   * @web-only upstream's lookup crosses an actor boundary, which keeps the type
   */
  static received(held: EFSFileNames): EFSFileNames {
    return new EFSFileNames({
      names: held.names,
      records: held.records,
      resolution: held.resolution,
      revision: held.revision,
      hasTable: held.hasTable,
    });
  }

  /**
   * The names for one volume, looked up once up front.
   *
   * `platform` and `dictionary` are the **MFS** volume's, not this volume's own
   * Dictionary field: upstream hands `efs_anl` the values it read out of the MFS
   * volume header (MEA.py 5618), and the EFS page's Dictionary is only checked
   * against them (`EFSVolume.matchesMFSDictionary`). −1 for either means no MFS
   * volume decoded alongside, which the table's own fallbacks then answer.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.init
   */
  static forVolume(options: {
    readonly table: FileTable;
    readonly volume: EFSVolume;
    readonly platform: number;
    readonly dictionary: number;
  }): EFSFileNames {
    const { table, volume, platform, dictionary } = options;
    if (table.isEmpty) return EFSFileNames.none;
    const resolution = table.resolve(platform, dictionary);
    const revision = volume.dictionaryRevision;
    const hasTable = table.hasEFST(resolution.platform, resolution.dictionary);
    const entries = table.efsEntries(resolution.platform, resolution.dictionary, revision) ?? [];
    const names = new Map<number, FileTableEFSEntry>();
    const records = new Map<number, FileTableEntry>();
    for (const entry of entries) {
      names.set(entry.fileID, entry);
      const record = table.recordForFileIndex(
        entry.fileID,
        resolution.platform,
        resolution.dictionary
      );
      if (record !== undefined) records.set(entry.fileID, record);
    }
    return new EFSFileNames({ names, records, resolution, revision, hasTable });
  }

  /**
   * True when the lookup named nothing — no `EFST` for this volume, or none at
   * its revision.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.isEmpty
   */
  get isEmpty(): boolean {
    return this.names.size === 0;
  }

  /**
   * What the file is called, e.g. `BUP_MBP`.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.name
   */
  name(fileID: number): string | undefined {
    return this.names.get(fileID)?.name;
  }

  /**
   * The `FTBL` row that describes the file, or `undefined` where none claims it.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.record
   */
  record(fileID: number): FileTableEntry | undefined {
    return this.records.get(fileID);
  }

  /**
   * How the tables the rows were read from are named on the volume's own row:
   * the platform and dictionary in the form the file keys them by, the table
   * revision the volume asked for, and a word when either half was assumed
   * rather than named by the MFS volume (upstream warns in the same place —
   * `check_ftbl_pl` / `check_ftbl_id`).
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/EFSFileNames.swift#EFSFileNames.tableLabel
   */
  get tableLabel(): string | undefined {
    const resolution = this.resolution;
    if (resolution === undefined || this.revision === undefined) return undefined;
    let text = `${hexByte(resolution.platform)} / ${hexByte(resolution.dictionary)} rev ${hexByte(this.revision)}`;
    if (!this.hasTable) return `${text} — no EFST in FileTable.dat`;
    if (this.names.size === 0) return `${text} — no EFST at that revision`;
    const assumed = [
      resolution.assumedPlatform ? "platform" : undefined,
      resolution.assumedDictionary ? "dictionary" : undefined,
    ].filter((one): one is string => one !== undefined);
    if (assumed.length > 0) {
      text += ` (assumed ${assumed.join(" and ")})`;
    }
    return text;
  }
}

/** Two upper-case hex digits — the form the file keys platform and dictionary by. */
function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}
