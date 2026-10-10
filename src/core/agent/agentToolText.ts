import { clockText, type DetailField, detailTimeText } from "@/core/agent/agentLogText";
import {
  type AgentToolEntry,
  type AgentToolStats,
  averageMilliseconds,
  durationText,
  kindTitle,
} from "@/core/agent/agentToolCatalogue";
import { L } from "@/core/localization/localization";
import { friendlySize } from "@/core/text/byteSize";

/**
 * What the Tools page of the Agent window says of a tool, column by column, and in the details
 * under the list — as `agentLogText` does for the Log and `agentMarkText` for the Marks.
 *
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage
 */

/** The columns of the table. @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.Column */
export type AgentToolColumn = "tool" | "kind" | "calls" | "failures" | "average" | "size" | "last";

export const AGENT_TOOL_COLUMNS: readonly AgentToolColumn[] = [
  "tool",
  "kind",
  "calls",
  "failures",
  "average",
  "size",
  "last",
];

/** @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.Column.title */
export function toolColumnTitle(column: AgentToolColumn): string {
  switch (column) {
    case "tool":
      return L("Tool");
    case "kind":
      return L("Kind");
    case "calls":
      return L("Calls");
    case "failures":
      return L("Not Answered");
    case "average":
      return L("Average");
    case "size":
      return L("Answers");
    case "last":
      return L("Last Call");
  }
}

/** A row's cell: what the tool is and how it has been used. @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.text */
export function toolText(
  entry: AgentToolEntry,
  column: AgentToolColumn,
  used: AgentToolStats | undefined
): string {
  switch (column) {
    case "tool":
      return entry.tool.name;
    case "kind":
      return kindTitle(entry.kind);
    case "calls":
      return used === undefined ? "" : String(used.calls);
    case "failures":
      return used === undefined || used.failures === 0 ? "" : String(used.failures);
    case "average": {
      const average = used === undefined ? undefined : averageMilliseconds(used);
      return average === undefined ? "" : durationText(average);
    }
    case "size":
      return used === undefined ? "" : friendlySize(used.answerBytes);
    case "last":
      return used?.last === undefined ? "" : clockText(used.last);
  }
}

/** The rows the details list shows for a tool, above its description. @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.detailFields */
export function toolDetailFields(
  entry: AgentToolEntry,
  used: AgentToolStats | undefined
): DetailField[] {
  const fields: DetailField[] = [];
  const add = (label: string, value: string, isProblem = false) =>
    fields.push({ label, value, isProblem });
  if (entry.tool.title !== undefined) add(L("Title"), entry.tool.title);
  add(L("Group"), entry.group.title());
  add(L("Kind"), kindTitle(entry.kind));
  if (used === undefined) {
    add(L("Calls"), L("None yet"));
    return fields;
  }
  add(L("Calls"), String(used.calls));
  if (used.failures > 0) add(L("Not Answered"), String(used.failures), true);
  const average = averageMilliseconds(used);
  if (average !== undefined) add(L("Average"), durationText(average));
  add(L("Longest"), durationText(used.longestMilliseconds));
  add(L("Answers"), L("%1$@ bytes", used.answerBytes));
  if (used.last !== undefined) add(L("Last Call"), detailTimeText(used.last));
  return fields;
}
