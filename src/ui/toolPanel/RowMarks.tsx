import {
  hasRail,
  NO_ROW_MARKS,
  protectionMark,
  roleMark,
  roleTooltip,
  rowMarksSummary,
  rowRoles,
  type ToolRowMark,
  type ToolRowMarks,
} from "@/tools/toolRowMarks";
import { RowMarkIcon } from "@/ui/toolPanel/RowMarkIcon";

/**
 * What a firmware panel draws of a row's marks (`Design/ROW_MARKS.md` §1, §2):
 * the paint behind the row, and the icons in the column the row is named by, in
 * the catalogue's order — **verdict · problem · role badges**. One place, so
 * the UEFI tree, the FIT table and the ME tree dress a row the same way and a
 * mark cannot come out looking different in one of them.
 *
 * Upstream splits the same work between `ToolPanelRowView` (which draws the
 * background and the rail) and `ToolPanelTable` (which dresses the cell). Here
 * the paint is attributes on the row element and the icons are elements inside
 * it, because that is what a browser has instead of a row view and a cell view.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelRowView.swift#ToolPanelRowView
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable.dress
 */

/**
 * The paint a row wears: `data-tint` when a protection tints it, `data-rail`
 * when its bytes came out of compressed data. Both are read by the shared rules
 * in the stylesheet, which is where the composition with the alternating colour
 * and the selection lives — the three are background layers of one element.
 *
 * Nothing at all with the markings off, which is the panel's Show Markings
 * switch: the row draws plain and its icons, which are the elements', stay.
 *
 * A row that wears one paint but not the other carries only that one key, so
 * React writes only that attribute: a rule matching `[data-tint]` must not
 * match a row whose tint is empty.
 */
export function rowPaintAttrs(
  marks: ToolRowMarks | undefined,
  showsMarkings: boolean
): Record<string, string | undefined> {
  if (marks === undefined || !showsMarkings) return {};
  return {
    ...(marks.protection === undefined ? {} : { "data-tint": protectionMark(marks.protection) }),
    ...(hasRail(marks) ? { "data-rail": "" } : {}),
  };
}

/**
 * The row's background and rail in words, for the row's own tooltip — so that
 * nothing a row says is said by colour alone (§2). Nothing when it wears
 * neither, so a row that paints nothing is not given an empty tooltip that
 * would swallow the ones its cells carry.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable.dress
 */
export const rowMarkTitle = (marks: ToolRowMarks | undefined): string | undefined =>
  marks === undefined ? undefined : rowMarksSummary(marks);

/**
 * One icon a row draws: the mark, and what a reader is told about it — the name
 * a screen reader reads and the lines the pointer shows, which are the same
 * words upstream puts on a cell's image view.
 */
export interface RowMarkBadge {
  readonly mark: ToolRowMark;
  readonly label: string;
  readonly title: string;
}

/**
 * The icons a row wears ahead of its text, in the catalogue's order:
 * **verdict · problem · role badges**, at most two badges (§1).
 *
 * A mark the row does not wear is left out rather than drawn invisible, so it
 * takes no room: the list is short and the panels lay the rest out after it.
 *
 * Decided here rather than in the component so the order, the cap and the
 * absent cases can be checked without a window.
 */
export function rowMarksBadges(
  marks: ToolRowMarks | undefined,
  verdict?: { readonly mark: ToolRowMark; readonly toolTip: string } | undefined
): readonly RowMarkBadge[] {
  const badges: RowMarkBadge[] = [];
  if (verdict !== undefined) {
    badges.push({ mark: verdict.mark, label: verdict.toolTip, title: verdict.toolTip });
  }
  const problem = marks?.problem;
  if (problem !== undefined) {
    badges.push({
      mark: problem.isError ? "error" : "caution",
      // Upstream's `accessibilityDescription` and `toolTip`: every problem the
      // row has is in the pointer's reach.
      label: problem.isError ? "Invalid" : "Caution",
      title: problem.lines.join("\n"),
    });
  }
  for (const role of rowRoles(marks ?? NO_ROW_MARKS).slice(0, 2)) {
    const words = roleTooltip(role);
    badges.push({ mark: roleMark(role), label: words, title: words });
  }
  return badges;
}

/**
 * The icons a row wears ahead of its text, drawn from {@link rowMarksBadges}.
 *
 * `size` is in pixels, because every panel here sizes its marks in pixels: the
 * UEFI tree and the ME tree at the panel's own size, the FIT table a point
 * smaller.
 */
export function RowMarksIcons({
  marks,
  verdict,
  size,
}: {
  readonly marks: ToolRowMarks | undefined;
  /** The panel's own verdict, where it has one: the FIT table's, today. */
  readonly verdict?: { readonly mark: ToolRowMark; readonly toolTip: string } | undefined;
  readonly size?: number | undefined;
}) {
  return (
    <>
      {rowMarksBadges(marks, verdict).map((badge) => (
        <RowMarkIcon
          key={`${badge.mark}:${badge.label}`}
          mark={badge.mark}
          size={size}
          label={badge.label}
          title={badge.title}
        />
      ))}
    </>
  );
}
