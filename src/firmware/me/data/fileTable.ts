/**
 * Parsed `FileTable.dat`: the table that gives an MFS/AFS volume's low-level
 * files their names.
 *
 * An FTBL-mode volume (CSME 15/16 — `usesFtbl`) carries no names in its bytes
 * at all. Its FAT chains are numbered, and the number is the only thing the
 * flash says about a file; the *name* lives in this upstream JSON, keyed by the
 * volume header's own FTBL **platform** and **dictionary** — both of which the
 * volume decode already reads. So a name here is a database answer to a byte
 * question, which is why it is a lookup the panel makes and never a field of
 * the analysis.
 *
 * The shape, as upstream writes it (`mfs_home13_anl`, MEA.py 8303):
 *
 * ```json
 * { "04": { "0A": { "FTBL": { "10003500": "/home/mca/manuf_ver,1,0,0,40,0,70,63,448" },
 *                   "EFST": { "01": { "00003004": "3,76,548,5,0,BUP_MBP" } } } } }
 * ```
 *
 * — platform → dictionary → table → … → key → one comma-joined record. The
 * `FTBL` record is `path,integrity,encryption,antiReplay,accessUnknown,
 * groupID,userID,vfsID,unknown`, keyed by file ID, and **`vfsID` is the
 * low-level file index** the MFS walk assembles, which is the whole join.
 *
 * `EFST` — the EFS volume's own table — nests one level deeper: a **table
 * revision** (the EFS System page's own `DictRevision`, `01` on everything
 * shipped so far) before the entries, which are keyed by the file's offset into
 * the volume's assembled data area and read
 * `page,pageOffset,size,fileID,reserved,name`. Its `fileID` is the same `vfsID`
 * the FTBL rows use, which is how an EFS file gets its path and — the reason
 * the FTBL read is not optional — its Integrity flag.
 *
 * The records are kept as written and parsed on demand for the one platform and
 * dictionary a volume asks about. The file holds ~67 000 records across 70
 * tables and a volume reads one of them: eagerly typing all of it would be work
 * for a thousand names nobody asked for.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable
 */

/** Why `FileTable.dat` could not be read. */
export class FileTableError extends Error {
  constructor(detail: string) {
    super(`FileTable.dat ${detail}`);
    this.name = "FileTableError";
  }
}

/**
 * One `FTBL` record: a file's name and the flags that go with it.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry
 */
export interface FileTableEntry {
  /**
   * The record's key in the table, as written — upstream prints it as the File
   * ID (`0x10003500`).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.fileID
   */
  readonly fileId: string;
  /**
   * The file's path inside the volume, e.g. `/home/mca/manuf_ver`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.path
   */
  readonly path: string;
  /**
   * Whether the file's content carries a trailing `MFS_Integrity_Table`. The
   * flag is what says so — an FTBL volume's files have no uniform tail to
   * recognise by shape.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.integrity
   */
  readonly integrity: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.encryption */
  readonly encryption: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.antiReplay */
  readonly antiReplay: boolean;
  /**
   * The rest of the access bitfield, which upstream prints as 13 bits and does
   * not name.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.accessUnknown
   */
  readonly accessUnknown: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.groupID */
  readonly groupId: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.userID */
  readonly userId: number;
  /**
   * The low-level file index this record names.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.vfsID
   */
  readonly vfsId: number;
  /**
   * Upstream's trailing unnamed value (printed as 64 bits).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.unknown
   */
  readonly unknown: number;
}

/**
 * One `EFST` record: where an EFS file sits in the volume's assembled data
 * area, how long the table says it is, and what it is called.
 *
 * The name is the only thing the EFS volume itself never says — the pages carry
 * a 4-byte metadata header and the bytes, and nothing else. The record's
 * `fileId` is the `vfsId` of the FTBL row that holds the file's path and its
 * Integrity flag, which is why an EFS walk reads both tables.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry
 */
export interface EfsTableEntry {
  /**
   * The record's key: the file's offset into the data area assembled from the
   * volume's Data pages in System-index order.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.dataOffset
   */
  readonly dataOffset: number;
  /**
   * The logical Data page the file starts on, and the offset inside that page's
   * data area — `dataOffset` split the way the record writes it.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.page
   */
  readonly page: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.pageOffset */
  readonly pageOffset: number;
  /**
   * The length the table claims. The file's own metadata is preferred over it
   * (upstream: "always prefer over EFST Size"); the two disagreeing means this
   * is the wrong table for the volume.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.size
   */
  readonly size: number;
  /**
   * The file's ID — the FTBL `vfsId`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.fileID
   */
  readonly fileId: number;
  /**
   * Upstream's trailing reserved value (0 on everything shipped).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.reserved
   */
  readonly reserved: number;
  /**
   * The file's name, e.g. `BUP_MBP`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.name
   */
  readonly name: string;
}

/**
 * Which table a volume's header actually landed on, and how (upstream's
 * `check_ftbl_pl` / `check_ftbl_id`, MEA.py 7405–7445).
 *
 * Upstream falls back rather than giving up, and says so in a warning: a volume
 * with no platform is read as `0x01` (ICP) and one with no dictionary — or a
 * dictionary this platform does not have — as `0x0A` (CON). `assumedPlatform`
 * and `assumedDictionary` carry that "said so", so the panel can pass it on
 * instead of presenting a guess as a fact.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution
 */
export interface FileTableResolution {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.platform */
  readonly platform: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.dictionary */
  readonly dictionary: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.assumedPlatform */
  readonly assumedPlatform: boolean;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.assumedDictionary */
  readonly assumedDictionary: boolean;
  /**
   * True when even the fallback has no `FTBL` table — nothing here can name an
   * MFS volume's files, or say which of an EFS volume's carry an Integrity
   * table. The `EFST` half is asked about separately (`hasEfst`), because a
   * platform can carry one table without the other.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.missing
   */
  readonly missing: boolean;
}

/**
 * Upstream's fallback platform: ICP.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.defaultPlatform
 */
export const DEFAULT_FTBL_PLATFORM = 0x01;

/**
 * Upstream's fallback dictionary: CON.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.defaultDictionary
 */
export const DEFAULT_FTBL_DICTIONARY = 0x0a;

/** platform → dictionary → table → key → record, as the file writes it. */
type Tables = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Records>>>>>>;
/** One table's records: key → the comma-joined row. */
type Records = Readonly<Record<string, string>>;

/** The key form the file uses: two upper-case hex digits. */
const key = (value: number): string => value.toString(16).toUpperCase().padStart(2, "0");

export class FileTable {
  /**
   * platform → dictionary → table name → file ID → record, exactly as the file
   * is written. `EFST` is not in here: it is keyed one level deeper and lives
   * in `efst`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.tables
   */
  private readonly tables: Tables;

  /**
   * platform → dictionary → table revision → data-area offset → record — the
   * `EFST` tables, whose extra level is the revision an EFS volume's System
   * page names.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.efst
   */
  private readonly efst: Tables;

  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.init */
  constructor(tables: Tables = {}, efst: Tables = {}) {
    this.tables = tables;
    this.efst = efst;
  }

  /**
   * True when nothing was loaded — a source that has no table to give. Upstream
   * only warns about a missing entry when it *has* a file to look in; an empty
   * table says nothing at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.isEmpty
   */
  get isEmpty(): boolean {
    return Object.keys(this.tables).length === 0 && Object.keys(this.efst).length === 0;
  }

  /**
   * The platform and dictionary a volume's header values resolve to, with
   * upstream's fallbacks applied (MEA.py 7405–7445). A `platform` or
   * `dictionary` of −1 means the volume header had none.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.resolve
   */
  resolve(platform: number, dictionary: number): FileTableResolution {
    // Present means present in the file, not in one of its two halves: a
    // platform that carries only `EFST` is a platform upstream finds
    // (`if '%0.2X' % vol_ftbl_pl not in ftbl_dict`), and falling back off it
    // would read another platform's table.
    let resolvedPlatform = platform;
    let assumedPlatform = false;
    if (platform < 0 || !this.hasPlatform(platform)) {
      resolvedPlatform = DEFAULT_FTBL_PLATFORM;
      assumedPlatform = platform !== DEFAULT_FTBL_PLATFORM;
    }
    let resolvedDictionary = dictionary;
    let assumedDictionary = false;
    if (dictionary < 0 || !this.hasDictionary(dictionary, resolvedPlatform)) {
      resolvedDictionary = DEFAULT_FTBL_DICTIONARY;
      assumedDictionary = dictionary !== DEFAULT_FTBL_DICTIONARY;
    }
    return {
      platform: resolvedPlatform,
      dictionary: resolvedDictionary,
      assumedPlatform,
      assumedDictionary,
      missing: this.ftblRecords(resolvedPlatform, resolvedDictionary) === undefined,
    };
  }

  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.hasPlatform */
  private hasPlatform(platform: number): boolean {
    return this.tables[key(platform)] !== undefined || this.efst[key(platform)] !== undefined;
  }

  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.hasDictionary */
  private hasDictionary(dictionary: number, platform: number): boolean {
    return (
      this.tables[key(platform)]?.[key(dictionary)] !== undefined ||
      this.efst[key(platform)]?.[key(dictionary)] !== undefined
    );
  }

  private ftblRecords(platform: number, dictionary: number): Records | undefined {
    return this.tables[key(platform)]?.[key(dictionary)]?.FTBL;
  }

  /**
   * The `FTBL` record that names low-level file `index` in the table
   * `platform`/`dictionary` resolves to, or nothing where nothing names it.
   *
   * **The first match, and only the first** — upstream's loop ends on one
   * (`break # Stop searching FTBL Dictionary at first VFS ID match`, MEA.py
   * 8444), and a `vfsId` is shared more often than not: 4836 of the file's
   * `vfsId`s are claimed by two records under different paths. The later ones
   * are records upstream never prints, so showing them would be a name this
   * file does not have.
   *
   * "First" is the order the records are written in, which neither a Swift
   * dictionary nor a parsed object keeps — so the pick is the lowest **file
   * ID** instead. The two are the same order on the data as shipped: over all
   * 70 tables and all 4836 shared `vfsId`s, the record written first is the one
   * with the lowest file ID, every time. A deterministic rule that reproduces
   * upstream's answer beats keeping 5 MB of text around to remember what order
   * it was in.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.record
   */
  recordNamingFileIndex(
    index: number,
    platform: number,
    dictionary: number
  ): FileTableEntry | undefined {
    const resolution = this.resolve(platform, dictionary);
    if (resolution.missing) return undefined;
    const records = this.ftblRecords(resolution.platform, resolution.dictionary);
    if (records === undefined) return undefined;
    let best: FileTableEntry | undefined;
    for (const [fileId, record] of Object.entries(records)) {
      const entry = fileTableEntry(fileId, record);
      if (entry === undefined || entry.vfsId !== index) continue;
      if (best === undefined || entry.fileId < best.fileId) best = entry;
    }
    return best;
  }

  /**
   * The `FTBL` record stored **under `fileId` as its key** — the lookup a
   * Configuration record needs, which is not the same lookup a file index
   * needs: an MFS/EFS file is found by the `vfsId` *inside* a record
   * (`recordNamingFileIndex`), while a 0xC Configuration record carries the
   * record's own key and reads the row at it directly (upstream
   * `ftbl_dict[pl][id]['FTBL'][ftbl_rec_id]`, MEA.py 8546).
   *
   * Nothing where no row is keyed by that ID — upstream warns and falls back to
   * `/Unknown/<ID>.bin`, which is the panel's job to say.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.record
   */
  recordWithFileId(
    fileId: number,
    platform: number,
    dictionary: number
  ): FileTableEntry | undefined {
    const resolution = this.resolve(platform, dictionary);
    if (resolution.missing) return undefined;
    const records = this.ftblRecords(resolution.platform, resolution.dictionary);
    if (records === undefined) return undefined;
    const wanted = (fileId >>> 0).toString(16).toUpperCase().padStart(8, "0");
    const record = records[wanted];
    return record === undefined ? undefined : fileTableEntry(wanted, record);
  }

  /**
   * The `EFST` entries describing an EFS volume of table `revision`, in the
   * order they sit in the data area, or nothing when this platform/dictionary
   * carries no `EFST` or none at that revision (upstream errors out on both,
   * MEA.py 8946–8950).
   *
   * `platform` and `dictionary` are the **MFS** volume header's, not the EFS
   * System page's — upstream hands `efs_anl` the values `mfs_anl` read (MEA.py
   * 5618), and the EFS page's own Dictionary is only checked against them.
   * `revision` is the EFS System page's `DictRevision`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.efsEntries
   */
  efsEntries(platform: number, dictionary: number, revision: number): EfsTableEntry[] | undefined {
    const resolution = this.resolve(platform, dictionary);
    const records =
      this.efst[key(resolution.platform)]?.[key(resolution.dictionary)]?.[key(revision)];
    if (records === undefined) return undefined;
    const entries: EfsTableEntry[] = [];
    for (const [offset, record] of Object.entries(records)) {
      const entry = efsTableEntry(offset, record);
      if (entry !== undefined) entries.push(entry);
    }
    return entries.sort((one, other) => one.dataOffset - other.dataOffset);
  }

  /**
   * Whether this platform/dictionary has an `EFST` at all, so a panel can tell
   * "no table for this volume" from "a table that named nothing".
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.hasEFST
   */
  hasEfst(platform: number, dictionary: number): boolean {
    const resolution = this.resolve(platform, dictionary);
    return this.efst[key(resolution.platform)]?.[key(resolution.dictionary)] !== undefined;
  }

  /**
   * `FileTable.dat` as it is downloaded. Malformed JSON is an error; a
   * platform, dictionary or table of an unexpected shape is skipped, which is
   * how the file grows a new one without breaking this parser.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.parse
   */
  static parse(text: string): FileTable {
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      throw new FileTableError("is not JSON.");
    }
    if (!isObject(root) || Object.keys(root).length === 0) {
      throw new FileTableError("is not an object of platforms.");
    }
    const tables: Record<string, Record<string, Record<string, Records>>> = {};
    const efst: Record<string, Record<string, Record<string, Records>>> = {};
    for (const [platform, dictionaries] of Object.entries(root)) {
      if (!isObject(dictionaries)) continue;
      const byDictionary: Record<string, Record<string, Records>> = {};
      const efstByDictionary: Record<string, Record<string, Records>> = {};
      for (const [dictionary, named] of Object.entries(dictionaries)) {
        if (!isObject(named)) continue;
        const byTable: Record<string, Records> = {};
        for (const [table, records] of Object.entries(named)) {
          // `EFST` keys its records by revision first; every other table is
          // flat. A table of neither shape is skipped, which is how the file
          // grows a new one without breaking this.
          if (table.toUpperCase() === "EFST") {
            if (!isObject(records)) continue;
            const byRevision: Record<string, Records> = {};
            for (const [revision, entries] of Object.entries(records)) {
              const rows = stringRecords(entries);
              if (rows !== undefined) byRevision[revision.toUpperCase()] = rows;
            }
            if (Object.keys(byRevision).length > 0) {
              efstByDictionary[dictionary.toUpperCase()] = byRevision;
            }
            continue;
          }
          const rows = stringRecords(records);
          if (rows !== undefined) byTable[table.toUpperCase()] = rows;
        }
        if (Object.keys(byTable).length > 0) byDictionary[dictionary.toUpperCase()] = byTable;
      }
      if (Object.keys(byDictionary).length > 0) tables[platform.toUpperCase()] = byDictionary;
      if (Object.keys(efstByDictionary).length > 0) {
        efst[platform.toUpperCase()] = efstByDictionary;
      }
    }
    if (Object.keys(tables).length === 0 && Object.keys(efst).length === 0) {
      throw new FileTableError("carries no table this reader knows.");
    }
    return new FileTable(tables, efst);
  }
}

/** The table a source with nothing to give hands over. */
export const EMPTY_FILE_TABLE = new FileTable();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One table's rows, or nothing when the value is not a map of strings. */
function stringRecords(value: unknown): Records | undefined {
  if (!isObject(value)) return undefined;
  const rows: Record<string, string> = {};
  for (const [row, record] of Object.entries(value)) {
    if (typeof record !== "string") return undefined;
    rows[row] = record;
  }
  return rows;
}

/** A field that must be a whole number, or nothing. */
function number(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/**
 * One record string, typed. Nothing for a record that does not carry the nine
 * fields upstream unpacks — a shorter or unparseable row names nothing, and
 * guessing at its fields would put a wrong flag on a real file.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.entry
 */
export function fileTableEntry(fileId: string, record: string): FileTableEntry | undefined {
  const parts = record.split(",");
  if (parts.length < 9) return undefined;
  const values = parts.slice(1, 9).map(number);
  if (values.some((value) => value === undefined)) return undefined;
  const value = values as number[];
  return {
    fileId,
    path: parts[0] ?? "",
    integrity: value[0] !== 0,
    encryption: value[1] !== 0,
    antiReplay: value[2] !== 0,
    accessUnknown: value[3] ?? 0,
    groupId: value[4] ?? 0,
    userId: value[5] ?? 0,
    vfsId: value[6] ?? 0,
    unknown: value[7] ?? 0,
  };
}

/**
 * One `EFST` record, typed: `page,pageOffset,size,fileID,reserved,name`, keyed
 * by the file's hex offset into the data area. Nothing for anything that does
 * not carry those six fields — a record read wrong would put a name on the
 * wrong bytes.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.efsEntry
 */
export function efsTableEntry(offsetKey: string, record: string): EfsTableEntry | undefined {
  const parts = record.split(",");
  if (parts.length < 6) return undefined;
  const trimmedKey = offsetKey.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmedKey)) return undefined;
  const dataOffset = Number.parseInt(trimmedKey, 16);
  if (!Number.isSafeInteger(dataOffset) || dataOffset < 0) return undefined;
  const values = parts.slice(0, 5).map(number);
  if (values.some((value) => value === undefined)) return undefined;
  const value = values as number[];
  const name = parts.slice(5).join(",").trim();
  if (name.length === 0) return undefined;
  return {
    dataOffset,
    page: value[0] ?? 0,
    pageOffset: value[1] ?? 0,
    size: value[2] ?? 0,
    fileId: value[3] ?? 0,
    reserved: value[4] ?? 0,
    name,
  };
}
