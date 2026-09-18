import type { MFSFile, MFSHomeRecord } from "@/firmware/me/models/fileSystemFacts";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { versionText } from "@/firmware/me/models/firmwareFacts";
import type { CPDExtension } from "@/firmware/me/partition/extensions";
import type { MEASummaryTone } from "@/tools/me/meaSummary";
import {
  countText,
  dateText,
  familyText,
  firmwareVersionText,
  hex,
  hex16,
  hex32,
  hexByte,
  manifestFormatText,
  offsetText,
  plainVersion,
  rangeText,
  rangeValue,
  sizeText,
  titleText,
  yesNo,
} from "@/tools/me/meaText";
import {
  codePartitionMarks,
  manifestMarks,
  metadataMarks,
  moduleMarks,
  tableMarks,
} from "@/tools/me/meaTreeMarks";
import {
  fileTableLabel,
  type MFSFileNames,
  NO_FILE_NAMES,
  recordForFile,
} from "@/tools/me/mfsFileNames";
import type { ToolRowMarks } from "@/tools/toolRowMarks";
import type { ZoneMap } from "@/tools/zone";

/**
 * The «Full Tree» tab: a `FirmwareAnalysis` as a curated tree. Ported from
 * upstream's `MEANode`, `MEACurator`, `MEAValueText` and `MEAZones`.
 *
 * Hand-named groups in a fixed order, one per structure the analysis carries —
 * identity first, then the layout, then the file system, then the fact groups of
 * whatever else decoded — with rows that stand for real bytes carrying the range
 * the panel reveals and zones. Everything a row can say is baked into the node,
 * so a selection never asks the analysis again. Structures not worth mapping row
 * by row are dumped field by field.
 */

/** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEAField */
export interface MEAField {
  /** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEAField.label */
  readonly label: string;
  /** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEAField.value */
  readonly value: string;
  /**
   * What the value says, when it is a verdict: `good` draws it with the green
   * done mark — a check that found nothing wrong.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEAField.tone
   * @upstream-differs absent reads as standard
   */
  readonly tone?: MEASummaryTone;
}

/** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode */
export interface MEANode {
  /**
   * An index per level; `[0]` is the first root. Stable across re-reads of the same file.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.path
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.id
   * @upstream-differs the node's path is its identity
   */
  readonly path: readonly number[];
  /** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.title */
  readonly title: string;
  /**
   * The row's second column — usually `offset · size`.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.subtitle
   */
  readonly subtitle: string;
  /**
   * The file bytes the row stands for, when the model gives a reliable range.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.range
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.hasBytes
   * @upstream-differs a node has bytes when its range is defined
   */
  readonly range: { readonly start: number; readonly end: number } | undefined;
  /** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.fields */
  readonly fields: readonly MEAField[];
  /** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.children */
  readonly children: readonly MEANode[];
  /**
   * A place in the layout that holds nothing: drawn grey.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.isEmptySection
   */
  readonly isEmptySection: boolean;
  /**
   * What the row wears besides its text (`Design/ROW_MARKS.md` §5.3): the rail,
   * a compressed or holds-checks badge, a problem — decided when the node is
   * built (`MEATreeMarks`), since everything it is decided from is in the
   * analysis the node comes out of.
   *
   * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEANode.marks
   * @upstream-differs absent reads as none
   */
  readonly marks: ToolRowMarks | undefined;
}

/** The region's digests, which the analysis leaves out until they are asked for. */
export interface MEAChecksums {
  readonly sha256: string | undefined;
  readonly sha384: string | undefined;
  readonly crc32: number | undefined;
}

/**
 * What the checksums group is called, and what its rows say before they are computed.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.checksumsTitle
 */
export const CHECKSUMS_TITLE = "Checksums";
/** @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.pendingValue */
export const PENDING_VALUE = "Loading…";

/** A node before its place in the tree is known. */
interface Draft {
  readonly title: string;
  readonly subtitle?: string;
  readonly range?: { readonly start: number; readonly end: number } | undefined;
  readonly fields?: readonly MEAField[];
  readonly children?: readonly Draft[];
  readonly isEmptySection?: boolean;
  readonly marks?: ToolRowMarks;
}

/** @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEAField.init */
const field = (label: string, value: string, tone: MEASummaryTone = "standard"): MEAField =>
  tone === "standard" ? { label, value } : { label, value, tone };

/** Label/value rows, leaving out a value that is absent — or empty, where that is asked. */
class Fields {
  readonly rows: MEAField[] = [];
  add(label: string, value: string | number | undefined, dropEmpty = false): this {
    if (value === undefined) return this;
    const text = typeof value === "number" ? String(value) : value;
    if (dropEmpty && text.length === 0) return this;
    this.rows.push(field(label, text));
    return this;
  }
}

/**
 * The tree's roots, in reading order.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator
 * @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.present
 */
export function presentMEA(
  analysis: FirmwareAnalysis,
  checksums: MEAChecksums | undefined,
  mfsNames: MFSFileNames = NO_FILE_NAMES
): MEANode[] {
  const drafts = [
    firmware(analysis),
    regions(analysis),
    cseLayout(analysis),
    bootPartitions(analysis),
    codePartition(analysis),
    manifest(analysis),
    mfsVolume(analysis, mfsNames),
    // The fact groups — everything else a dump carried, each only when present.
    backupGroup(analysis),
    efsGroup(analysis),
    oemGroup(analysis),
    mmeGroup(analysis),
    gscGroup(analysis),
    oromGroup(analysis),
    rbeGroup(analysis),
    checksumsGroup(checksums),
    issuesGroup(analysis),
  ].filter((one): one is Draft => one !== undefined);
  return drafts.map((draft, index) => finish(draft, [index]));
}

function finish(draft: Draft, path: readonly number[]): MEANode {
  return {
    path,
    title: draft.title,
    subtitle: draft.subtitle ?? "",
    range: draft.range,
    fields: draft.fields ?? [],
    children: (draft.children ?? []).map((child, index) => finish(child, [...path, index])),
    isEmptySection: draft.isEmptySection ?? false,
    marks: draft.marks,
  };
}

/**
 * The node at `path`, or nothing when the tree no longer reaches that far.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEATree
 * @upstream Modules/MEATool/Sources/MEATool/MEANode.swift#MEATree.node
 */
export function meaNodeAt(roots: readonly MEANode[], path: readonly number[]): MEANode | undefined {
  let nodes = roots;
  let found: MEANode | undefined;
  for (const index of path) {
    found = nodes[index];
    if (found === undefined) return undefined;
    nodes = found.children;
  }
  return found;
}

/**
 * The checksums group's path, when the tree has one.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.checksumsPath
 */
export function checksumsPath(roots: readonly MEANode[]): readonly number[] | undefined {
  return roots.find((root) => root.title === CHECKSUMS_TITLE)?.path;
}

/**
 * The zone a selected row publishes: one, focused, for its bytes — and nothing
 * for a row that stands for none (a group, the manifest).
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAZones.swift#MEAZones
 * @upstream Modules/MEATool/Sources/MEATool/MEAZones.swift#MEAZones.build
 * @upstream Modules/MEATool/Sources/MEATool/MEAZones.swift#MEAZones.id
 * @upstream-differs the zone id is the path joined inline
 */
export function meaZones(focus: MEANode | undefined): ZoneMap {
  if (focus?.range === undefined) return { zones: [], focus: undefined };
  const id = focus.path.join("/");
  return {
    zones: [
      {
        id,
        name: focus.title.length === 0 ? "(unnamed)" : focus.title,
        start: focus.range.start,
        end: focus.range.end,
      },
    ],
    focus: id,
  };
}

// MARK: - Identity

/**
 * @upstream Modules/MEATool/Sources/MEATool/MEAValueText.swift#MEAText.firmwareImageTool
 * @upstream-differs the Flash Image Tool cell is read inline with the identity rows
 */
function firmware(a: FirmwareAnalysis): Draft {
  const version = versionText(a.version);
  const fields = new Fields()
    .add("Family", familyText(a.family))
    .add("Variant", a.variant, true)
    .add("Version", version)
    .add("MEU Version", meuVersion(a))
    .add("Security Version", a.securityVersion, true)
    .add("Release", titleText(a.release))
    .add("Type", titleText(a.type))
    .add("SKU", a.sku, true)
    .add("Platform", a.platform, true)
    .add("Chipset Stepping", a.chipsetStepping, true)
    .add("Manufacture Date", manufactureDate(a))
    .add("Size", sizeText(a.sizeBytes))
    .add("Database Name", a.databaseName, true)
    .add(
      "RSA Signature Valid",
      a.rsaSignatureValid === undefined ? undefined : yesNo(a.rsaSignatureValid)
    )
    .add("ARB SVN", a.arbSvn)
    .add("VCN", a.vcn)
    .add("File System State", a.mfsState === undefined ? undefined : titleText(a.mfsState));
  // A non-IFWI image's $FPT header FIT; an IFWI's sits on each boot BPDT.
  if (a.fptHeaderFIT !== undefined) {
    const fit = a.fptHeaderFIT;
    fields.add(
      "Flash Image Tool",
      firmwareVersionText(a.variant, fit.major, fit.minor, fit.hotfix, fit.build)
    );
  }
  return {
    title: "Firmware",
    subtitle: `${familyText(a.family)} · ${version}`,
    fields: fields.rows,
  };
}

/**
 * The whole MEU block, when all four fields are there.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAValueText.swift#Version.meText
 */
function meuVersion(a: FirmwareAnalysis): string | undefined {
  const { meMajor, meMinor, meHotfix, meBuild } = a.version;
  if (meMajor === undefined || meMinor === undefined || meHotfix === undefined) return undefined;
  if (meBuild === undefined) return undefined;
  return plainVersion(meMajor, meMinor, meHotfix, meBuild);
}

/**
 * The date the operational manifest was built — what MEA prints as the firmware's.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Models/FirmwareAnalysis.swift#FirmwareAnalysis.manufactureDate
 * @upstream-differs derived from the manifest's day, month and year where it is shown, not stored on the analysis
 */
export function manufactureDate(a: FirmwareAnalysis): string | undefined {
  const m = a.manifest;
  return m === undefined ? undefined : dateText(m.year, m.month, m.day);
}

// MARK: - Layout

function regions(a: FirmwareAnalysis): Draft | undefined {
  if (a.regions.length === 0) return undefined;
  const rows = a.regions.map(
    (region): Draft => ({
      title: region.name.length === 0 ? "(unnamed)" : region.name,
      subtitle: rangeText(region.offset, region.size),
      range: rangeValue(region.offset, region.size),
      fields: new Fields()
        .add("Name", region.name, true)
        .add("Offset", offsetText(region.offset))
        .add("Size", sizeText(region.size))
        .add("Flags", hex32(region.flags)).rows,
      isEmptySection: region.size === 0,
    })
  );
  return { title: "Regions (FPT)", subtitle: countText(rows.length, "region"), children: rows };
}

function cseLayout(a: FirmwareAnalysis): Draft | undefined {
  const table = a.cseLayoutTable;
  if (table === undefined) return undefined;
  const rows = table.partitions.map(
    (p): Draft => ({
      title: p.name.length === 0 ? "(unnamed)" : p.name,
      subtitle: rangeText(p.offset, p.size),
      range: p.empty ? undefined : rangeValue(p.offset, p.size),
      fields: new Fields()
        .add("Name", p.name, true)
        .add("Offset", offsetText(p.offset))
        .add("Size", sizeText(p.size))
        .add("Empty", yesNo(p.empty)).rows,
      // The layout's own flag: a slot with no offset or size, or erased content.
      isEmptySection: p.empty,
    })
  );
  return {
    title: "CSE Layout Table",
    subtitle: countText(table.partitions.length, "partition"),
    fields: new Fields()
      .add("Offset", offsetText(table.offset))
      .add("Version", hex(table.version))
      .add("Redundancy", yesNo(table.redundancy))
      .add(
        "Checksum Valid",
        table.checksumValid === undefined ? "— (1.6 has none)" : yesNo(table.checksumValid)
      ).rows,
    children: rows,
    marks: tableMarks("CSE Layout Table", table.checksumValid),
  };
}

function bootPartitions(a: FirmwareAnalysis): Draft | undefined {
  const tables = a.bootPartitions;
  if (tables === undefined || tables.length === 0) return undefined;
  const rows = tables.map((bpdt): Draft => {
    const header = new Fields()
      .add("Offset", offsetText(bpdt.offset))
      .add("Boot Slot", bpdt.partitionName)
      .add("Version", `IFWI ${bpdt.version === 2 ? "1.7" : "1.6"}`)
      .add("Redundancy", yesNo(bpdt.redundancy))
      .add(
        "Checksum Valid",
        bpdt.checksumValid === undefined ? "— (version 1 has none)" : yesNo(bpdt.checksumValid)
      );
    if (bpdt.fit !== undefined) {
      const fit = bpdt.fit;
      header.add(
        "FIT Version",
        firmwareVersionText(a.variant, fit.major, fit.minor, fit.hotfix, fit.build)
      );
    }
    const entries = bpdt.entries.map(
      (e): Draft => ({
        title: e.name.length === 0 ? "(unnamed)" : e.name,
        subtitle: rangeText(e.offset, e.size),
        range: e.empty ? undefined : rangeValue(e.offset, e.size),
        fields: new Fields()
          .add("Name", e.name, true)
          .add("Type", hex16(e.type))
          .add("Offset", offsetText(e.offset))
          .add("Size", sizeText(e.size))
          .add("Empty", yesNo(e.empty)).rows,
        isEmptySection: e.empty,
      })
    );
    return {
      title: bpdt.partitionName,
      subtitle: countText(bpdt.entries.length, "entry"),
      fields: header.rows,
      children: entries,
      marks: tableMarks("BPDT", bpdt.checksumValid),
    };
  });
  return {
    title: "Boot Partitions (BPDT)",
    subtitle: countText(tables.length, "table"),
    children: rows,
  };
}

function codePartition(a: FirmwareAnalysis): Draft | undefined {
  const cp = a.codePartition;
  if (cp === undefined) return undefined;
  const header = new Fields()
    .add("Name", cp.name)
    .add("Offset", offsetText(cp.offset))
    .add("Header", `R${cp.headerVersion}`)
    .add("Header Length", hex(cp.headerLength))
    .add("Declared Modules", cp.numModules)
    .add("Decoded Modules", cp.modules.length)
    .add("Checksum Valid", cp.checksumValid === undefined ? undefined : yesNo(cp.checksumValid));

  const children: Draft[] = [];
  if (cp.modules.length > 0) {
    const rows = cp.modules.map(
      (m, index): Draft => ({
        title: m.name.length === 0 ? `(module ${index})` : m.name,
        // A Huffman module's stored size is its packed size, and what it
        // decompresses to is elsewhere: there is no reliable range to reveal.
        subtitle: m.isHuffman ? sizeText(m.size) : rangeText(m.offset, m.size),
        range: m.isHuffman ? undefined : rangeValue(m.offset, m.size),
        fields: new Fields()
          .add("Name", m.name)
          // Module offsets are absolute in this model; upstream's count from the $CPD.
          .add("Offset in $CPD", offsetText(m.offset - cp.offset))
          .add("Size", sizeText(m.size))
          .add("Huffman", yesNo(m.isHuffman)).rows,
        isEmptySection: m.size === 0,
        marks: moduleMarks(m, cp, a),
      })
    );
    children.push({ title: "Modules", subtitle: countText(rows.length, "module"), children: rows });
  }
  if (cp.extensions.length > 0) {
    const rows = cp.extensions.map(extensionRow);
    children.push({
      title: "Extensions",
      subtitle: countText(rows.length, "block"),
      children: rows,
    });
  }
  return {
    title: "Code Partition ($CPD)",
    subtitle: `${cp.name} · ${cp.headerVersion === 1 ? "R1" : "R2"}`,
    fields: header.rows,
    children,
    marks: codePartitionMarks(cp),
  };
}

const EXTENSION_NAMES: Readonly<Record<number, string>> = {
  0: "System Info",
  1: "Init Script",
  2: "Feature Permissions",
  3: "Partition Info",
  4: "Shared Library",
  5: "Process Attributes",
  6: "Thread Attributes",
  7: "Device Types",
  8: "MMIO Ranges",
  9: "Special Files",
  10: "Module Attributes",
  11: "Locked Ranges",
  12: "Client System Info",
  13: "User Info",
  15: "Signed Package",
  22: "Partition Info",
};

/**
 * The one decoded payload of an extension, in upstream's order of asking. The
 * row-table blocks this model keeps as bare arrays upstream wraps in a struct of
 * `rows`, which is what its dump labels them.
 */
function payloadOf(ext: CPDExtension): unknown {
  return (
    ext.signedPackage ??
    ext.partitionInfo ??
    ext.systemInfo ??
    ext.clientSystemInfo ??
    ext.featurePermissions ??
    ext.moduleAttributes ??
    ext.sharedLibrary ??
    ext.processAttributes ??
    wrapped(ext.threadRows) ??
    wrapped(ext.deviceRows) ??
    wrapped(ext.mmioRows) ??
    ext.specialFiles ??
    wrapped(ext.lockedRanges) ??
    wrapped(ext.userInfoRows)
  );
}

const wrapped = (rows: readonly unknown[] | undefined) =>
  rows === undefined ? undefined : { rows };

function extensionRow(ext: CPDExtension): Draft {
  const fields = new Fields()
    .add("Tag", hexByte(ext.tag))
    .add("Offset", offsetText(ext.offset))
    .add("Size", sizeText(ext.size)).rows;
  const payload = payloadOf(ext);
  if (payload !== undefined) fields.push(...valueFields(payload));
  return {
    title: EXTENSION_NAMES[ext.tag] ?? `CSE_Ext ${hexByte(ext.tag)}`,
    subtitle: rangeText(ext.offset, ext.size),
    range: rangeValue(ext.offset, ext.size),
    fields,
    isEmptySection: ext.size === 0,
  };
}

function manifest(a: FirmwareAnalysis): Draft | undefined {
  const m = a.manifest;
  if (m === undefined) return undefined;
  return {
    title: "Manifest",
    subtitle: `${m.tag} · ${manifestFormatText(m.format)}`,
    fields: new Fields()
      .add("Tag", m.tag)
      .add("Format", manifestFormatText(m.format))
      .add("Offset", offsetText(m.offset))
      .add("Version", plainVersion(m.major, m.minor, m.hotfix, m.build))
      .add("SVN", m.svn)
      .add("Date", dateText(m.year, m.month, m.day))
      .add("Key SHA-256", m.keyHash, true)
      .add("Signature SHA-256", m.signatureHash, true)
      .add("VCN", m.vcn)
      .add(
        "Production Ready",
        m.productionReady === undefined ? undefined : yesNo(m.productionReady)
      ).rows,
    marks: manifestMarks(a),
  };
}

// MARK: - File System (MFS)

function mfsVolume(a: FirmwareAnalysis, names: MFSFileNames): Draft | undefined {
  const vol = a.mfsVolume;
  if (vol === undefined) return undefined;
  const header = new Fields()
    .add("Offset", offsetText(vol.offset))
    .add("Page Size", sizeText(vol.pageSize))
    .add("Page Count", vol.pageCount)
    .add("System / Data Pages", `${vol.systemPageCount} / ${vol.dataPageCount}`)
    .add("Signature Valid", yesNo(vol.signatureValid))
    .add("Volume Size", sizeText(vol.volumeSize))
    .add("Computed Volume Size", sizeText(vol.computedVolumeSize))
    .add("File Records", vol.fileRecordCount)
    .add("Used Records", vol.usedFileCount)
    .add("Present Files", vol.presentFileCount)
    .add("File Bytes", sizeText(vol.fileBytes))
    .add("FTBL Dictionary", hex(vol.ftblDictionary))
    .add("FTBL Platform", hex(vol.ftblPlatform))
    .add("Uses FileTable.dat", yesNo(vol.usesFTBL));
  // Where the names on the file rows came from — and whether either half of the
  // table was assumed rather than named by the volume. Only when a lookup was
  // actually made: a legacy volume names its own files.
  header.add("File Table", fileTableLabel(names));

  const children: Draft[] = [];
  if (vol.files.length > 0) {
    const rows = vol.files.map((f): Draft => mfsFileRow(f, names));
    children.push({ title: "Files", subtitle: countText(rows.length, "file"), children: rows });
  }
  if (vol.configurations.length > 0) {
    const rows = vol.configurations.map(
      (config, index): Draft => ({ title: `Configuration ${index}`, fields: valueFields(config) })
    );
    children.push({
      title: "Configurations",
      subtitle: countText(rows.length, "record"),
      children: rows,
    });
  }
  if (vol.homeDirectory !== undefined) {
    const home = vol.homeDirectory;
    children.push({
      title: "Home Directory",
      subtitle: countText(home.entries.length, "entry"),
      fields: new Fields()
        .add("Record Size", hex(home.homeRecordSize))
        .add("Root Records", home.rootRecordCount).rows,
      children: home.entries.map(homeRow),
    });
  }
  if (vol.pchInit !== undefined) {
    const pch = vol.pchInit;
    children.push({
      title: "Chipset Initialization",
      fields: new Fields().add("Records", pch.records.length).add("Chipsets", pch.chipsets.length)
        .rows,
      children: pch.chipsets.map(
        (one): Draft => ({
          title: one.chipset,
          subtitle: one.steppings,
          fields: [field("Chipset", one.chipset), field("Steppings", one.steppings)],
        })
      ),
    });
  }
  if (vol.reservedIntegrity.length > 0) {
    const rows = vol.reservedIntegrity.map(
      (one, index): Draft => ({ title: `Integrity ${index + 1}`, fields: valueFields(one) })
    );
    children.push({
      title: "File Integrity",
      subtitle: countText(rows.length, "table"),
      children: rows,
    });
  }
  return {
    title: "File System (MFS)",
    subtitle: countText(vol.presentFileCount, "file"),
    fields: header.rows,
    children,
  };
}

/**
 * One present low-level file. Numbered where nothing names it — which is every
 * legacy volume's rows, and an FTBL volume's before its table arrives — and
 * named where `FileTable.dat` does.
 *
 * The fields describe the record the title came from, which is why the File ID
 * is among them: a reader checking the panel against upstream's console is
 * looking at that number.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.mfsFileRow
 */
function mfsFileRow(file: MFSFile, names: MFSFileNames): Draft {
  const record = recordForFile(names, file.index);
  const fields = new Fields().add("Index", file.index).add("Size", sizeText(file.size));
  if (record !== undefined) {
    fields
      .add("Path", record.path)
      .add("File ID", `0x${record.fileId}`)
      .add("Integrity", yesNo(record.integrity))
      .add("Encryption", yesNo(record.encryption))
      .add("Anti-Replay", yesNo(record.antiReplay))
      .add("Group ID", hex(record.groupId))
      .add("User ID", hex(record.userId));
  }
  return {
    title: record?.path ?? `File ${file.index}`,
    // A named row's subtitle keeps the number the flash actually carries: the
    // index is what the volume says about the file, and a reader comparing the
    // panel with a dump — or with upstream's own `path (0063)` — needs it.
    // @upstream Modules/MEATool/Sources/MEATool/MEACurator.swift#MEACurator.mfsFileSubtitle
    subtitle:
      record === undefined ? sizeText(file.size) : `#${file.index} · ${sizeText(file.size)}`,
    // A present file's position is the FAT chain walk, which is not exposed.
    fields: fields.rows,
    isEmptySection: file.size === 0,
  };
}

function homeRow(record: MFSHomeRecord): Draft {
  const fields = new Fields()
    .add("File Index", record.fileIndex)
    .add("Kind", record.isFolder ? "Folder" : "File")
    .add("File System", record.fileSystemID);
  if (!record.isFolder) fields.add("Size", sizeText(record.size));
  return {
    title:
      record.name.length === 0
        ? `${record.isFolder ? "Folder" : "File"} ${record.fileIndex}`
        : record.name,
    subtitle: `${record.isFolder ? "folder" : "file"} #${record.fileIndex}`,
    fields: fields.rows,
    children: record.children.map(homeRow),
  };
}

// MARK: - Fact groups

const BACKUP_FILE_NAMES: Readonly<Record<number, string>> = {
  6: "Intel Configuration",
  7: "OEM Configuration",
  9: "Manifest Backup",
};

function backupGroup(a: FirmwareAnalysis): Draft | undefined {
  const backup = a.mfsBackup;
  if (backup === undefined) return undefined;
  const format = backup.format === "r1" ? "R1" : "R0";
  const fields = new Fields()
    .add("Format", format)
    .add("Offset", offsetText(backup.offset))
    .add("Header CRC", hex32(backup.headerCRCStored))
    .add("Header CRC Valid", yesNo(backup.headerCRCValid))
    .add(
      "Reserved All 0xFF",
      backup.reservedAllFF === undefined ? undefined : yesNo(backup.reservedAllFF)
    )
    .add(
      "Reconstructed Volume Parses",
      backup.reconstructedVolumeParses === undefined
        ? undefined
        : yesNo(backup.reconstructedVolumeParses)
    );
  if (backup.headerRevision !== undefined) {
    fields
      .add("Header Revision", backup.headerRevision)
      .add(
        "Header Revision Valid",
        backup.headerRevisionValid === undefined ? undefined : yesNo(backup.headerRevisionValid)
      );
  }
  const rows = backup.entries.map((entry): Draft => {
    const name = BACKUP_FILE_NAMES[entry.fileIndex];
    return {
      title: `Entry ${entry.fileIndex}`,
      subtitle: name ?? `low-level file ${entry.fileIndex}`,
      fields: new Fields()
        .add("File Index", entry.fileIndex)
        .add("File", name ?? `Low-level file ${entry.fileIndex}`)
        .add("Blob Offset", offsetText(entry.blobOffset))
        .add("Blob Size", sizeText(entry.blobSize))
        .add("Data Size", sizeText(entry.dataSize))
        .add("Revision Valid", yesNo(entry.revisionValid))
        .add("Header CRC", hex32(entry.headerCRCStored))
        .add("Header CRC Valid", yesNo(entry.headerCRCValid))
        .add("Data CRC", hex32(entry.dataCRCStored))
        .add("Data CRC Valid", yesNo(entry.dataCRCValid)).rows,
    };
  });
  return { title: "MFS Backup", subtitle: format, fields: fields.rows, children: rows };
}

function efsGroup(a: FirmwareAnalysis): Draft | undefined {
  const efs = a.efsVolume;
  if (efs === undefined) return undefined;
  return { title: "EFS Volume", subtitle: offsetText(efs.offset), fields: valueFields(efs) };
}

function oemGroup(a: FirmwareAnalysis): Draft | undefined {
  const oem = a.oemConfiguration;
  return oem === undefined ? undefined : { title: "OEM Configuration", fields: valueFields(oem) };
}

function mmeGroup(a: FirmwareAnalysis): Draft | undefined {
  const dir = a.mmeDirectory;
  if (dir === undefined) return undefined;
  return {
    title: "$MME Directory",
    fields: new Fields()
      .add("Manifest", dir.manifestTag)
      .add("Offset", offsetText(dir.offset))
      .add("Declared Modules", dir.declaredModules)
      .add("Decoded Modules", dir.modules.length).rows,
    children: dir.modules.map(
      (module, index): Draft => ({ title: `Module ${index + 1}`, fields: valueFields(module) })
    ),
  };
}

function gscGroup(a: FirmwareAnalysis): Draft | undefined {
  const gsc = a.gscInfo;
  return gsc === undefined ? undefined : { title: "GSC Info", fields: valueFields(gsc) };
}

function oromGroup(a: FirmwareAnalysis): Draft | undefined {
  const images = a.oromImages;
  if (images === undefined || images.length === 0) return undefined;
  const rows = images.map(
    (image, index): Draft => ({
      title: `Image ${index + 1}`,
      subtitle: offsetText(image.offset),
      fields: valueFields(image),
    })
  );
  return { title: "OROM Images", subtitle: countText(rows.length, "image"), children: rows };
}

function rbeGroup(a: FirmwareAnalysis): Draft | undefined {
  const rows = a.rbePmMetadata;
  if (rows === undefined || rows.length === 0) return undefined;
  // Read out of the pm / rbe module's decompressed body: the rail, when that
  // module is stored compressed, on the group and on every row.
  const marks = metadataMarks(a);
  const children = rows.map(
    (row, index): Draft => ({
      title: `${row.variant.toUpperCase()} #${index}`,
      fields: valueFields(row),
      marks,
    })
  );
  // Upstream's leftover report: what the rbe / pm tables list that no module of
  // the image hashes to.
  const fields: MEAField[] = [];
  const nodes = [...children];
  const unmatched = a.unmatchedMetadataHashes;
  if (unmatched !== undefined) {
    // Every hash accounted for is a check that passed: the done mark.
    fields.push(
      unmatched.length === 0
        ? field("Unmatched Hashes", "None", "good")
        : field("Unmatched Hashes", String(unmatched.length))
    );
    if (unmatched.length > 0) {
      nodes.push({
        title: "Unmatched Hashes",
        subtitle: String(unmatched.length),
        fields: [
          field(
            "Meaning",
            "Listed by the rbe or pm metadata table, and hashed to by no module of the image — " +
              "most often an encrypted module (NFTP pavp, PCOD), which cannot be hashed as it is loaded"
          ),
        ],
        children: unmatched.map((hash, index) => ({
          title: `Hash ${index + 1}`,
          subtitle: `${hash.slice(0, 16)}…`,
          fields: [field("Hash", hash)],
          marks,
        })),
        marks,
      });
    }
  }
  return {
    title: "RBE/PM Metadata",
    subtitle: countText(rows.length, "row"),
    fields,
    children: nodes,
    marks,
  };
}

/**
 * The region's own digests: the one group whose values the analysis does not
 * compute, being three passes over the region for three rows. It stands with
 * placeholders until selecting it asks for them; asked for and unanswerable, it
 * goes rather than promising numbers for ever.
 */
function checksumsGroup(checksums: MEAChecksums | undefined): Draft | undefined {
  if (checksums === undefined) {
    return {
      title: CHECKSUMS_TITLE,
      fields: [
        field("SHA-256", PENDING_VALUE),
        field("SHA-384", PENDING_VALUE),
        field("CRC-32", PENDING_VALUE),
      ],
    };
  }
  const fields = new Fields()
    .add("SHA-256", checksums.sha256, true)
    .add("SHA-384", checksums.sha384, true)
    .add("CRC-32", checksums.crc32 === undefined ? undefined : hex32(checksums.crc32)).rows;
  return fields.length === 0 ? undefined : { title: CHECKSUMS_TITLE, fields };
}

function issuesGroup(a: FirmwareAnalysis): Draft | undefined {
  if (a.issues.length === 0) return undefined;
  const rows = a.issues.map((issue): Draft => {
    const name = titleText(issue.severity);
    return {
      title: name,
      subtitle: issue.message,
      fields: [field("Severity", name), field("Message", issue.message)],
    };
  });
  return { title: "Issues", subtitle: countText(rows.length, "issue"), children: rows };
}

// MARK: - A structure nobody hand-mapped

/**
 * A field-by-field dump of a structure the tree does not name row by row:
 * nested objects flatten to `label.path`, a table of rows stops at its count,
 * and an absent or empty value is left out. Offsets, addresses, CRCs, tags,
 * masks, flags and types read as hex; every other number in decimal.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAValueText.swift#MEAValueText
 * @upstream Modules/MEATool/Sources/MEATool/MEAValueText.swift#MEAValueText.fields
 */
export function valueFields(value: unknown): MEAField[] {
  const out: MEAField[] = [];
  walk(value, "", out);
  return out;
}

function walk(value: unknown, path: string, out: MEAField[]): void {
  if (value === undefined || value === null) return;
  if (typeof value === "boolean") {
    if (path.length > 0) out.push(field(path, yesNo(value)));
    return;
  }
  if (typeof value === "string") {
    if (value.length > 0 && path.length > 0) out.push(field(path, value));
    return;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    if (path.length > 0) out.push(field(path, numberText(value, path)));
    return;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const length = Array.isArray(value) ? value.length : (value as Uint8Array).length;
    if (path.length > 0) out.push(field(path, `${length} entries`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, path.length === 0 ? key : `${path}.${key}`, out);
    }
  }
}

function numberText(value: number | bigint, path: string): string {
  const l = path.toLowerCase();
  const isCode =
    l.includes("offset") ||
    l.includes("address") ||
    l.includes("crc") ||
    l.includes("checksum") ||
    l.includes("tag") ||
    l.includes("mask") ||
    l.endsWith("flags") ||
    l.endsWith(".type") ||
    l === "type" ||
    l.includes("deviceid") ||
    l.includes("vendorid");
  if (!isCode) return String(value);
  return typeof value === "bigint" ? `0x${value.toString(16).toUpperCase()}` : hex(value);
}
