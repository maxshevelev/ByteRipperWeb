import { useCallback, useState } from "react";

/**
 * The columns of a tool panel's table: how wide each one is, how far it gives
 * way, and which one takes the panel's spare width.
 *
 * Upstream's model, one `NSTableColumn` at a time. A column is as wide as it
 * was laid out, down to a floor, and exactly one column in a table carries
 * `.autoresizingMask` — it takes whatever the panel has left over. UEFI's tree
 * gives that to Name, the FIT table to "Points at", and the ME tree to its
 * values column, which is the owner's choice rather than upstream's (see the
 * spec in `meTool.tsx`). Every other column is draggable and nothing more,
 * which is upstream's `.userResizingMask`: without it, its own comment says, "a
 * column cannot be dragged at all, whatever `allowsColumnResizing` says".
 *
 * The widths live here and nowhere else: they are what the panel is showing
 * now. Upstream keeps them in the view controller and persists none of them —
 * no `autosaveName`, no defaults key anywhere in the repository — so a width a
 * reader drags is theirs while the panel is on screen, and a table built again
 * starts from the design.
 *
 * Ported from `Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift`.
 */

/**
 * One column of a panel's table.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
 * @upstream-differs a plain record where upstream is an `NSTableColumn`, and the
 * sizing rules are spelled out here rather than handed to AppKit
 */
export interface TableColumn {
  /** Names the column to the width map, and to a test. */
  readonly id: string;
  /** What the header cell says. */
  readonly title: string;
  /**
   * The width it was laid out at, in px at this panel's 13-pixel text — its
   * design width, and what a drag that is put back starts from.
   *
   * Unused on the column that grows: that one is as wide as the panel leaves
   * it, and its `min` alone says where it stops.
   */
  readonly width: number;
  /**
   * How far a drag may squeeze it — upstream's `minWidth`, and the floor a
   * narrow panel takes it to.
   */
  readonly min: number;
  /**
   * Takes the panel's spare width. Exactly one column in a table has this, as
   * exactly one carries `.autoresizingMask` upstream.
   */
  readonly grows?: boolean;
}

/** How wide a drag may pull a column out. Upstream's columns have no ceiling. */
const MAX_COLUMN_WIDTH = 2000;

/** What a table's columns are before anyone has dragged one. */
export function designWidths(columns: readonly TableColumn[]): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const column of columns) widths[column.id] = column.width;
  return widths;
}

/**
 * A width inside the column's own range — its floor and this table's ceiling.
 * The clamp is the component's job, the same way `EdgeSplitter` clamps and
 * leaves remembering to its caller.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable.scaleColumnWidths
 */
export function clampColumnWidth(width: number, column: TableColumn): number {
  if (!Number.isFinite(width)) return column.width;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(column.min, Math.round(width)));
}

/**
 * The `grid-template-columns` for a table: every column `minmax`ed between its
 * floor and its width, except the one that grows, which is `minmax`ed between
 * its floor and `1fr`.
 *
 * A `minmax(min, width)` column still gives way below its width when the panel
 * is too narrow — that is what the floor is for — and the growing column takes
 * everything above the others' widths. On the ME tree's 300/150 that is 288/150
 * on a 438-pixel panel, as it has always read, and 300/500 on an 800-pixel one,
 * where the values column is the one that grew.
 */
export function columnTemplate(
  widths: Readonly<Record<string, number>>,
  columns: readonly TableColumn[]
): string {
  return columns
    .map((column) => {
      if (column.grows === true) return `minmax(${column.min}px, 1fr)`;
      const width = clampColumnWidth(widths[column.id] ?? column.width, column);
      return `minmax(${column.min}px, ${width}px)`;
    })
    .join(" ");
}

/** The narrowest a table of these columns can be, for the row a scroller scrolls. */
export function columnsMinWidth(columns: readonly TableColumn[]): number {
  return columns.reduce((sum, column) => sum + column.min, 0);
}

/**
 * Which column a drag on the boundary at the right edge of `columns[index]`
 * resizes, and which way — or nothing where there is no such boundary, which is
 * the table's own right edge and the end of the list.
 *
 * A boundary drag moves the boundary under the pointer, which is the gesture
 * AppKit gives: the column on the left grows by what the pointer travelled, and
 * its right-hand neighbour gives it up. So this resizes `columns[index]` —
 * unless that one is the column that *grows*, whose width is the panel's to
 * decide and not the reader's. Then the drag resizes the neighbour instead and
 * backwards: pulling right widens the growing column by taking from the fixed
 * one, which is the same boundary moving the same way.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
 */
export function boundaryTarget(
  columns: readonly TableColumn[],
  index: number
): { readonly id: string; readonly sign: 1 | -1 } | undefined {
  const left = columns[index];
  const right = columns[index + 1];
  if (left === undefined || right === undefined) return undefined;
  return left.grows === true ? { id: right.id, sign: -1 } : { id: left.id, sign: 1 };
}

/**
 * Where a column lands after a boundary drag of `delta` px — the clamp applied,
 * so the caller stores a width the table can actually use.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
 */
export function draggedWidth(
  start: number,
  delta: number,
  column: TableColumn,
  sign: 1 | -1
): number {
  return clampColumnWidth(start + sign * delta, column);
}

/** A table's column widths, and the two things a reader can do to them. */
export interface ColumnWidths {
  /** Width by column id. A column the reader has not dragged is at its design width. */
  readonly widths: Readonly<Record<string, number>>;
  /** Sets one column's width, clamped to its own range. */
  readonly resize: (id: string, width: number) => void;
  /** Puts every column back to its design width — a double-click on a handle. */
  readonly reset: () => void;
}

/**
 * A table's widths, kept for as long as its panel is on screen.
 *
 * `columns` is expected to be a module constant: it seeds the state once, and a
 * fresh array each render would be a spec that changed without the widths
 * following it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
 * @upstream-differs a hook, where upstream keeps the widths on the view controller
 */
export function useColumnWidths(columns: readonly TableColumn[]): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>(() => designWidths(columns));

  const resize = useCallback(
    (id: string, width: number) => {
      const column = columns.find((one) => one.id === id);
      if (column === undefined) return;
      const next = clampColumnWidth(width, column);
      setWidths((current) => (current[id] === next ? current : { ...current, [id]: next }));
    },
    [columns]
  );

  const reset = useCallback(() => setWidths(designWidths(columns)), [columns]);

  return { widths, resize, reset };
}
