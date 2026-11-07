import { FIT } from "@/firmware/fit/fitEntry";
import { type FITDisplay, type FITDisplayRow, rowKey } from "@/tools/fit/fitDisplay";

/**
 * The FIT table as an outline: an entry of the table, a CPUID under a microcode
 * entry, a model under a CPUID, the heading in front of the Top Swap backup's
 * copy, and the row Add Microcode… sits in.
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
   * The row's key and the group's place among its `processorGroups`: a CPUID of
   * the update, a level of its own.
   */
  | { readonly kind: "cpuid"; readonly key: number; readonly group: number }
  /** The row's key, the group's place, and the line's place in it. */
  | { readonly kind: "line"; readonly key: number; readonly group: number; readonly line: number }
  /** Add Microcode…, under the table's last microcode. */
  | { readonly kind: "addMicrocode" };

/**
 * The item's identity, for the rows' keys and the sets of what is open.
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
    case "cpuid":
      return `cpuid:${item.key}:${item.group}`;
    case "line":
      return `line:${item.key}:${item.group}:${item.line}`;
  }
}

/**
 * The entry this item belongs to: its own, or — for a CPUID or a line under a
 * microcode — the microcode's, so its menu, its double-click and the detail act
 * on the microcode.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.Kind.key
 */
export function outlineItemKey(item: FITOutlineItem): number | undefined {
  return item.kind === "heading" || item.kind === "addMicrocode" ? undefined : item.key;
}

/** @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITOutlineItem.Kind.isEntry */
export const isEntryItem = (item: FITOutlineItem): boolean => item.kind === "entry";

/**
 * Whether a row of the outline can be chosen: every row as in the UEFI tree —
 * the arrow keys walk the processors as they walk the entries — except the
 * heading, which is a heading, and Add's row, which is a button.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.outlineView
 */
export const isChoosable = (item: FITOutlineItem): boolean =>
  item.kind !== "heading" && item.kind !== "addMicrocode";

/** One visible row of the outline: the item, how deep it sits, and whether it opens. */
export interface FITOutlineRow {
  readonly item: FITOutlineItem;
  readonly id: string;
  readonly depth: number;
  /** Whether it has a level under it — a microcode entry, a CPUID. */
  readonly expandable: boolean;
  readonly isOpen: boolean;
}

/**
 * What the reader has done to the outline's openings: the entries they closed,
 * and the CPUIDs they opened. A microcode entry is open to begin with, so its
 * CPUIDs are on screen without a click; a CPUID is closed to begin with.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.expandedKinds
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.seenEntries
 * @upstream-differs the entries the reader closed are kept rather than the entries seen, which
 * comes to the same: an entry not closed is open, and one the reader closed stays closed
 */
export interface FITOutlineOpenings {
  readonly closedEntries: ReadonlySet<string>;
  readonly openCpuids: ReadonlySet<string>;
}

export const NO_OPENINGS: FITOutlineOpenings = {
  closedEntries: new Set(),
  openCpuids: new Set(),
};

/**
 * Whether an item is open, by the reader's openings.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.reloadEntries
 */
export function isOpen(item: FITOutlineItem, openings: FITOutlineOpenings): boolean {
  const id = outlineItemId(item);
  if (item.kind === "entry") return !openings.closedEntries.has(id);
  if (item.kind === "cpuid") return openings.openCpuids.has(id);
  return false;
}

/**
 * The same openings with `item` opened or closed.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.noteExpansion
 */
export function withOpening(
  openings: FITOutlineOpenings,
  item: FITOutlineItem,
  open: boolean
): FITOutlineOpenings {
  const id = outlineItemId(item);
  if (item.kind === "entry") {
    const closed = new Set(openings.closedEntries);
    if (open) closed.delete(id);
    else closed.add(id);
    return { ...openings, closedEntries: closed };
  }
  if (item.kind === "cpuid") {
    const opened = new Set(openings.openCpuids);
    if (open) opened.add(id);
    else opened.delete(id);
    return { ...openings, openCpuids: opened };
  }
  return openings;
}

/**
 * The outline's visible rows for the display on hand: every entry, the heading
 * where the backup's copy starts, under a microcode a row for each CPUID it
 * serves — which opens into the processors behind it — and Add Microcode…
 * under the last microcode of the table, after what that microcode opened. Not
 * under the Top Swap backup's copy, which is changed only with the table; under
 * the header where the table has no microcode.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.rebuildItems
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.outlineView
 */
export function fitOutlineRows(
  display: FITDisplay,
  openings: FITOutlineOpenings = NO_OPENINGS
): FITOutlineRow[] {
  const table = display.rows.filter((row) => !row.isBackup);
  const anchor =
    [...table].reverse().find((row) => row.model.entry.type === FIT.microcodeType) ?? table[0];
  const rows: FITOutlineRow[] = [];
  const push = (item: FITOutlineItem, depth: number, expandable: boolean) => {
    const open = expandable && isOpen(item, openings);
    rows.push({ item, id: outlineItemId(item), depth, expandable, isOpen: open });
    return open;
  };
  const heading = () => push({ kind: "heading" }, 0, false);
  display.rows.forEach((row: FITDisplayRow, index) => {
    if (display.backupStart === index) heading();
    const key = rowKey(row);
    const groups = row.processorGroups;
    if (push({ kind: "entry", key }, 0, groups.length > 0)) {
      groups.forEach((group, g) => {
        if (push({ kind: "cpuid", key, group: g }, 1, group.lines.length > 0)) {
          group.lines.forEach((_, line) => {
            push({ kind: "line", key, group: g, line }, 2, false);
          });
        }
      });
    }
    if (row === anchor) push({ kind: "addMicrocode" }, 0, false);
  });
  if (display.backupStart !== undefined && display.backupStart === display.rows.length) heading();
  return rows;
}
