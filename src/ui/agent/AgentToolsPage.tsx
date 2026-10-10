import { type KeyboardEvent, useRef } from "react";
import {
  type AgentToolEntry,
  type AgentToolStats,
  sectionsOf,
} from "@/core/agent/agentToolCatalogue";
import { AGENT_TOOL_COLUMNS, toolDetailFields, toolText } from "@/core/agent/agentToolText";
import { prettyText } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import { EMPTY_DETAIL, field } from "@/tools/toolDetail";
import { AgentList } from "@/ui/agent/AgentList";
import { AgentSplit } from "@/ui/agent/AgentSplit";
import {
  AgentTableHead,
  agentRowClass,
  agentTableMinWidth,
  toolColumns,
  useAgentColumns,
} from "@/ui/agent/AgentTableHead";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";

/**
 * The Tools page of the Agent window: every tool an agent is offered, in sections headed by where
 * the tools come from, with what each does and how it has been used since the app started; below,
 * the selected tool as the agent is told about it — its description and the arguments it takes.
 *
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.show
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.showDetails
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.rows
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.sectionTitles
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.headingFont
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.headingSpaceAbove
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.headingSpaceBelow
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.toolIndent
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.HeadingView
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.headingView
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.toolCell
 * @upstream-differs a React table: a section's heading is a row no one chooses, drawn by the
 * stylesheet (`.agent-section`): a point over the names, semibold, grey, with room above it,
 * and the tool names stood in from it
 */

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
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const sections = sectionsOf(entries);
  // A row's place in the whole list, headings counted, which the stripes alternate by — as an
  // AppKit table alternates by row, its group rows among them.
  const rowIndex = new Map<string, number>();
  let at = 0;
  for (const section of sections) {
    at += 1;
    for (const one of section.entries) rowIndex.set(one.tool.name, at++);
  }
  const entry = entries.find((one) => one.tool.name === chosen);
  const { columns, kept } = useAgentColumns(toolColumns, "AgentToolsTable");
  const list = useRef<HTMLDivElement>(null);
  return (
    <AgentSplit
      name="tools"
      list={
        <AgentList label={L("Tools")} listRef={list} keyTable onKeyDown={onKeyDown}>
          <table
            className="agent-table agent-tools"
            style={{ minWidth: agentTableMinWidth(columns, kept) }}
          >
            <AgentTableHead
              columns={columns}
              kept={kept}
              cellClass={(id) => `agent-tool-col-${id}`}
            />
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
                    className={agentRowClass(rowIndex.get(one.tool.name) ?? 0)}
                    data-row={one.tool.name}
                    aria-selected={one.tool.name === chosen}
                    onClick={() => onChoose(one.tool.name)}
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
                        {toolText(one, column, stats[one.tool.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </AgentList>
      }
      details={
        <ToolDetail
          subject={entry?.tool.name}
          detail={
            entry === undefined
              ? EMPTY_DETAIL
              : {
                  title: entry.tool.name,
                  fields: toolDetailFields(entry, stats[entry.tool.name]).map((one) =>
                    field(one.label, one.value, one.isProblem)
                  ),
                  tables: [],
                }
          }
          placeholder={L("Select a tool to see what the agent is told about it.")}
          onFocusTable={() => list.current?.focus()}
          after={
            entry === undefined ? null : (
              <>
                <h3 className="tool-detail-title">{L("Description")}</h3>
                <p className="agent-description">{entry.tool.description}</p>
                <h3 className="tool-detail-title">{L("Arguments")}</h3>
                <pre className="agent-arguments">{prettyText(entry.tool.inputSchema)}</pre>
              </>
            )
          }
        />
      }
    />
  );
}
