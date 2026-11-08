import { L } from "@/core/localization/localization";
import { FIT } from "@/firmware/fit/fitEntry";
import { type FITDisplay, type FITDisplayRow, rowKey } from "@/tools/fit/fitDisplay";

/**
 * The FIT table as an outline: an entry of the table, the CPUIDs a microcode
 * serves as one block of lines under it, the heading in front of the Top Swap
 * backup's copy, and the row Add Microcode… sits in. The processors behind a
 * CPUID are not rows: they are not part of the update, and its `ⓘ` lists them.
 *
 * Decided here, from the display and what the reader has opened, so the panel
 * draws the rows this lists and the order, the levels and where Add goes are
 * checked without a page.
 *
 * Ported from the outline half of upstream's `FITToolViewController`.
 */

/**
 * One row of the entries' outline.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.Kind
 * @upstream-differs a value with a string id rather than a class known by its identity: a React
 * row is known by its key, so a re-render keeps the rows and their scroll by itself
 */
export type FITOutlineItem =
  | { readonly kind: "heading" }
  /** The row's key (`rowKey`). */
  | { readonly kind: "entry"; readonly key: number }
  /**
   * The row's key: the CPUIDs a microcode serves, under it — one row, not one a
   * CPUID, and not one that can be chosen.
   */
  | { readonly kind: "cpuids"; readonly key: number }
  /** Add Microcode…, under the table's last microcode. */
  | { readonly kind: "addMicrocode" };

/**
 * The item's identity, for the rows' keys and the set of what is closed.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.kind
 */
export function outlineItemId(item: FITOutlineItem): string {
  switch (item.kind) {
    case "heading":
    case "addMicrocode":
      return item.kind;
    case "entry":
      return `entry:${item.key}`;
    case "cpuids":
      return `cpuids:${item.key}`;
  }
}

/**
 * The entry this item belongs to: its own, or — for the CPUIDs under a
 * microcode — the microcode's, so its menu and its double-click act on the
 * microcode.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.Kind.key
 */
export function outlineItemKey(item: FITOutlineItem): number | undefined {
  return item.kind === "entry" || item.kind === "cpuids" ? item.key : undefined;
}

/**
 * Whether a row of the outline can be chosen: every entry, as in the UEFI tree.
 * The heading is a heading, Add's row is a button, and the CPUIDs say something
 * about their microcode rather than being a thing of their own — the arrow keys
 * pass over all three.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.Kind.isEntry
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.outlineView
 */
export const isChoosable = (item: FITOutlineItem): boolean => item.kind === "entry";

/** One visible row of the outline: the item, how deep it sits, and whether it opens. */
export interface FITOutlineRow {
  readonly item: FITOutlineItem;
  readonly id: string;
  readonly depth: number;
  /** Whether it has a level under it — a microcode entry. */
  readonly expandable: boolean;
  readonly isOpen: boolean;
}

/**
 * The entries the reader closed. A microcode entry is open to begin with, so
 * its CPUIDs are on screen without a click; one the reader closed stays closed.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.expandedKinds
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.seenEntries
 * @upstream-differs the entries the reader closed are kept rather than the entries seen, which
 * comes to the same: an entry not closed is open
 */
export type FITOutlineOpenings = ReadonlySet<string>;

export const NO_OPENINGS: FITOutlineOpenings = new Set();

/**
 * The same openings with `item` opened or closed.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.noteExpansion
 */
export function withOpening(
  closed: FITOutlineOpenings,
  item: FITOutlineItem,
  open: boolean
): FITOutlineOpenings {
  if (item.kind !== "entry") return closed;
  const next = new Set(closed);
  if (open) next.delete(outlineItemId(item));
  else next.add(outlineItemId(item));
  return next;
}

/**
 * The outline's visible rows for the display on hand: every entry, the heading
 * where the backup's copy starts, under a microcode the CPUIDs it serves, and
 * Add Microcode… under the last microcode of the table, after what that
 * microcode opened. Not under the Top Swap backup's copy, which is changed only
 * with the table; under the header where the table has no microcode.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.rebuildItems
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.reloadEntries
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.outlineView
 */
export function fitOutlineRows(
  display: FITDisplay,
  closed: FITOutlineOpenings = NO_OPENINGS
): FITOutlineRow[] {
  const table = display.rows.filter((row) => !row.isBackup);
  const anchor =
    [...table].reverse().find((row) => row.model.entry.type === FIT.microcodeType) ?? table[0];
  const rows: FITOutlineRow[] = [];
  const push = (item: FITOutlineItem, depth: number, expandable: boolean) => {
    const id = outlineItemId(item);
    const open = expandable && !closed.has(id);
    rows.push({ item, id, depth, expandable, isOpen: open });
    return open;
  };
  const heading = () => push({ kind: "heading" }, 0, false);
  display.rows.forEach((row: FITDisplayRow, index) => {
    if (display.backupStart === index) heading();
    const key = rowKey(row);
    if (push({ kind: "entry", key }, 0, row.processorGroups.length > 0)) {
      push({ kind: "cpuids", key }, 1, false);
    }
    if (row === anchor) push({ kind: "addMicrocode" }, 0, false);
  });
  if (display.backupStart !== undefined && display.backupStart === display.rows.length) heading();
  return rows;
}

/** One line under a microcode: the CPUID, whether it has an `ⓘ`, its code names. */
export interface FITCPUIDLine {
  /** `CPUID 806EA`. */
  readonly cpuid: string;
  /** The code names of its groups, quieter after it; empty when nothing is known. */
  readonly names: string;
  /** Whether the table knows something behind it: a CPUID it knows nothing about has no `ⓘ`. */
  readonly hasInfo: boolean;
}

/**
 * The lines under a microcode: its CPUIDs one under another, in the update's
 * order — the header's own first.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.cpuidPlate
 */
export function cpuidLines(row: FITDisplayRow): FITCPUIDLine[] {
  return row.processorGroups.map((group) => ({
    cpuid: L("CPUID %1$@", group.cpuid),
    names: group.codeNames.join(", "),
    hasInfo: group.codeNames.length > 0,
  }));
}
