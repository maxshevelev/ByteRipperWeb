import {
  type AgentToolEntry,
  type AgentToolStats,
  averageMilliseconds,
  durationText,
  kindTitle,
  sectionsOf,
} from "@/core/agent/agentToolCatalogue";
import { prettyText } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import { friendlySize } from "@/core/text/byteSize";
import { AgentList } from "@/ui/agent/AgentList";

/**
 * The Tools page of the Agent window: every tool an agent is offered, in sections headed by where
 * the tools come from, with what each does and how it has been used since the app started; below,
 * the selected tool as the agent is told about it — its description and the arguments it takes.
 *
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.Column
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.show
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.showDetails
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.detailFields
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.rows
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.sectionTitles
 * @upstream-differs a React table: a section's heading is a row no one chooses, and the details are
 * under the list as the log's are
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

const two = (value: number) => String(value).padStart(2, "0");

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
      return used?.last === undefined
        ? ""
        : `${two(used.last.getHours())}:${two(used.last.getMinutes())}:${two(used.last.getSeconds())}`;
  }
}

/** The rows the details list shows for a tool, above its description. @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.detailFields */
export function toolDetailFields(
  entry: AgentToolEntry,
  used: AgentToolStats | undefined
): { readonly label: string; readonly value: string; readonly isProblem: boolean }[] {
  const fields: { label: string; value: string; isProblem: boolean }[] = [];
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
  if (used.last !== undefined) add(L("Last Call"), used.last.toLocaleTimeString());
  return fields;
}

// help: window.agent.tools
export function AgentToolsPage({
  entries,
  stats,
  chosen,
  onChoose,
  onKeyDown,
}: {
  readonly entries: readonly AgentToolEntry[];
  readonly stats: Readonly<Record<string, AgentToolStats>>;
  readonly chosen: string | undefined;
  readonly onChoose: (name: string) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const sections = sectionsOf(entries);
  const entry = entries.find((one) => one.tool.name === chosen);
  return (
    <>
      <AgentList onKeyDown={onKeyDown}>
        <table className="agent-table agent-tools" aria-label={L("Tools")}>
          <thead>
            <tr>
              {AGENT_TOOL_COLUMNS.map((column) => (
                <th key={column} className={`agent-cell agent-tool-col-${column}`} scope="col">
                  {toolColumnTitle(column)}
                </th>
              ))}
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.title}>
              <tr className="agent-section">
                <th colSpan={AGENT_TOOL_COLUMNS.length} scope="colgroup">
                  {section.title}
                </th>
              </tr>
              {section.entries.map((one) => (
                <tr
                  key={one.tool.name}
                  className="agent-row"
                  aria-selected={one.tool.name === chosen}
                >
                  {AGENT_TOOL_COLUMNS.map((column) => (
                    <td
                      key={column}
                      className={
                        column === "failures" && (stats[one.tool.name]?.failures ?? 0) > 0
                          ? `agent-cell agent-tool-col-${column} agent-bad`
                          : `agent-cell agent-tool-col-${column}`
                      }
                    >
                      {column === "tool" ? (
                        <button
                          type="button"
                          className="agent-row-button agent-tool-name"
                          onClick={() => onChoose(one.tool.name)}
                        >
                          {one.tool.name}
                        </button>
                      ) : (
                        toolText(one, column, stats[one.tool.name])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </AgentList>
      <div className="agent-details" aria-live="polite">
        {entry === undefined ? (
          <p className="agent-placeholder">
            {L("Select a tool to see what the agent is told about it.")}
          </p>
        ) : (
          <>
            <h3 className="agent-details-title">{entry.tool.name}</h3>
            <dl className="agent-fields">
              {toolDetailFields(entry, stats[entry.tool.name]).map((field) => (
                <div key={field.label} className="agent-field">
                  <dt>{field.label}</dt>
                  <dd className={field.isProblem ? "agent-bad" : undefined}>{field.value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="agent-details-title">{L("Description")}</h3>
            <p className="agent-description">{entry.tool.description}</p>
            <h3 className="agent-details-title">{L("Arguments")}</h3>
            <pre className="agent-arguments">{prettyText(entry.tool.inputSchema)}</pre>
          </>
        )}
      </div>
    </>
  );
}
