import { findingColumnTitle } from "@/core/agent/agentFindingText";
import { columnTitle } from "@/core/agent/agentLogText";
import { markColumnTitle } from "@/core/agent/agentMarkText";
import {
  AGENT_TOOL_COLUMNS,
  type AgentToolColumn,
  toolColumnTitle,
} from "@/core/agent/agentToolText";
import { localized } from "@/core/localization/localization";
import { ColumnResizer } from "@/ui/toolPanel/ColumnResizer";
import {
  type ColumnWidths,
  clampColumnWidth,
  type TableColumn,
  useColumnWidths,
} from "@/ui/toolPanel/columnWidths";

/**
 * The columns of the Agent window's four tables: what each is called, how wide it is laid out,
 * which one gives way with the panel, and the head that draws them with a handle on every
 * boundary. Each table keeps its widths between launches under upstream's name for it.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#keepColumnWidths
 */

/**
 * A width upstream lays out for 11-point text, at the 13 pixels the window's text is — what a tool
 * panel's table does with upstream's widths too (`fitColumns`, `MicrocodeForm`).
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelFont.swift#ToolPanelFont.scaled
 * @upstream-differs at the panels' default size only: the window does not follow the zoom
 */
const scaled = (width: number): number => Math.round((width * 13) / 11);

/** Upstream's floor for every column of the window: `ToolPanelFont.scaled(36)`. */
const MIN = scaled(36);

/** A column of one of the window's tables, by upstream's width; `grows` takes the slack. */
const column = (id: string, title: string, width: number, grows = false): TableColumn => ({
  id,
  title,
  width: scaled(width),
  min: MIN,
  grows,
});

/**
 * The Log: only Arguments, the column with the most to say, gives way with the panel.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.Column.width
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.Column.title
 */
export const logColumns = localized((): readonly TableColumn[] => [
  column("time", columnTitle("time"), 64),
  column("tool", columnTitle("tool"), 90),
  column("arguments", columnTitle("arguments"), 250, true),
  column("duration", columnTitle("duration"), 60),
  column("size", columnTitle("size"), 64),
  column("result", columnTitle("result"), 150),
]);

/**
 * The Marks: Note, the last column and the one with the most to say, gives way.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column.width
 */
export const markColumns = localized((): readonly TableColumn[] => [
  column("id", markColumnTitle("id"), 44),
  column("label", markColumnTitle("label"), 150),
  column("document", markColumnTitle("document"), 110),
  column("range", markColumnTitle("range"), 150),
  column("note", markColumnTitle("note"), 340, true),
]);

/**
 * The Findings.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column.width
 * @upstream-differs the finding's text takes the slack, where upstream shares it among every
 * column in proportion — a CSS table has one column that grows, not a resizing style
 */
export const findingColumns = localized((): readonly TableColumn[] => [
  column("id", findingColumnTitle("id"), 50),
  column("text", findingColumnTitle("text"), 330, true),
  column("file", findingColumnTitle("file"), 140),
  column("place", findingColumnTitle("place"), 150),
]);

/** Upstream's widths for the Tools page. @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.Column.width */
const TOOL_COLUMN_WIDTHS: Readonly<Record<AgentToolColumn, number>> = {
  tool: 190,
  kind: 80,
  calls: 44,
  failures: 92,
  average: 60,
  size: 64,
  last: 60,
};

/**
 * The Tools page: the last, Last Call, gives way with the panel.
 *
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.build
 */
export const toolColumns = localized((): readonly TableColumn[] =>
  AGENT_TOOL_COLUMNS.map((one) =>
    column(one, toolColumnTitle(one), TOOL_COLUMN_WIDTHS[one], one === "last")
  )
);

/** Upstream's names for the tables' kept widths. */
export type AgentTableName =
  | "AgentLogTable"
  | "AgentMarksTable"
  | "AgentFindingsTable"
  | "AgentToolsTable";

/**
 * A table's columns and their widths, kept under the table's name. The columns are built once per
 * language (`localized`), so their titles follow a change of language and the widths keep their
 * spec.
 */
export function useAgentColumns(
  build: () => readonly TableColumn[],
  name: AgentTableName
): { readonly columns: readonly TableColumn[]; readonly kept: ColumnWidths } {
  const columns = build();
  const kept = useColumnWidths(columns, name);
  return { columns, kept };
}

/**
 * The table's column widths and its head: a `<col>` per column at its kept width — the column that
 * grows has none, and takes what the others leave — and a header cell per column with the handle
 * on its right edge. `cellClass` names a column's cells, so the head and the body line up in the
 * stylesheet.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentTableStyle
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentTableStyle.apply
 */
export function AgentTableHead({
  columns,
  kept,
  cellClass,
}: {
  readonly columns: readonly TableColumn[];
  readonly kept: ColumnWidths;
  readonly cellClass: (id: string) => string;
}) {
  return (
    <>
      <colgroup>
        {columns.map((one) => (
          <col
            key={one.id}
            style={
              one.grows === true
                ? undefined
                : { width: clampColumnWidth(kept.widths[one.id] ?? one.width, one) }
            }
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((one, index) => (
            <th key={one.id} className={`agent-cell ${cellClass(one.id)}`} scope="col">
              {one.title}
              <ColumnResizer
                columns={columns}
                index={index}
                widths={kept.widths}
                onChange={kept.resize}
                onReset={kept.reset}
              />
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
}

/**
 * How wide the table is at the least: every column at its width but the one that grows, which
 * keeps three times its floor so it never narrows to a sliver — narrower than that, the list
 * scrolls sideways rather than squeezing a column it was told to keep.
 */
const GROWING_FLOOR = 3;

export function agentTableMinWidth(columns: readonly TableColumn[], kept: ColumnWidths): number {
  return columns.reduce(
    (sum, one) =>
      sum +
      (one.grows === true
        ? one.min * GROWING_FLOOR
        : clampColumnWidth(kept.widths[one.id] ?? one.width, one)),
    0
  );
}

/**
 * A row's class: every second one raised, counted by the row's place in the whole list.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentTableStyle.apply
 * @upstream-differs AppKit alternates by row index for `usesAlternatingRowBackgroundColors`; a CSS
 * `nth-child` restarts in every `tbody`, which is a section of the Tools page
 */
export const agentRowClass = (index: number): string =>
  index % 2 === 1 ? "agent-row agent-row-raised" : "agent-row";
