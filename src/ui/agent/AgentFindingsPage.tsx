import type { KeyboardEvent } from "react";
import { AGENT_FINDING_COLUMNS, findingText } from "@/core/agent/agentFindingText";
import type { AgentFinding } from "@/core/agent/agentSurvey";
import { L } from "@/core/localization/localization";
import { AgentList } from "@/ui/agent/AgentList";
import {
  AgentTableHead,
  agentRowClass,
  agentTableMinWidth,
  findingColumns,
  useAgentColumns,
} from "@/ui/agent/AgentTableHead";

/**
 * The Findings page of the Agent window: what an agent found, file by file, each a line to check. A
 * click chooses a row; a double-click opens the file at the place — the pane that has it, or a
 * free one.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.build
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.show
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.doubleClicked
 */
export function AgentFindingsPage({
  findings,
  chosen,
  onChoose,
  onShow,
  onKeyDown,
}: {
  readonly findings: readonly AgentFinding[];
  readonly chosen: string | undefined;
  readonly onChoose: (id: string) => void;
  readonly onShow: (finding: AgentFinding) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { columns, kept } = useAgentColumns(findingColumns, "AgentFindingsTable");
  return (
    <div className="agent-single">
      <AgentList label={L("Findings")} onKeyDown={onKeyDown}>
        <table
          className="agent-table agent-findings"
          style={{ minWidth: agentTableMinWidth(columns, kept) }}
        >
          <AgentTableHead
            columns={columns}
            kept={kept}
            cellClass={(id) => `agent-finding-col-${id}`}
          />
          <tbody>
            {findings.map((finding, index) => (
              <tr
                key={finding.id}
                className={agentRowClass(index)}
                data-row={finding.id}
                aria-selected={finding.id === chosen}
                onClick={() => onChoose(finding.id)}
                onDoubleClick={() => onShow(finding)}
              >
                {AGENT_FINDING_COLUMNS.map((column) => {
                  const text = findingText(finding, column);
                  return (
                    <td
                      key={column}
                      className={`agent-cell agent-finding-col-${column}`}
                      title={
                        column === "file"
                          ? (finding.path ?? finding.file)
                          : column === "text"
                            ? text
                            : undefined
                      }
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </AgentList>
    </div>
  );
}
