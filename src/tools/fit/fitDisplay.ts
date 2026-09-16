import {
  cseSecureBootSubtypeName,
  FIT,
  FIT_ENTRY_SIZE,
  type FITEntry,
  fitTypeName,
  isHeaderEntry,
  sizeInBytes,
  versionText,
} from "@/firmware/fit/fitEntry";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import {
  checksumIsCorrect,
  effectiveSize,
  type FITReport,
  type FITRow,
  type FITTable,
} from "@/firmware/fit/fitTable";
import {
  type FITBackupReading,
  type FITTopSwapBackup,
  topSwapSize,
} from "@/firmware/fit/fitTopSwap";
import { microcodeDate, microcodeRange } from "@/firmware/uefi/microcodeParser";
import { buildDetail, EMPTY_DETAIL, type FITRowDetail } from "@/tools/fit/fitDetail";
import { cpuidText, fitHex as hex } from "@/tools/fit/fitText";
import {
  latestOf,
  type MicrocodeCatalogueEntry,
  type MicrocodeLatest,
  NOT_RATED,
} from "@/tools/fit/microcodeCatalogue";
import type { ToolTransaction } from "@/tools/toolTransaction";
import { EMPTY_ZONES, type Zone, type ZoneMap } from "@/tools/zone";

/**
 * Everything the panel draws, in one value.
 *
 * It is built here and unit-tested, so the component has no decisions left in
 * it: it lays out what this says.
 *
 * Ported from `Modules/FITTool/FITDisplay.swift`.
 */

/**
 * What the right-button menu offers for a row.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITRowCommand
 */
export type FITRowCommand =
  /** The number a bench writes down and looks up. */
  | { readonly kind: "copyCPUID"; readonly cpuid: string }
  /** Go to what the row points at, and put it in focus. */
  | { readonly kind: "goToOffset"; readonly offset: number }
  /**
   * Swap the microcode this row names for another, whatever its CPUID. The row
   * stays; only the component it points at changes.
   */
  | { readonly kind: "replaceMicrocode"; readonly index: number }
  /**
   * Take the microcode out of the table. The component it named stays in the
   * image: erasing it is the riskier half of the edit.
   */
  | { readonly kind: "removeMicrocode"; readonly index: number }
  /**
   * Write the checksum this table should have. The byte is the header's, so
   * the offer sits on the header row — the one the mismatch turns red — and not
   * on the rows it is not about.
   */
  | { readonly kind: "fixChecksum" };

/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITRowCommand.title */
export function fitCommandTitle(command: FITRowCommand): string {
  switch (command.kind) {
    case "copyCPUID":
      return "Copy CPUID";
    case "goToOffset":
      return "Go to Offset";
    case "replaceMicrocode":
      return "Replace Microcode";
    case "removeMicrocode":
      return "Remove Microcode";
    case "fixChecksum":
      return "Fix Checksum";
  }
}

/**
 * One row as the panel shows it.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow
 */
export interface FITDisplayRow {
  /**
   * Its place in the table; 0 is the header.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.index
   */
  readonly index: number;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.typeText */
  readonly typeText: string;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.addressText */
  readonly addressText: string;
  /**
   * The size worth showing, in its own column: the component's for the rows
   * that point at one, the header's entry count for the header, and `0` for a
   * row whose size field is empty.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.sizeText
   */
  readonly sizeText: string;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.versionText */
  readonly versionText: string;
  /**
   * What is actually there, read rather than assumed: for microcode the CPUID,
   * the revision, the date, and where and how long it is.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.targetText
   */
  readonly targetText: string;
  /**
   * The CPUID of the microcode this row leads to, as hex digits with no leading
   * zero — what a bench writes down and looks up. Nothing for a row that does
   * not lead to microcode.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.cpuidText
   */
  readonly cpuidText: string | undefined;
  /**
   * Something is wrong with this row, and the panel says so by colour as well
   * as in the list below.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.hasProblem
   */
  readonly hasProblem: boolean;
  /** The zone for the row itself — sixteen bytes of the table. */
  readonly zoneId: string;
  /** Those sixteen bytes. */
  readonly rowStart: number;
  /**
   * Where the row points, when it points into the image.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.targetRange
   */
  readonly targetRange: { readonly start: number; readonly end: number } | undefined;
  /**
   * Whether this row is a microcode that may go. Only a microcode is offered
   * for removal — the extent of anything else a row can point at is not
   * something this tool knows — and a table keeps one microcode, so the last
   * one a table has cannot be removed.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.canRemove
   */
  readonly canRemove: boolean;
  /**
   * Whether the microcode this row names may be swapped for another. Every
   * microcode row may be replaced — the slot stays, so the one-microcode rule
   * is not touched — and the replacement need not be the same CPUID: the row,
   * not the processor, is what is being changed.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.canReplace
   */
  readonly canReplace: boolean;
  /**
   * Whether this row offers the checksum fix. The byte is the header's, so the
   * fix lives on the header row — the one the mismatch turns red — and on no
   * other.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.checksumFixAvailable
   */
  readonly checksumFixAvailable: boolean;
  /**
   * How this row's microcode stands against the catalogue, when the row leads
   * to one and there is a basis for a verdict: whether a newer revision for the
   * same processor and platform is out there. Not rated before the catalogue
   * arrives, for a row that is not a microcode, and wherever nothing the
   * collection holds matches. The Type column wears it as a mark.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.latestState
   */
  readonly latestState: MicrocodeLatest;
  /**
   * The row as the table read it — entry and what it points at — kept so the
   * detail can be rebuilt for whatever row comes into focus.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.model
   */
  readonly model: FITRow;
  /**
   * A row of the Top Swap backup's copy of the table: shown, and never changed on
   * its own — a change to the table is made in both copies.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.isBackup
   */
  readonly isBackup: boolean;
}

/**
 * The row's identity in the panel: its index in the table, or — for a row of the
 * backup's copy — past `BACKUP_KEY_BASE`.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.key
 */
export const rowKey = (row: FITDisplayRow): number =>
  row.isBackup ? backupKey(row.index) : row.index;

/**
 * The number the panel shows for the row. Counting starts at one, the way a
 * reader counts the rows of a table, rather than at the header's zero — which
 * is the row's place, not its number.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.displayNumber
 */
export const displayNumber = (row: FITDisplayRow): number => row.index + 1;

/**
 * Where "go to the offset" leads: what the row points at, or — for the header
 * and for an empty slot, which point nowhere — the row itself. Every row has an
 * offset, so every row has somewhere to go.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.offsetToGoTo
 */
export const offsetToGoTo = (row: FITDisplayRow): number => row.targetRange?.start ?? row.rowStart;

/**
 * The zone that "go to the offset" brings to the front.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.zoneToFocus
 */
export const zoneToFocus = (row: FITDisplayRow): string =>
  row.targetRange === undefined ? row.zoneId : targetZoneId(rowKey(row));

/**
 * What the right-button menu offers here. Every row leads with its offset —
 * going where the row points is the point of the row — and a row that leads to
 * microcode offers the CPUID, its replacement, and — when it may go — its
 * removal. The checksum fix is offered on the header row, where the byte lives,
 * when it is needed.
 *
 * A value rather than a menu, so what is on offer is decided here and unit
 * tested: the panel builds items from this and nothing more. An item that does
 * not apply to the row is *absent* rather than present and greyed — a greyed
 * "Copy CPUID" on the header row explains nothing.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.commands
 */
export function rowCommands(row: FITDisplayRow): FITRowCommand[] {
  const commands: FITRowCommand[] = [{ kind: "goToOffset", offset: offsetToGoTo(row) }];
  if (row.cpuidText !== undefined) commands.push({ kind: "copyCPUID", cpuid: row.cpuidText });
  if (row.canReplace) commands.push({ kind: "replaceMicrocode", index: row.index });
  if (row.canRemove) commands.push({ kind: "removeMicrocode", index: row.index });
  if (row.checksumFixAvailable) commands.push({ kind: "fixChecksum" });
  return commands;
}

/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay */
export interface FITDisplay {
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.summary */
  readonly summary: string;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.rows */
  readonly rows: readonly FITDisplayRow[];
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.problems */
  readonly problems: readonly FITProblem[];
  /**
   * The writes that would put the table's checksum right, or nothing when there
   * is nothing to put right.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.checksumFix
   */
  readonly checksumFix: ToolTransaction | undefined;
  /** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.zones */
  readonly zones: ZoneMap;
  /**
   * What the row in focus is, field by field — the entry's own sixteen bytes
   * and what its address leads to. Empty when no row is in focus.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.detail
   */
  readonly detail: FITRowDetail;
  /**
   * Where in `rows` the Top Swap backup's copy of the table starts; nothing for
   * an image that keeps none.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.backupStart
   */
  readonly backupStart: number | undefined;
  /**
   * The heading the panel puts above the backup's rows.
   *
   * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.backupHeading
   */
  readonly backupHeading: string | undefined;
}

/**
 * Nothing read yet, or nothing to show.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.empty
 */
export const EMPTY_DISPLAY: FITDisplay = {
  summary: "",
  rows: [],
  problems: [],
  checksumFix: undefined,
  zones: EMPTY_ZONES,
  detail: EMPTY_DETAIL,
  backupStart: undefined,
  backupHeading: undefined,
};

/**
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.tableZoneID
 */
export const TABLE_ZONE_ID = "fit.table";
/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.pointerZoneID */
export const POINTER_ZONE_ID = "fit.pointer";

/**
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.rowZoneID
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplayRow.zoneID
 */
export const rowZoneId = (key: number): string =>
  key >= BACKUP_KEY_BASE ? `fit.backup.row.${key - BACKUP_KEY_BASE}` : `fit.row.${key}`;
/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.targetZoneID */
export const targetZoneId = (key: number): string =>
  key >= BACKUP_KEY_BASE ? `fit.backup.target.${key - BACKUP_KEY_BASE}` : `fit.target.${key}`;

/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.backupTableZoneID */
export const BACKUP_TABLE_ZONE_ID = "fit.backup.table";
/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.backupPointerZoneID */
export const BACKUP_POINTER_ZONE_ID = "fit.backup.pointer";

/**
 * Where the keys of the Top Swap backup's rows start: past any index a table can
 * have.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.backupKeyBase
 */
export const BACKUP_KEY_BASE = 0x1_0000;
/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.backupKey */
export const backupKey = (index: number): number => BACKUP_KEY_BASE + index;

/**
 * Which row a zone id belongs to, for the trip back: the user picks a zone in
 * the dump and the panel has to select the row it came from. Nothing for the
 * table and the pointer, which stand for no row in particular.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.rowIndex
 */
export function rowIndexOfZone(id: string): number | undefined {
  for (const prefix of ["fit.backup.row.", "fit.backup.target."]) {
    if (!id.startsWith(prefix)) continue;
    const index = Number.parseInt(id.slice(prefix.length), 10);
    return Number.isNaN(index) ? undefined : backupKey(index);
  }
  for (const prefix of ["fit.row.", "fit.target."]) {
    if (!id.startsWith(prefix)) continue;
    const index = Number.parseInt(id.slice(prefix.length), 10);
    return Number.isNaN(index) ? undefined : index;
  }
  return undefined;
}

/**
 * The byte the table's checksum should hold, as the validator computed it —
 * what the header row's Checksum field quotes and is coloured by when it reads
 * wrong. Nothing when the checksum checks out or is not checked. It is not
 * something the row itself carries: the byte the row holds is checked against
 * the whole table.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.checksumShouldBe
 */
export function checksumShouldBe(problems: readonly FITProblem[]): number | undefined {
  for (const problem of problems) {
    if (problem.detail.kind === "checksumMismatch") return problem.detail.computed;
  }
  return undefined;
}

/**
 * The same display with another row selected. Selecting a row changes what is
 * drawn strongly in the dump and what the detail says, so it is a change to the
 * focus rather than a reason to read the file again.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.focusing
 */
export function focusingRow(display: FITDisplay, index: number | undefined): FITDisplay {
  return focusingZone(display, index === undefined ? undefined : rowZoneId(index));
}

/**
 * The same display with what "go to the offset" leads to in focus: the
 * component a row points at, or the row itself where it points nowhere.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.focusingTarget
 */
export function focusingTarget(display: FITDisplay, index: number): FITDisplay {
  const row = display.rows.find((one) => rowKey(one) === index);
  return row === undefined ? display : focusingZone(display, zoneToFocus(row));
}

/** @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.focusing */
export function focusingZone(display: FITDisplay, zoneId: string | undefined): FITDisplay {
  // The detail follows the selection: the row the outline is on, whether the
  // outline sits on the row itself or on what it points at. The table and the
  // pointer stand for no row, so they leave the detail empty.
  const index = zoneId === undefined ? undefined : rowIndexOfZone(zoneId);
  const row = index === undefined ? undefined : display.rows.find((one) => rowKey(one) === index);
  return {
    ...display,
    zones: { ...display.zones, focus: zoneId },
    detail: row === undefined ? EMPTY_DETAIL : detailFor(row, display.problems),
  };
}

/**
 * The same display with the outline still where the user left it.
 *
 * Every re-read — an edit in the dump, the names landing, a catalogue arriving
 * — builds its display from the row key, which is where the outline would go
 * back to if this were not applied. Where the user was looking is not something
 * a re-read gets to decide.
 *
 * A zone the reading no longer has is not one to hold: the table does not say
 * what became of what it was pointing at, and pointing at the row that took its
 * place would be picking a row the user never picked. The zone is handed in
 * rather than remembered here, so the caller's memory of it stays and an undo
 * that brings the row back brings the outline back with it.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.outline
 */
export function keepingTheOutline(display: FITDisplay, zone: string | undefined): FITDisplay {
  if (zone === undefined) return display;
  if (!display.zones.zones.some((one) => one.id === zone)) return focusingZone(display, undefined);
  return focusingZone(display, zone);
}

/**
 * The same display with every microcode row's "latest" verdict decided against
 * the catalogue — the newest revision it lists for that row's processor and
 * platform, or nothing where there is no basis for one.
 *
 * Applied when the catalogue arrives, and again whenever the table is re-read
 * with the catalogue already in hand. It changes the marks, never the map: the
 * zones, the focus and the detail ride on untouched, so a catalogue landing
 * late does not move the outline the user is looking at.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITDisplay.ratingLatest
 */
export function ratingLatest(
  display: FITDisplay,
  catalogue: readonly MicrocodeCatalogueEntry[]
): FITDisplay {
  if (catalogue.length === 0) return display;
  return {
    ...display,
    rows: display.rows.map((row) =>
      row.model.target.kind === "microcode"
        ? { ...row, latestState: latestOf(row.model.target.header, catalogue) }
        : row
    ),
  };
}

/**
 * What to show for a report. `focus` is the row the user has selected.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.display
 */
export function fitDisplay(report: FITReport, focus?: number | undefined): FITDisplay {
  const table = report.table;
  if (table === undefined) {
    return {
      summary: summaryOf(report),
      rows: [],
      problems: report.problems,
      checksumFix: undefined,
      zones: EMPTY_ZONES,
      detail: EMPTY_DETAIL,
      backupStart: undefined,
      backupHeading: undefined,
    };
  }

  // The checksum byte is the header's, so the fix is offered on the header row
  // — the one the mismatch turns red — and on no other. It is made in the
  // backup's copy too, when that copy is the same table.
  const backup = report.backup;
  const fix = fitChecksumFix(table, backup?.tableBytesMatch === true ? backup.block : undefined);
  const rows = displayRows(
    table,
    report.problems.filter((one) => one.inBackup !== true),
    false,
    fix
  );
  let backupStart: number | undefined;
  let backupHeading: string | undefined;
  if (backup?.table !== undefined) {
    // The backup's copy follows the table, under a heading of its own, and
    // offers nothing that changes it.
    backupStart = rows.length;
    backupHeading = headingOf(backup);
    rows.push(
      ...displayRows(
        backup.table,
        report.problems.filter((one) => one.inBackup === true),
        true,
        undefined
      )
    );
  }

  // The detail is the row the user has selected, or nothing before a selection
  // — built here so a fresh parse shows the same detail the selection would.
  const focused = focus === undefined ? undefined : rows.find((one) => rowKey(one) === focus);
  return {
    summary: summaryOf(report),
    rows,
    problems: report.problems,
    checksumFix: fix,
    zones: zonesOf(table, backup?.table, rows, focus),
    detail: focused === undefined ? EMPTY_DETAIL : detailFor(focused, report.problems),
    backupStart,
    backupHeading,
  };
}

/** One copy of the table's rows. `problems` are that copy's own. */
function displayRows(
  table: FITTable,
  problems: readonly FITProblem[],
  isBackup: boolean,
  fix: ToolTransaction | undefined
): FITDisplayRow[] {
  const problemRows = new Set(
    problems.map((problem) => problem.entryIndex).filter((one) => one !== undefined)
  );
  // A table needs one microcode entry, so the last one cannot go.
  const microcodeCount = table.rows.filter((row) => row.entry.type === FIT.microcodeType).length;
  return table.rows.map((row): FITDisplayRow => {
    const target = targetRangeOf(row);
    return {
      index: row.entry.index,
      typeText: typeTextOf(row.entry),
      addressText: isHeaderEntry(row.entry) ? "_FIT_" : hex(row.entry.address, 8),
      sizeText: sizeTextOf(row),
      versionText: versionText(row.entry),
      targetText: targetTextOf(row),
      cpuidText:
        row.target.kind === "microcode"
          ? cpuidText(row.target.header.processorSignature)
          : undefined,
      hasProblem: problemRows.has(row.entry.index),
      zoneId: rowZoneId(isBackup ? backupKey(row.entry.index) : row.entry.index),
      rowStart: row.entry.offset,
      targetRange: target,
      canRemove: !isBackup && row.entry.type === FIT.microcodeType && microcodeCount > 1,
      canReplace: !isBackup && row.entry.type === FIT.microcodeType,
      checksumFixAvailable: !isBackup && fix !== undefined && row.entry.index === 0,
      // No catalogue here: a display built fresh from a parse does not know
      // what is out there, and `ratingLatest` fills the verdicts in once the
      // catalogue is in hand.
      latestState: NOT_RATED,
      model: row,
      isBackup,
    };
  });
}

/**
 * What the detail says for a row: the checksum it quotes is the one its own copy
 * of the table was checked against.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.detail
 */
export function detailFor(row: FITDisplayRow, problems: readonly FITProblem[]): FITRowDetail {
  return buildDetail(
    row.model,
    checksumShouldBe(problems.filter((one) => (one.inBackup === true) === row.isBackup)),
    row.isBackup
  );
}

/**
 * The line above the backup's rows: where the copy is, that it is not changed on
 * its own, and whether it agrees with the table.
 */
function headingOf(backup: FITBackupReading): string {
  const place = `Top Swap backup at ${hex(backup.block.backup.start)} · read-only`;
  switch (backup.status.kind) {
    case "identical":
      return `${place} · same as above`;
    case "otherBytesDiffer":
      return `${place} · same table, other bytes differ`;
    case "tableDiffers":
      return `${place} · differs from the table above`;
    case "noTable":
      return `${place} · no table`;
  }
}

/**
 * The one edit this tool makes on its own: the header's checksum byte, which an
 * editor that changed the table and did not recompute leaves behind. One byte,
 * one named undo step.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.checksumFix
 */
export function fitChecksumFix(
  table: FITTable,
  backup?: FITTopSwapBackup | undefined
): ToolTransaction | undefined {
  if (!table.checksumIsChecked || checksumIsCorrect(table)) return undefined;
  const offset = table.range.start + 0x0f;
  const bytes = Uint8Array.of(table.computedChecksum);
  // Written into the Top Swap backup's copy of the table as well, when it holds
  // the same one.
  const writes = [{ offset, bytes }];
  if (backup !== undefined) writes.push({ offset: offset - topSwapSize(backup), bytes });
  return { name: "Fix FIT Checksum", writes };
}

// MARK: - Text

function summaryOf(report: FITReport): string {
  const table = report.table;
  if (table === undefined) {
    return report.candidates.length === 0
      ? "No FIT table in this file."
      : `No FIT table where the pointer leads. A signature sits at ${report.candidates
          .map((one) => hex(one))
          .join(", ")}.`;
  }
  // The count includes the header row: the panel shows the header as a row of
  // the table, so the number the summary says is the number of rows a reader
  // counts, header included.
  const count = table.rows.length;
  const parts = [
    `FIT at ${hex(table.range.start)}`,
    `${count} ${count === 1 ? "entry" : "entries"}`,
  ];
  if (report.addressDiffIsAssumed) {
    // Said every time, because it is true every time for a region cut out of a
    // dump — and there every address in the table is wrong by whatever was cut
    // off in front of it.
    parts.push("addresses assumed");
  }
  if (report.backup !== undefined) {
    parts.push(
      report.backup.status.kind === "identical"
        ? "Top Swap backup matches"
        : "Top Swap backup differs"
    );
  }
  if (!table.checksumIsChecked) {
    parts.push("checksum unused");
  } else if (checksumIsCorrect(table)) {
    parts.push(`checksum ${hex(table.storedChecksum, 2)}`);
    // A wrong checksum is not restated here: it is a problem, and the list
    // below already says so in red, where it is meant to be read.
  }
  return parts.join(" · ");
}

function typeTextOf(entry: FITEntry): string {
  const name = fitTypeName(entry.type);
  if (entry.type !== FIT.cseSecureBootType) return name;
  return `${name}: ${cseSecureBootSubtypeName(entry.reserved)}`;
}

/**
 * The size worth showing, in its own column. The header's field counts entries
 * rather than bytes, so it says so; a microcode's field is required to be zero,
 * so the truth is the component's; the rest use the field in 16-byte units, and
 * an empty field is a zero, not a mystery.
 */
function sizeTextOf(row: FITRow): string {
  if (isHeaderEntry(row.entry)) return `${row.entry.size} rows`;
  const size = effectiveSize(row);
  return size === undefined ? "0" : hex(size);
}

/**
 * Everything known about where the row leads, in one line, separated the way
 * the summary is. A microcode row leads with its CPUID rather than with the
 * word "microcode": the type column has already said that, and the CPUID is the
 * thing being looked for.
 */
function targetTextOf(row: FITRow): string {
  const target = row.target;
  switch (target.kind) {
    case "nothing": {
      // The header's `Size` is a count of entries, not a size — the field
      // everyone reads wrong — so it is spelled out as both. "Rows" and not
      // "entries": the field counts the header along with them, where the
      // summary above counts what there is to look at.
      if (!isHeaderEntry(row.entry)) return "";
      const count = row.entry.size;
      return `${count} ${count === 1 ? "row" : "rows"} · ${hex(sizeInBytes(row.entry))}`;
    }
    case "indexIORegisters":
      return "Index/IO registers, not an address";
    case "outsideTheImage":
      return "outside this image";
    case "microcode": {
      // The CPUID is what a bench hunts for, so it leads; the offset and the
      // size have their own columns, and the date closes the line.
      const header = target.header;
      const parts = [
        `CPUID ${cpuidText(header.processorSignature)}`,
        `r.${header.updateRevision.toString(16).toUpperCase()}`,
        microcodeDate(header),
      ];
      return [...parts, hex(header.offset)].join(" · ");
    }
    case "emptyMicrocodeSlot":
      return `empty slot · ${hex(target.offset)}`;
    case "bytes":
      // The address leads, and the name of what is there follows it in brackets
      // — because the name arrives second. The tree names an offset only once
      // the branch covering it has been opened, and that happens behind the
      // table rather than in front of it: the row goes up as "0x2848" and
      // becomes "0x2848 (MyDriver)" when the branch has been read. Leading with
      // the name instead would move the address sideways under the reader's
      // eye.
      return target.description === undefined
        ? hex(target.offset)
        : `${hex(target.offset)} (${target.description})`;
  }
}

function targetRangeOf(row: FITRow): { readonly start: number; readonly end: number } | undefined {
  const target = row.target;
  switch (target.kind) {
    case "microcode":
      return microcodeRange(target.header);
    case "emptyMicrocodeSlot":
    case "bytes": {
      const size = effectiveSize(row) ?? 16;
      return { start: target.offset, end: target.offset + size };
    }
    default:
      return undefined;
  }
}

// MARK: - Zones

/**
 * What the dump draws: the table, the pointer that leads to it, each row, and
 * what each row points at — the last being the useful one, since the components
 * are scattered across the image and the table is not.
 */
function zonesOf(
  table: FITTable,
  backup: FITTable | undefined,
  rows: readonly FITDisplayRow[],
  focus: number | undefined
): ZoneMap {
  const zones: Zone[] = [
    { id: TABLE_ZONE_ID, name: "FIT table", start: table.range.start, end: table.range.end },
    {
      id: POINTER_ZONE_ID,
      name: "FIT pointer",
      start: table.pointerOffset,
      end: table.pointerOffset + 4,
    },
  ];
  // The Top Swap backup's copy is drawn the same way, under names that say so.
  if (backup !== undefined) {
    zones.push({
      id: BACKUP_TABLE_ZONE_ID,
      name: "Backup FIT table",
      start: backup.range.start,
      end: backup.range.end,
    });
    zones.push({
      id: BACKUP_POINTER_ZONE_ID,
      name: "Backup FIT pointer",
      start: backup.pointerOffset,
      end: backup.pointerOffset + 4,
    });
  }
  for (const row of rows) {
    const prefix = row.isBackup ? "Backup " : "";
    zones.push({
      id: row.zoneId,
      name: `${prefix}#${displayNumber(row)} ${row.typeText}`,
      start: row.rowStart,
      end: row.rowStart + FIT_ENTRY_SIZE,
    });
    if (row.targetRange === undefined) continue;
    // Named by CPUID where there is one: that is what a bench is looking for
    // when it goes hunting for a microcode in a dump.
    zones.push({
      id: targetZoneId(rowKey(row)),
      name:
        prefix +
        (row.cpuidText !== undefined
          ? `CPUID ${row.cpuidText}`
          : row.targetText.length === 0
            ? `#${displayNumber(row)}`
            : row.targetText),
      start: row.targetRange.start,
      end: row.targetRange.end,
    });
  }
  return { zones, focus: focus === undefined ? undefined : rowZoneId(focus) };
}
