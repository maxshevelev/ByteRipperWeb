/**
 * Parsed `FileTable.dat`: the table that gives an MFS/AFS volume's low-level
 * files their names, and an EFS volume's their offsets.
 *
 * An FTBL-mode volume (CSME 15/16 — `MFSVolume.usesFTBL`) carries no names in
 * its bytes at all. Its FAT chains are numbered, and the number is the only
 * thing the flash says about a file; the *name* lives in this upstream JSON,
 * keyed by the volume header's own FTBL **platform** and **dictionary** — both
 * of which the volume decode already reads. So a name here is a DB answer to a
 * byte question, which is why it is a lookup the panel makes and never a field
 * of `FirmwareAnalysis` (reference/result-model.md).
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
 * low-level file index** the MFS walk assembles (`MFSLowLevelFile.index`),
 * which is the whole join.
 *
 * `EFST` — the EFS volume's own table — nests one level deeper: a **table
 * revision** (the EFS System page's own `DictRevision`, `01` on everything
 * shipped so far) before the entries, which are keyed by the file's offset
 * into the volume's assembled data area and read
 * `page,pageOffset,size,fileID,reserved,name`. Its `fileID` is the same
 * `vfsID` the FTBL rows use, which is how an EFS file gets its path and — the
 * reason the FTBL read is not optional — its Integrity flag.
 *
 * The records are kept as written and parsed on demand for the one platform
 * and dictionary a volume asks about. The file holds ~67 000 records across
 * 70 tables and a volume reads one of them: eagerly typing all of it would be
 * work for a thousand names nobody asked for.
 *
 * Ported from `Packages/MEFirmware/Data/FileTable.swift`.
 */

/** One `FTBL` record: a file's name and the flags that go with it. */
export interface FileTableEntry {
  /**
   * The record's key in the table, as written — upstream prints it as the
   * File ID (`0x10003500`).
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.fileID
   */
  readonly fileID: string;
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
  readonly groupID: number;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.userID */
  readonly userID: number;
  /**
   * The low-level file index this record names.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Entry.vfsID
   */
  readonly vfsID: number;
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
 * The name is the only thing the EFS volume itself never says — the pages
 * carry a 4-byte metadata header and the bytes, and nothing else. The record's
 * `fileID` is the `vfsID` of the FTBL row that holds the file's path and its
 * Integrity flag, which is why an EFS walk reads both tables.
 */
export interface FileTableEFSEntry {
  /**
   * The record's key: the file's offset into the data area assembled from the
   * volume's Data pages in System-index order.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.dataOffset
   */
  readonly dataOffset: number;
  /**
   * The logical Data page the file starts on, and the offset inside that
   * page's data area — `dataOffset` split the way the record writes it.
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
   * The file's ID — the FTBL `vfsID`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.EFSEntry.fileID
   */
  readonly fileID: number;
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
 * Which table a volume's header actually landed on, and how (§
 * `check_ftbl_pl` / `check_ftbl_id`, MEA.py 7405–7445).
 *
 * Upstream falls back rather than giving up, and says so in a warning: a
 * volume with no platform is read as `0x01` (ICP) and one with no dictionary —
 * or a dictionary this platform does not have — as `0x0A` (CON).
 * `assumedPlatform`/`assumedDictionary` carry that "said so", so the panel can
 * pass it on instead of presenting a guess as a fact.
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
   * table. The `EFST` half is asked about separately (`hasEFST`), because a
   * platform can carry one table without the other.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.Resolution.missing
   */
  readonly missing: boolean;
}

/** platform → dictionary → table name → file ID → record. */
type Tables = Map<string, Map<string, Map<string, Map<string, string>>>>;
/** platform → dictionary → table revision → data-area offset → record. */
type EFSTTables = Map<string, Map<string, Map<string, Map<string, string>>>>;

/**
 * The structured clone of one level of the parsed JSON: only a plain object
 * counts, which is what upstream's `as? [String: Any]` asks for.
 */
function objectAt(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * An object whose every value is a string — upstream's `as? [String: String]`.
 * A table of any other shape is skipped rather than fatal.
 */
function stringRecords(value: unknown): Record<string, string> | undefined {
  const object = objectAt(value);
  if (object === undefined) return undefined;
  const records: Record<string, string> = {};
  for (const [key, one] of Object.entries(object)) {
    if (typeof one !== "string") return undefined;
    records[key] = one;
  }
  return records;
}

/** The key form the file uses: two upper-case hex digits. */
function tableKey(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * `FileTable.dat`, parsed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable
 */
export class FileTable {
  /**
   * Upstream's two fallbacks, as the values they fall back to.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.defaultPlatform
   */
  static readonly defaultPlatform = 0x01; // ICP
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.defaultDictionary */
  static readonly defaultDictionary = 0x0a; // CON

  private readonly tables: Tables;
  private readonly efst: EFSTTables;
  /**
   * `vfsID` → the record that claims it, one per table, built the first time a
   * lookup reads that table. `recordForFileIndex` is called once per file of a
   * volume, and a volume has hundreds of files over a table of hundreds of
   * records: re-walking and re-parsing the table for every one of them is the
   * pause a panel switch used to cost. Parsing each record once, into this, is
   * the same answer in a single pass.
   */
  private readonly byVfs = new Map<string, Map<number, FileTableEntry>>();

  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.init */
  constructor(options: { readonly tables?: Tables; readonly efst?: EFSTTables } = {}) {
    this.tables = options.tables ?? new Map();
    this.efst = options.efst ?? new Map();
  }

  /** A table with nothing in it — a source that has no file to give. */
  static readonly empty = new FileTable();

  /**
   * True when nothing was loaded — a source that has no table to give.
   * Upstream only warns about a missing entry when it *has* a file to look in;
   * an empty table says nothing at all.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.isEmpty
   */
  get isEmpty(): boolean {
    return this.tables.size === 0 && this.efst.size === 0;
  }

  /**
   * The platform and dictionary a volume's header values resolve to, with
   * upstream's fallbacks applied (MEA.py 7405–7445). `platform` or
   * `dictionary` of −1 means the volume header had none.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.resolve
   */
  resolve(platform: number, dictionary: number): FileTableResolution {
    let resolvedPlatform = platform;
    let resolvedDictionary = dictionary;
    let assumedPlatform = false;
    let assumedDictionary = false;

    // Present means present in the file, not in one of its two halves: a
    // platform that carries only `EFST` is a platform upstream finds
    // (`if '%0.2X' % vol_ftbl_pl not in ftbl_dict`), and falling back off it
    // would read another platform's table.
    if (platform < 0 || !this.hasPlatform(platform)) {
      resolvedPlatform = FileTable.defaultPlatform;
      assumedPlatform = platform !== FileTable.defaultPlatform;
    }
    if (dictionary < 0 || !this.hasDictionary(dictionary, resolvedPlatform)) {
      resolvedDictionary = FileTable.defaultDictionary;
      assumedDictionary = dictionary !== FileTable.defaultDictionary;
    }
    const missing =
      this.tables
        .get(tableKey(resolvedPlatform))
        ?.get(tableKey(resolvedDictionary))
        ?.get("FTBL") === undefined;
    return {
      platform: resolvedPlatform,
      dictionary: resolvedDictionary,
      assumedPlatform,
      assumedDictionary,
      missing,
    };
  }

  private hasPlatform(platform: number): boolean {
    const key = tableKey(platform);
    return this.tables.has(key) || this.efst.has(key);
  }

  private hasDictionary(dictionary: number, platform: number): boolean {
    const platformKey = tableKey(platform);
    const key = tableKey(dictionary);
    return (
      this.tables.get(platformKey)?.has(key) === true ||
      this.efst.get(platformKey)?.has(key) === true
    );
  }

  /**
   * The `FTBL` record that names low-level file `index` in the table
   * `platform`/`dictionary` resolves to, or `undefined` where nothing names it.
   *
   * **The first match, and only the first** — upstream's loop ends on one
   * (`break # Stop searching FTBL Dictionary at first VFS ID match`, MEA.py
   * 8444), and a `vfsID` is shared more often than not: 4836 of the file's
   * `vfsID`s are claimed by two records under different paths. The later ones
   * are records upstream never prints, so showing them would be a name this
   * file does not have.
   *
   * "First" is the order the records are written in, which neither a Swift
   * dictionary nor a JavaScript object keeps — so the pick is the lowest
   * **file ID** instead. The two are the same order on the data as shipped:
   * over all 70 tables and all 4836 shared `vfsID`s, the record written first
   * is the one with the lowest file ID, every time. A deterministic rule that
   * reproduces upstream's answer beats keeping 5 MB of text around to remember
   * what order it was in.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.record
   */
  recordForFileIndex(
    index: number,
    platform: number,
    dictionary: number
  ): FileTableEntry | undefined {
    return this.ftblByVfs(platform, dictionary)?.get(index);
  }

  /**
   * The `FTBL` record stored **under `fileID` as its key** — the lookup a
   * Configuration record needs, which is not the same lookup a file index
   * needs: an MFS/EFS file is found by the `vfsID` *inside* a record
   * (`recordForFileIndex`), while a 0xC Configuration record carries the
   * record's own key and reads the row at it directly (upstream
   * `ftbl_dict[pl][id]['FTBL'][ftbl_rec_id]`, MEA.py 8546).
   *
   * `undefined` where no row is keyed by that ID — upstream warns and falls
   * back to `/Unknown/<ID>.bin`, which is the panel's job to say.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.record
   */
  recordForFileID(
    fileID: number,
    platform: number,
    dictionary: number
  ): FileTableEntry | undefined {
    const records = this.ftblRecords(platform, dictionary);
    if (records === undefined) return undefined;
    const key = fileID.toString(16).toUpperCase().padStart(8, "0");
    const record = records.get(key);
    return record === undefined ? undefined : fileTableEntry(key, record);
  }

  /**
   * The `FTBL` table the two record lookups read, or `undefined` when this
   * platform and dictionary resolve to none.
   */
  private ftblRecords(platform: number, dictionary: number): Map<string, string> | undefined {
    const resolution = this.resolve(platform, dictionary);
    if (resolution.missing) return undefined;
    return this.tables
      .get(tableKey(resolution.platform))
      ?.get(tableKey(resolution.dictionary))
      ?.get("FTBL");
  }

  /**
   * `vfsID` → the record that claims it, for the table `platform`/`dictionary`
   * resolve to — the one pass `recordForFileIndex` used to make per file, done
   * once and kept. `undefined` when the table resolves to none, the same answer
   * `ftblRecords` gives.
   *
   * The pick inside a shared `vfsID` is the lowest file ID, the rule
   * `recordForFileIndex` states: the string compare is kept as written, so the
   * index answers the way the walk did, record for record.
   */
  private ftblByVfs(platform: number, dictionary: number): Map<number, FileTableEntry> | undefined {
    const resolution = this.resolve(platform, dictionary);
    if (resolution.missing) return undefined;
    const key = `${tableKey(resolution.platform)}/${tableKey(resolution.dictionary)}`;
    const held = this.byVfs.get(key);
    if (held !== undefined) return held;
    const records = this.tables
      .get(tableKey(resolution.platform))
      ?.get(tableKey(resolution.dictionary))
      ?.get("FTBL");
    if (records === undefined) return undefined;
    const byVfs = new Map<number, FileTableEntry>();
    for (const [fileID, record] of records) {
      const entry = fileTableEntry(fileID, record);
      if (entry === undefined) continue;
      const current = byVfs.get(entry.vfsID);
      if (current === undefined || entry.fileID < current.fileID) byVfs.set(entry.vfsID, entry);
    }
    this.byVfs.set(key, byVfs);
    return byVfs;
  }

  /**
   * The `EFST` entries describing an EFS volume of table `revision`, in the
   * order they sit in the data area, or `undefined` when this
   * platform/dictionary carries no `EFST` or none at that revision (upstream
   * errors out on both, MEA.py 8946–8950).
   *
   * `platform` and `dictionary` are the **MFS** volume header's, not the EFS
   * System page's — upstream hands `efs_anl` the values `mfs_anl` read
   * (MEA.py 5618), and the EFS page's own Dictionary is only checked against
   * them. `revision` is the EFS System page's `DictRevision`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.efsEntries
   */
  efsEntries(
    platform: number,
    dictionary: number,
    revision: number
  ): readonly FileTableEFSEntry[] | undefined {
    const resolution = this.resolve(platform, dictionary);
    const records = this.efst
      .get(tableKey(resolution.platform))
      ?.get(tableKey(resolution.dictionary))
      ?.get(tableKey(revision));
    if (records === undefined) return undefined;
    const entries: FileTableEFSEntry[] = [];
    for (const [offsetKey, record] of records) {
      const entry = fileTableEFSEntry(offsetKey, record);
      if (entry !== undefined) entries.push(entry);
    }
    return entries.sort((a, b) => a.dataOffset - b.dataOffset);
  }

  /**
   * Whether this platform/dictionary has an `EFST` at all, so a panel can tell
   * "no table for this volume" from "a table that named nothing".
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.hasEFST
   */
  hasEFST(platform: number, dictionary: number): boolean {
    const resolution = this.resolve(platform, dictionary);
    return (
      this.efst.get(tableKey(resolution.platform))?.get(tableKey(resolution.dictionary)) !==
      undefined
    );
  }

  /**
   * `FileTable.dat` as it is downloaded. Malformed JSON is an error — the
   * caller keeps what it had — and a platform, dictionary or table of an
   * unexpected shape is skipped, which is how the file grows a new one without
   * breaking this parser.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.parse
   */
  static parse(text: string): FileTable {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("FileTable.dat is not JSON");
    }
    const root = objectAt(parsed);
    if (root === undefined || Object.keys(root).length === 0) {
      throw new Error("FileTable.dat is not JSON");
    }

    const tables: Tables = new Map();
    const efst: EFSTTables = new Map();
    for (const [platform, dictionaries] of Object.entries(root)) {
      const byPlatform = objectAt(dictionaries);
      if (byPlatform === undefined) continue;
      const byDictionary: Map<string, Map<string, Map<string, string>>> = new Map();
      const efstByDictionary: Map<string, Map<string, Map<string, string>>> = new Map();
      for (const [dictionary, named] of Object.entries(byPlatform)) {
        const byDictionaryValue = objectAt(named);
        if (byDictionaryValue === undefined) continue;
        const byTable: Map<string, Map<string, string>> = new Map();
        for (const [table, records] of Object.entries(byDictionaryValue)) {
          // `EFST` keys its records by revision first; every other table is
          // flat. A table of neither shape is skipped, which is how the file
          // grows a new one without breaking this.
          if (table.toUpperCase() === "EFST") {
            const revisions = objectAt(records);
            if (revisions === undefined) continue;
            const byRevision: Map<string, Map<string, string>> = new Map();
            for (const [revision, entries] of Object.entries(revisions)) {
              const records = stringRecords(entries);
              if (records === undefined) continue;
              byRevision.set(revision.toUpperCase(), new Map(Object.entries(records)));
            }
            if (byRevision.size > 0) {
              efstByDictionary.set(dictionary.toUpperCase(), byRevision);
            }
            continue;
          }
          const flat = stringRecords(records);
          if (flat === undefined) continue;
          byTable.set(table.toUpperCase(), new Map(Object.entries(flat)));
        }
        if (byTable.size > 0) byDictionary.set(dictionary.toUpperCase(), byTable);
      }
      if (byDictionary.size > 0) tables.set(platform.toUpperCase(), byDictionary);
      if (efstByDictionary.size > 0) efst.set(platform.toUpperCase(), efstByDictionary);
    }

    if (tables.size === 0 && efst.size === 0) {
      throw new Error("FileTable.dat is not JSON");
    }
    return new FileTable({ tables, efst });
  }
}

/**
 * One record string, typed. `undefined` for a record that does not carry the
 * nine fields upstream unpacks — a shorter or unparseable row names nothing,
 * and guessing at its fields would put a wrong flag on a real file.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.entry
 */
export function fileTableEntry(fileID: string, record: string): FileTableEntry | undefined {
  const parts = record.split(",");
  if (parts.length < 9) return undefined;
  const numbers = parts.slice(1).map((part) => wholeNumber(part.trim()));
  if (numbers.some((value) => value === undefined)) return undefined;
  const value = numbers as number[];
  return {
    fileID,
    path: parts[0] ?? "",
    integrity: (value[0] ?? 0) !== 0,
    encryption: (value[1] ?? 0) !== 0,
    antiReplay: (value[2] ?? 0) !== 0,
    accessUnknown: value[3] ?? 0,
    groupID: value[4] ?? 0,
    userID: value[5] ?? 0,
    vfsID: value[6] ?? 0,
    unknown: value[7] ?? 0,
  };
}

/**
 * One `EFST` record, typed: `page,pageOffset,size,fileID,reserved,name`, keyed
 * by the file's hex offset into the data area. `undefined` for anything that
 * does not carry those six fields — a record read wrong would put a name on
 * the wrong bytes.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/FileTable.swift#FileTable.efsEntry
 */
export function fileTableEFSEntry(
  offsetKey: string,
  record: string
): FileTableEFSEntry | undefined {
  const parts = record.split(",");
  if (parts.length < 6) return undefined;
  const dataOffset = hexNumber(offsetKey.trim());
  if (dataOffset === undefined || dataOffset < 0) return undefined;
  const numbers = parts.slice(0, 5).map((part) => wholeNumber(part.trim()));
  if (numbers.some((value) => value === undefined)) return undefined;
  const value = numbers as number[];
  const name = parts.slice(5).join(",").trim();
  if (name.length === 0) return undefined;
  return {
    dataOffset,
    page: value[0] ?? 0,
    pageOffset: value[1] ?? 0,
    size: value[2] ?? 0,
    fileID: value[3] ?? 0,
    reserved: value[4] ?? 0,
    name,
  };
}

/**
 * A signed decimal integer covering the whole string, as Swift's `Int(_:)`
 * reads one: a prefix that happens to start with digits is not a number here,
 * because a record's field read half-way is a wrong flag.
 */
function wholeNumber(text: string): number | undefined {
  return /^[+-]?\d+$/.test(text) ? Number.parseInt(text, 10) : undefined;
}

/** A hexadecimal integer covering the whole string, as `Int(_:radix: 16)` does. */
function hexNumber(text: string): number | undefined {
  return /^[0-9A-Fa-f]+$/.test(text) ? Number.parseInt(text, 16) : undefined;
}
