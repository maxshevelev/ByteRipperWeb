import type { FileTable, FileTableResolution } from "@/firmware/me/data/fileTable";

/**
 * What the files of an ID-keyed Configuration stream are called — the paths the
 * `FTBL` table of `FileTable.dat` stores under each record's **File ID as its
 * key** (upstream `mfs_cfg_anl`'s 0xC branch, MEA.py 8546).
 *
 * This is a second, different lookup into the same table: an MFS or EFS file is
 * found by the `vfsID` written *inside* a record (`MFSFileNames`,
 * `EFSFileNames`), while a Configuration record carries the key itself and the
 * row at it is the answer. Both are DB text, so both live here rather than in
 * the analysis (reference/result-model.md) — the records the engine decodes say
 * where the bytes are, how long they are and whether an OEM setting may override
 * the Intel one, and nothing about a name.
 *
 * `.none` is a panel with nothing looked up: before the table arrives, and on a
 * machine that cannot reach the database. A row then reads as its File ID, which
 * is what the stream itself says about it.
 *
 * Ported from `Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift`.
 */
export class ConfigRecordPaths {
  /**
   * File ID → the path the table keys under it. A record the table has no row
   * for is absent, and reads as upstream's own fallback.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.paths
   */
  readonly paths: ReadonlyMap<number, string>;

  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the MFS volume. `undefined` when nothing was looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.resolution
   */
  readonly resolution: FileTableResolution | undefined;

  /** @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.init */
  constructor(paths: ReadonlyMap<number, string>, resolution: FileTableResolution | undefined) {
    this.paths = paths;
    this.resolution = resolution;
  }

  /**
   * Nothing looked up.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.none
   */
  static readonly none = new ConfigRecordPaths(new Map(), undefined);

  /**
   * The same value, back from the worker that looked it up: a structured clone
   * carries the fields and not the class.
   *
   * @web-only upstream's lookup crosses an actor boundary, which keeps the type
   */
  static received(held: ConfigRecordPaths): ConfigRecordPaths {
    return new ConfigRecordPaths(held.paths, held.resolution);
  }

  /**
   * The paths for one set of records, looked up once up front.
   *
   * `platform` and `dictionary` are the MFS volume header's, as upstream passes
   * them into `mfs_cfg_anl` (and through `fitc_anl` into it); −1 for either means
   * no MFS volume decoded alongside, which the table's own fallbacks then answer.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.init
   */
  static forFileIDs(options: {
    readonly table: FileTable;
    readonly fileIDs: Iterable<number>;
    readonly platform: number;
    readonly dictionary: number;
  }): ConfigRecordPaths {
    const { table, fileIDs, platform, dictionary } = options;
    if (table.isEmpty) return ConfigRecordPaths.none;
    const resolution = table.resolve(platform, dictionary);
    const paths = new Map<number, string>();
    for (const fileID of new Set(fileIDs)) {
      const record = table.recordForFileID(fileID, resolution.platform, resolution.dictionary);
      if (record !== undefined) paths.set(fileID, record.path);
    }
    return new ConfigRecordPaths(paths, resolution);
  }

  /**
   * True when no record was named — a table that does not describe this image's
   * configuration at all.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.isEmpty
   */
  get isEmpty(): boolean {
    return this.paths.size === 0;
  }

  /**
   * What the record's file is called.
   *
   * `undefined` before anything was looked up — the row then keeps its File ID,
   * rather than claiming the table had nothing for it. Once a lookup *has*
   * happened, a record no row is keyed for reads as upstream writes it out:
   * `/Unknown/<ID>.bin`.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.path
   */
  path(fileID: number): string | undefined {
    const path = this.paths.get(fileID);
    if (path !== undefined) return path;
    if (this.resolution === undefined) return undefined;
    return `/Unknown/${fileID.toString(16).toUpperCase().padStart(8, "0")}.bin`;
  }

  /**
   * Whether the table actually named this record, as against falling back.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.isNamed
   */
  isNamed(fileID: number): boolean {
    return this.paths.has(fileID);
  }

  /**
   * How the table the paths came from is named on the group's own row — the same
   * form the MFS volume's row uses.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/ConfigRecordPaths.swift#ConfigRecordPaths.tableLabel
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

/** Two upper-case hex digits — the form the file keys platform and dictionary by. */
function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}
