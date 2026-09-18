import type { FileTable, FileTableResolution } from "@/firmware/me/data/fileTable";

/**
 * What the files of an ID-keyed Configuration stream are called — the paths the
 * `FTBL` table of `FileTable.dat` stores under each record's **File ID as its
 * key** (upstream `mfs_cfg_anl`'s 0xC branch, MEA.py 8546).
 *
 * This is a second, different lookup into the same table: an MFS or EFS file is
 * found by the `vfsId` written *inside* a record (`mfsFileNames`,
 * `efsFileNames`), while a Configuration record carries the key itself and the
 * row at it is the answer. Both are database text, so both live here rather
 * than in the analysis — the records the engine decodes say where the bytes
 * are, how long they are and whether an OEM setting may override the Intel one,
 * and nothing about a name.
 *
 * `NO_RECORD_PATHS` is a panel with nothing looked up: before the table
 * arrives, and on a machine that cannot reach the database. A row then reads as
 * its File ID, which is what the stream itself says about it.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths
 */
export interface ConfigRecordPaths {
  /**
   * File ID → the path the table keys under it. A record the table has no row
   * for is absent, and reads as upstream's own fallback.
   *
   * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.paths
   */
  readonly paths: ReadonlyMap<number, string>;
  /**
   * Which table the lookup read, and whether either half of it was assumed
   * rather than named by the MFS volume. Nothing when nothing was looked up.
   *
   * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.resolution
   */
  readonly resolution: FileTableResolution | undefined;
}

/**
 * Nothing looked up.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.none
 */
export const NO_RECORD_PATHS: ConfigRecordPaths = { paths: new Map(), resolution: undefined };

/**
 * The paths for one set of records, looked up once up front.
 *
 * `platform` and `dictionary` are the MFS volume header's, as upstream passes
 * them into `mfs_cfg_anl` (and through `fitc_anl` into it); −1 for either means
 * no MFS volume decoded alongside, which the table's own fallbacks then answer.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.init
 */
export function configRecordPaths(
  table: FileTable,
  fileIds: Iterable<number>,
  platform: number,
  dictionary: number
): ConfigRecordPaths {
  if (table.isEmpty) return NO_RECORD_PATHS;
  const resolution = table.resolve(platform, dictionary);
  const paths = new Map<number, string>();
  for (const id of new Set(fileIds)) {
    const record = table.recordWithFileId(id, resolution.platform, resolution.dictionary);
    if (record !== undefined) paths.set(id, record.path);
  }
  return { paths, resolution };
}

/**
 * True when no record was named — a table that does not describe this image's
 * configuration at all.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.isEmpty
 */
export const namesNoRecord = (paths: ConfigRecordPaths): boolean => paths.paths.size === 0;

/**
 * What the record's file is called.
 *
 * Nothing before anything was looked up — the row then keeps its File ID,
 * rather than claiming the table had nothing for it. Once a lookup *has*
 * happened, a record no row is keyed for reads as upstream writes it out:
 * `/Unknown/<ID>.bin`.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.path
 */
export function recordPath(paths: ConfigRecordPaths, fileId: number): string | undefined {
  const path = paths.paths.get(fileId);
  if (path !== undefined) return path;
  if (paths.resolution === undefined) return undefined;
  return `/Unknown/${(fileId >>> 0).toString(16).toUpperCase().padStart(8, "0")}.bin`;
}

/**
 * Whether the table actually named this record, as against falling back.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.isNamed
 */
export const recordIsNamed = (paths: ConfigRecordPaths, fileId: number): boolean =>
  paths.paths.has(fileId);

/**
 * How the table the paths came from is named on the group's own row — the same
 * form the MFS volume's row uses.
 *
 * @upstream Modules/MEATool/Sources/MEATool/ConfigRecordPaths.swift#ConfigRecordPaths.tableLabel
 */
export function recordTableLabel(paths: ConfigRecordPaths): string | undefined {
  const resolution = paths.resolution;
  if (resolution === undefined) return undefined;
  const digits = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
  const table = `${digits(resolution.platform)} / ${digits(resolution.dictionary)}`;
  if (resolution.missing) return `${table} — not in FileTable.dat`;
  const assumed = [
    resolution.assumedPlatform ? "platform" : undefined,
    resolution.assumedDictionary ? "dictionary" : undefined,
  ].filter((one): one is string => one !== undefined);
  return assumed.length === 0 ? table : `${table} (assumed ${assumed.join(" and ")})`;
}
