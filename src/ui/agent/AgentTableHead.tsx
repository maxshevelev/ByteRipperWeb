import { useMemo } from "react";
import { findingColumnTitle } from "@/core/agent/agentFindingText";
import { columnTitle } from "@/core/agent/agentLogText";
import { markColumnTitle } from "@/core/agent/agentMarkText";
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

/** Upstream's floor for every column of the window: `ToolPanelFont.scaled(36)`. */
const MIN = 36;

/** A column of one of the window's tables, by upstream's width; `grows` takes the slack. */
const column = (id: string, title: string, width: number, grows = false): TableColumn => ({
  id,
  title,
  width,
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
export const logColumns = (): readonly TableColumn[] => [
  column("time", columnTitle("time"), 64),
  column("tool", columnTitle("tool"), 90),
  column("arguments", columnTitle("arguments"), 250, true),
  column("duration", columnTitle("duration"), 60),
  column("size", columnTitle("size"), 64),
  column("result", columnTitle("result"), 150),
];

/**
 * The Marks: Note, the last column and the one with the most to say, gives way.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column.width
 */
export const markColumns = (): readonly TableColumn[] => [
  column("id", markColumnTitle("id"), 44),
  column("label", markColumnTitle("label"), 150),
  column("document", markColumnTitle("document"), 110),
  column("range", markColumnTitle("range"), 150),
  column("note", markColumnTitle("note"), 340, true),
];

/**
 * The Findings.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column.width
 * @upstream-differs the finding's text takes the slack, where upstream shares it among every
 * column in proportion — a CSS table has one column that grows, not a resizing style
 */
export const findingColumns = (): readonly TableColumn[] => [
  column("id", findingColumnTitle("id"), 50),
  column("text", findingColumnTitle("text"), 330, true),
  column("file", findingColumnTitle("file"), 140),
  column("place", findingColumnTitle("place"), 150),
];

/** Upstream's names for the tables' kept widths. */
export type AgentTableName =
  | "AgentLogTable"
  | "AgentMarksTable"
  | "AgentFindingsTable"
  | "AgentToolsTable";

/**
 * A table's columns and their widths, kept under the table's name. The columns are built once,
 * in the language the panel opened in.
 */
export function useAgentColumns(
  build: () => readonly TableColumn[],
  name: AgentTableName
): { readonly columns: readonly TableColumn[]; readonly kept: ColumnWidths } {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the spec is built once, as a module constant would be
  const columns = useMemo(build, []);
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
                ? { minWidth: one.min }
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
 * How wide the table is at the least: every column at its width but the one that grows, at its
 * floor — narrower than that, the list scrolls sideways rather than squeezing a column it was
 * told to keep.
 */
export function agentTableMinWidth(columns: readonly TableColumn[], kept: ColumnWidths): number {
  return columns.reduce(
    (sum, one) =>
      sum +
      (one.grows === true ? one.min * 3 : clampColumnWidth(kept.widths[one.id] ?? one.width, one)),
    0
  );
}
