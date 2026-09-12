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
import { microcodeDate, microcodeRange } from "@/firmware/uefi/microcodeParser";
import { buildDetail, EMPTY_DETAIL, type FITRowDetail } from "@/tools/fit/fitDetail";
import { cpuidText, fitHex as hex } from "@/tools/fit/fitText";
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

/** What the right-button menu offers for a row. */
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

/** One row as the panel shows it. */
export interface FITDisplayRow {
  /** Its place in the table; 0 is the header. */
  readonly index: number;
  readonly typeText: string;
  readonly addressText: string;
  /**
   * The size worth showing, in its own column: the component's for the rows
   * that point at one, the header's entry count for the header, and `0` for a
   * row whose size field is empty.
   */
  readonly sizeText: string;
  readonly versionText: string;
  /**
   * What is actually there, read rather than assumed: for microcode the CPUID,
   * the revision, the date, and where and how long it is.
   */
  readonly targetText: string;
  /**
   * The CPUID of the microcode this row leads to, as hex digits with no leading
   * zero — what a bench writes down and looks up. Nothing for a row that does
   * not lead to microcode.
   */
  readonly cpuidText: string | undefined;
  /**
   * Something is wrong with this row, and the panel says so by colour as well
   * as in the list below.
   */
  readonly hasProblem: boolean;
  /** The zone for the row itself — sixteen bytes of the table. */
  readonly zoneId: string;
  /** Those sixteen bytes. */
  readonly rowStart: number;
  /** Where the row points, when it points into the image. */
  readonly targetRange: { readonly start: number; readonly end: number } | undefined;
  /**
   * Whether this row is a microcode that may go. Only a microcode is offered
   * for removal — the extent of anything else a row can point at is not
   * something this tool knows — and a table keeps one microcode, so the last
   * one a table has cannot be removed.
   */
  readonly canRemove: boolean;
  /**
   * Whether the microcode this row names may be swapped for another. Every
   * microcode row may be replaced — the slot stays, so the one-microcode rule
   * is not touched — and the replacement need not be the same CPUID: the row,
   * not the processor, is what is being changed.
   */
  readonly canReplace: boolean;
  /**
   * Whether this row offers the checksum fix. The byte is the header's, so the
   * fix lives on the header row — the one the mismatch turns red — and on no
   * other.
   */
  readonly checksumFixAvailable: boolean;
  /**
   * The row as the table read it — entry and what it points at — kept so the
   * detail can be rebuilt for whatever row comes into focus.
   */
  readonly model: FITRow;
}

/**
 * The number the panel shows for the row. Counting starts at one, the way a
 * reader counts the rows of a table, rather than at the header's zero — which
 * is the row's place, not its number.
 */
export const displayNumber = (row: FITDisplayRow): number => row.index + 1;

/**
 * Where "go to the offset" leads: what the row points at, or — for the header
 * and for an empty slot, which point nowhere — the row itself. Every row has an
 * offset, so every row has somewhere to go.
 */
export const offsetToGoTo = (row: FITDisplayRow): number => row.targetRange?.start ?? row.rowStart;

/** The zone that "go to the offset" brings to the front. */
export const zoneToFocus = (row: FITDisplayRow): string =>
  row.targetRange === undefined ? row.zoneId : targetZoneId(row.index);

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
 */
export function rowCommands(row: FITDisplayRow): FITRowCommand[] {
  const commands: FITRowCommand[] = [{ kind: "goToOffset", offset: offsetToGoTo(row) }];
  if (row.cpuidText !== undefined) commands.push({ kind: "copyCPUID", cpuid: row.cpuidText });
  if (row.canReplace) commands.push({ kind: "replaceMicrocode", index: row.index });
  if (row.canRemove) commands.push({ kind: "removeMicrocode", index: row.index });
  if (row.checksumFixAvailable) commands.push({ kind: "fixChecksum" });
  return commands;
}

export interface FITDisplay {
  readonly summary: string;
  readonly rows: readonly FITDisplayRow[];
  readonly problems: readonly FITProblem[];
  /**
   * The writes that would put the table's checksum right, or nothing when there
   * is nothing to put right.
   */
  readonly checksumFix: ToolTransaction | undefined;
  readonly zones: ZoneMap;
  /**
   * What the row in focus is, field by field — the entry's own sixteen bytes
   * and what its address leads to. Empty when no row is in focus.
   */
  readonly detail: FITRowDetail;
}

/** Nothing read yet, or nothing to show. */
export const EMPTY_DISPLAY: FITDisplay = {
  summary: "",
  rows: [],
  problems: [],
  checksumFix: undefined,
  zones: EMPTY_ZONES,
  detail: EMPTY_DETAIL,
};

export const TABLE_ZONE_ID = "fit.table";
export const POINTER_ZONE_ID = "fit.pointer";

export const rowZoneId = (index: number): string => `fit.row.${index}`;
export const targetZoneId = (index: number): string => `fit.target.${index}`;

/**
 * Which row a zone id belongs to, for the trip back: the user picks a zone in
 * the dump and the panel has to select the row it came from. Nothing for the
 * table and the pointer, which stand for no row in particular.
 */
export function rowIndexOfZone(id: string): number | undefined {
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
 */
export function focusingRow(display: FITDisplay, index: number | undefined): FITDisplay {
  return focusingZone(display, index === undefined ? undefined : rowZoneId(index));
}

/**
 * The same display with what "go to the offset" leads to in focus: the
 * component a row points at, or the row itself where it points nowhere.
 */
export function focusingTarget(display: FITDisplay, index: number): FITDisplay {
  const row = display.rows.find((one) => one.index === index);
  return row === undefined ? display : focusingZone(display, zoneToFocus(row));
}

export function focusingZone(display: FITDisplay, zoneId: string | undefined): FITDisplay {
  // The detail follows the selection: the row the outline is on, whether the
  // outline sits on the row itself or on what it points at. The table and the
  // pointer stand for no row, so they leave the detail empty.
  const index = zoneId === undefined ? undefined : rowIndexOfZone(zoneId);
  const row = index === undefined ? undefined : display.rows.find((one) => one.index === index);
  return {
    ...display,
    zones: { ...display.zones, focus: zoneId },
    detail:
      row === undefined ? EMPTY_DETAIL : buildDetail(row.model, checksumShouldBe(display.problems)),
  };
}

/** What to show for a report. `focus` is the row the user has selected. */
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
    };
  }

  const problemRows = new Set(
    report.problems.map((problem) => problem.entryIndex).filter((one) => one !== undefined)
  );
  // A table needs one microcode entry, so the last one cannot go.
  const microcodeCount = table.rows.filter((row) => row.entry.type === FIT.microcodeType).length;
  // The checksum byte is the header's, so the fix is offered on the header row
  // — the one the mismatch turns red — and on no other.
  const fix = fitChecksumFix(table);

  const rows = table.rows.map((row): FITDisplayRow => {
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
      zoneId: rowZoneId(row.entry.index),
      rowStart: row.entry.offset,
      targetRange: target,
      canRemove: row.entry.type === FIT.microcodeType && microcodeCount > 1,
      canReplace: row.entry.type === FIT.microcodeType,
      checksumFixAvailable: fix !== undefined && row.entry.index === 0,
      model: row,
    };
  });

  // The detail is the row the user has selected, or nothing before a selection
  // — built here so a fresh parse shows the same detail the selection would.
  const focused = focus === undefined ? undefined : rows.find((one) => one.index === focus);
  return {
    summary: summaryOf(report),
    rows,
    problems: report.problems,
    checksumFix: fix,
    zones: zonesOf(table, rows, focus),
    detail:
      focused === undefined
        ? EMPTY_DETAIL
        : buildDetail(focused.model, checksumShouldBe(report.problems)),
  };
}

/**
 * The one edit this tool makes on its own: the header's checksum byte, which an
 * editor that changed the table and did not recompute leaves behind. One byte,
 * one named undo step.
 */
export function fitChecksumFix(table: FITTable): ToolTransaction | undefined {
  if (!table.checksumIsChecked || checksumIsCorrect(table)) return undefined;
  return {
    name: "Fix FIT Checksum",
    writes: [{ offset: table.range.start + 0x0f, bytes: Uint8Array.of(table.computedChecksum) }],
  };
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
  for (const row of rows) {
    const start = table.range.start + row.index * FIT_ENTRY_SIZE;
    zones.push({
      id: row.zoneId,
      name: `#${displayNumber(row)} ${row.typeText}`,
      start,
      end: start + FIT_ENTRY_SIZE,
    });
    if (row.targetRange === undefined) continue;
    // Named by CPUID where there is one: that is what a bench is looking for
    // when it goes hunting for a microcode in a dump.
    zones.push({
      id: targetZoneId(row.index),
      name:
        row.cpuidText !== undefined
          ? `CPUID ${row.cpuidText}`
          : row.targetText.length === 0
            ? `#${displayNumber(row)}`
            : row.targetText,
      start: row.targetRange.start,
      end: row.targetRange.end,
    });
  }
  return { zones, focus: focus === undefined ? undefined : rowZoneId(focus) };
}
