import { columnsMinWidth, type TableColumn } from "@/ui/toolPanel/columnWidths";

/**
 * The FIT table's columns, and how they share a panel that is not as wide as
 * they were laid out for.
 *
 * "Points at" takes the width the other columns leave. Below its floor, Size and
 * then Type give way down to theirs; with room again, Type and then Size get
 * back what they gave, and "Points at" the rest. Only past every floor does the
 * table become wider than the panel and the list scroll sideways.
 *
 * Ported from the column half of upstream's `FITToolViewController`.
 */

/**
 * The columns, with the width each was laid out at — upstream's design widths
 * (20, 96, 76, 84, 300 points at its 11-point design size) at this panel's 13
 * pixels.
 *
 * `min` is how far a column gives way when the panel is narrow: the row number
 * and the eight hex digits of an address not at all, the rest to where their
 * text starts to be cut short.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.entryColumns
 */
export const FIT_COLUMNS: readonly TableColumn[] = [
  { id: "index", title: "#", width: 24, min: 24 },
  { id: "type", title: "Type", width: 113, min: 64 },
  { id: "address", title: "Address", width: 90, min: 90 },
  { id: "size", title: "Size", width: 99, min: 48 },
  { id: "target", title: "Points at", width: 355, min: 96, grows: true },
];

/**
 * The columns that give way, in order, once "Points at" is down to its floor
 * and the table is still wider than the panel — and get their width back, the
 * other way round, when the panel grows again.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.yieldingColumns
 */
export const FIT_YIELDING_COLUMNS: readonly string[] = ["size", "type"];

/**
 * The narrowest the row can be: every column at its floor. Below this the table
 * stays this wide and the list scrolls sideways, which is the one case where it
 * does.
 */
export const FIT_MIN_WIDTH = columnsMinWidth(FIT_COLUMNS);

/** A width worth acting on: below this the two are the same width. */
const EPSILON = 0.5;

/**
 * The widths the table draws at, for a panel `available` pixels wide.
 *
 * `wanted` is the width each column was *given* — by the design, or by a drag —
 * which is what a column that gave way comes back to. It is the hook's own map:
 * nothing here writes to it, so the panel moving the columns itself can never
 * be taken for a drag, which is what upstream needs its `isFittingColumns` flag
 * to rule out.
 *
 * A panel too narrow even for every floor gets the floors, and the list scrolls
 * sideways: there is nothing left to give.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.fitColumnsToThePanel
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.wantedWidths
 * @upstream-differs a function of the panel's width rather than a pass over live
 * `NSTableColumn`s, so the widths a reader dragged stay the ones they dragged
 */
export function fittedColumnWidths(
  columns: readonly TableColumn[],
  wanted: Readonly<Record<string, number>>,
  available: number
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const column of columns) widths[column.id] = wanted[column.id] ?? column.width;

  const grower = columns.find((column) => column.grows === true);
  // Without a column to take the slack there is nothing to fit: every column is
  // the width it was given, as it was before this rule existed.
  if (grower === undefined || !Number.isFinite(available) || available <= 0) return widths;

  const others = columns.filter((column) => column.id !== grower.id);
  const widthOf = (id: string) => widths[id] ?? 0;
  const sumOthers = () => others.reduce((sum, column) => sum + widthOf(column.id), 0);

  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable */
  const sizeLastColumnToFit = () => {
    widths[grower.id] = Math.max(grower.min, available - sumOthers());
  };

  sizeLastColumnToFit();
  // Above zero only once "Points at" is at its floor and the row is still
  // wider than the panel.
  let overflow = sumOthers() + widthOf(grower.id) - available;

  for (const id of FIT_YIELDING_COLUMNS) {
    if (overflow <= EPSILON) break;
    const column = columns.find((one) => one.id === id);
    if (column === undefined) continue;
    const give = Math.min(overflow, widthOf(id) - column.min);
    if (give <= 0) continue;
    widths[id] = widthOf(id) - give;
    overflow -= give;
  }

  // Upstream has a third pass here, giving the width back the other way round —
  // Type first, then Size — when the panel grows again. It needs one because its
  // columns keep what they gave: the pass starts from the squeezed widths and
  // has to walk them home. This starts from `wanted` every time, so a panel that
  // grew is simply a wider `available` and the columns are already home; the
  // pass would have nothing to hand back. Checked against upstream's own walk
  // over random resizes, dragged widths included: the two agree everywhere.
  sizeLastColumnToFit();
  return widths;
}
