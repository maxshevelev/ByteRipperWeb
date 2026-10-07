import { L } from "@/core/localization/localization";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  type BIOSGuardProblem,
  type BIOSGuardUpdate,
  isBIOSGuardUpdate,
  parseBIOSGuardFile,
} from "@/firmware/uefi/biosGuardUpdate";
import type { ToolTransaction } from "@/tools/toolTransaction";
import type { ZoneMap } from "@/tools/zone";

/**
 * A dump's BIOS region held against the region a vendor's update file carries
 * (`BIOSGuardUpdate`), part by part as the file's table names them: which parts are the same,
 * which differ, and which hold what belongs to this one board rather than to the model.
 *
 * It answers two questions a bench asks of a dump: is the firmware in it the vendor's,
 * untouched — and, where it is not, what writing the vendor's back would change. The answer
 * to the second is a transaction that writes only the bytes that differ, in the parts the
 * user chose, so that what the dump shows as modified afterwards is exactly what changed.
 *
 * What it does not decide is which values are right for the board. A part whose name says it
 * is NVRAM or the vendor's per-board store is kept by default, because those are the bytes an
 * update file cannot hold for this board; the user can still choose to write them.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison
 */
export interface UEFIUpdateComparison {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.platform */
  readonly platform: string;
  /**
   * The dump's BIOS region.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.region
   */
  readonly region: { readonly start: number; readonly end: number };
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.rows */
  readonly rows: readonly UpdateRow[];
}

/**
 * One part of the region, as the update file's table names it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row
 */
export interface UpdateRow {
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.name */
  readonly name: string;
  /**
   * The flasher's switch for it — `/P`, `/N` — or empty.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.key
   */
  readonly key: string;
  /** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.blockCount */
  readonly blockCount: number;
  /**
   * Where it lies in the dump.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.range
   */
  readonly range: { readonly start: number; readonly end: number };
  /**
   * How many of its bytes the dump holds differently.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.differingBytes
   */
  readonly differingBytes: number;
  /**
   * Its name or switch says it holds this board's own data.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.isBoardData
   */
  readonly isBoardData: boolean;
  /**
   * The update holds nothing here — every byte erased.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.isErasedInUpdate
   */
  readonly isErasedInUpdate: boolean;
  /**
   * Where the dump differs, as ranges of the dump: runs of differing bytes, joined across
   * gaps shorter than `JOIN_GAP`.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.differences
   */
  readonly differences: readonly { readonly start: number; readonly end: number }[];
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.isIdentical */
export const isIdentical = (row: UpdateRow): boolean => row.differingBytes === 0;

/**
 * What the sheet ticks before the user has touched it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.writesByDefault
 */
export const writesByDefault = (row: UpdateRow): boolean => !isIdentical(row) && !row.isBoardData;

/**
 * Why there is no comparison.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Problem
 */
export type UpdateComparisonProblem =
  | { readonly kind: "notAnUpdate" }
  | { readonly kind: "unreadable"; readonly problem: BIOSGuardProblem }
  /** The update carries a region of `update` bytes; the dump's is `region`. */
  | { readonly kind: "sizeMismatch"; readonly update: number; readonly region: number };

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Problem.message */
export function problemMessage(problem: UpdateComparisonProblem): string {
  switch (problem.kind) {
    case "notAnUpdate":
      return L("This is not an AMI BIOS Guard update file.");
    case "unreadable":
      switch (problem.problem.kind) {
        case "notAnUpdate":
          return L("This is not an AMI BIOS Guard update file.");
        case "noEntries":
          return L("The update file lists no blocks.");
        case "truncated":
          return L("The update file ends inside block %1$@.", problem.problem.block + 1);
        case "notABlock":
          return L(
            "Block %1$@ of the update file does not read as a block.",
            problem.problem.block + 1
          );
      }
      break;
    case "sizeMismatch":
      return L(
        "The update file carries a BIOS region of %1$@ bytes, and the BIOS region of this dump is %2$@ bytes. It is not an update for this board.",
        hex(problem.update),
        hex(problem.region)
      );
  }
  return "";
}

/**
 * Differing runs closer than this are written as one: a write per stray byte would make
 * thousands of writes of the same change.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.joinGap
 */
export const JOIN_GAP = 16;

export type CompareResult =
  | {
      readonly ok: true;
      readonly comparison: UEFIUpdateComparison;
      readonly update: BIOSGuardUpdate;
    }
  | { readonly ok: false; readonly problem: UpdateComparisonProblem };

/**
 * Reads `file` as an update and compares it with `dump`, the dump's BIOS region, which starts
 * at `regionStart` in the dump.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.compare
 */
export function compareFile(
  file: Uint8Array,
  dump: Uint8Array,
  regionStart: number
): CompareResult {
  const reader = new ImageReader(sourceOver(file));
  if (!isBIOSGuardUpdate(reader)) return { ok: false, problem: { kind: "notAnUpdate" } };
  const read = parseBIOSGuardFile(reader);
  if (!read.ok) return { ok: false, problem: { kind: "unreadable", problem: read.problem } };
  const compared = compareUpdate(read.update, dump, regionStart);
  return compared.ok
    ? { ok: true, comparison: compared.comparison, update: read.update }
    : compared;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.compare */
export function compareUpdate(
  update: BIOSGuardUpdate,
  dump: Uint8Array,
  regionStart: number
):
  | { readonly ok: true; readonly comparison: UEFIUpdateComparison }
  | { readonly ok: false; readonly problem: UpdateComparisonProblem } {
  if (update.region.length !== dump.length) {
    return {
      ok: false,
      problem: { kind: "sizeMismatch", update: update.region.length, region: dump.length },
    };
  }
  const rows = update.entries.map((entry): UpdateRow => {
    const { start, end } = entry.range;
    const { count, runs } = differences(update.region, dump, start, end);
    let erased = true;
    for (let at = start; at < end && erased; at++) erased = update.region[at] === 0xff;
    return {
      name: entry.name,
      key: entry.key,
      blockCount: entry.blockCount,
      range: { start: regionStart + start, end: regionStart + end },
      differingBytes: count,
      isBoardData: isBoardData(entry.name, entry.key),
      isErasedInUpdate: erased,
      differences: runs.map((run) => ({
        start: regionStart + run.start,
        end: regionStart + run.end,
      })),
    };
  });
  return {
    ok: true,
    comparison: {
      platform: update.platform,
      region: { start: regionStart, end: regionStart + dump.length },
      rows,
    },
  };
}

/**
 * The writes that put the update's bytes into the rows at `chosen` — only where they differ.
 * Nothing when there is nothing to write.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.transaction
 */
export function updateTransaction(
  comparison: UEFIUpdateComparison,
  chosen: ReadonlySet<number>,
  update: BIOSGuardUpdate
): ToolTransaction | undefined {
  const writes = [...chosen]
    .sort((one, other) => one - other)
    .flatMap((index) => comparison.rows[index]?.differences ?? [])
    .map((run) => ({
      offset: run.start,
      bytes: update.region.slice(
        run.start - comparison.region.start,
        run.end - comparison.region.start
      ),
    }));
  if (writes.length === 0) return undefined;
  return { name: L("Write from Update File"), writes };
}

/**
 * The flasher's own switches for NVRAM, its copy and the OA key, and the words vendors put in
 * the names of their per-board stores — `AsusNVRAM`, `PEGA_GPNV`, `OA_TABLE`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.isBoardData
 */
export function isBoardData(name: string, key: string): boolean {
  const switchName = key.toUpperCase();
  const upper = name.toUpperCase();
  return (
    ["/N", "/NB", "/OA"].includes(switchName) ||
    ["NVRAM", "GPNV", "DMI", "SMBIOS", "OA_"].some((word) => upper.includes(word)) ||
    upper === "OA"
  );
}

/**
 * How many bytes differ in `[start, end)`, and the runs they make, joined across short gaps.
 * Whole 4 KiB pages are compared first: most of a region is the same as the dump's, and a
 * page that matches is skipped at once.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.differences
 */
export function differences(
  a: Uint8Array,
  b: Uint8Array,
  start: number,
  end: number
): { count: number; runs: { start: number; end: number }[] } {
  let count = 0;
  const runs: { start: number; end: number }[] = [];
  const page = 0x1000;
  let at = start;
  while (at < end) {
    const stop = Math.min(at + page, end);
    let same = true;
    for (let index = at; index < stop; index++) {
      if (a[index] !== b[index]) {
        same = false;
        break;
      }
    }
    if (same) {
      at = stop;
      continue;
    }
    for (let index = at; index < stop; index++) {
      if (a[index] === b[index]) continue;
      count += 1;
      const last = runs[runs.length - 1];
      if (last !== undefined && index - last.end < JOIN_GAP) last.end = index + 1;
      else runs.push({ start: index, end: index + 1 });
    }
    at = stop;
  }
  return { count, runs };
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.hex */
const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/**
 * The State column.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.stateText
 */
export function stateText(row: UpdateRow): string {
  if (isIdentical(row)) return L("Identical");
  if (row.isBoardData) {
    return row.isErasedInUpdate
      ? L("Board data; empty in the update")
      : L("Board data; %1$@ bytes differ", row.differingBytes);
  }
  return L("%1$@ bytes differ", row.differingBytes);
}

/**
 * The Name column: the name, and which of its blocks where there are several.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.Row.nameText
 */
export const nameText = (row: UpdateRow): string =>
  row.blockCount > 1 ? L("%1$@ (%2$@ blocks)", row.name, row.blockCount) : row.name;

/**
 * The line under the table: how the parts stand, and what pressing Write would write.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIUpdateComparison.swift#UEFIUpdateComparison.summary
 */
export function summary(comparison: UEFIUpdateComparison, chosen: ReadonlySet<number>): string {
  const { rows } = comparison;
  const identical = rows.filter(isIdentical).length;
  const picked = [...chosen].filter((index) => index < rows.length);
  const bytes = picked.reduce((sum, index) => sum + (rows[index]?.differingBytes ?? 0), 0);
  const kept = rows.filter((row, index) => !isIdentical(row) && !chosen.has(index)).length;
  return L(
    "%1$@ of %2$@ parts identical. To write: %3$@ parts, %4$@ bytes. Kept as they are: %5$@.",
    identical,
    rows.length,
    chosen.size,
    bytes,
    kept
  );
}

/**
 * The dump draws the parts as zones while the dialog is up, the selected one in focus.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.showUpdatePart
 */
export function updateZones(comparison: UEFIUpdateComparison, row: number | undefined): ZoneMap {
  return {
    zones: comparison.rows.map((part, index) => ({
      id: `update.${index}`,
      name: nameText(part),
      start: part.range.start,
      end: part.range.end,
    })),
    focus: row === undefined ? undefined : `update.${row}`,
  };
}
