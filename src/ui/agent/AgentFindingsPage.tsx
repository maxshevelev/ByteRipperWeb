import { useState } from "react";
import { AGENT_FINDING_COLUMNS, findingText } from "@/core/agent/agentFindingText";
import type { AgentFinding } from "@/core/agent/agentSurvey";
import { L } from "@/core/localization/localization";
import {
  AgentTableHead,
  agentTableMinWidth,
  findingColumns,
  useAgentColumns,
} from "@/ui/agent/AgentTableHead";

/**
 * The Findings page of the Agent window: what an agent found, file by file, each a line to check. A
 * double-click opens the file at the place — the pane that has it, or a free one.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.build
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.show
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.doubleClicked
 */
export function AgentFindingsPage({
  findings,
  onShow,
}: {
  readonly findings: readonly AgentFinding[];
  readonly onShow: (finding: AgentFinding) => void;
}) {
  const { columns, kept } = useAgentColumns(findingColumns, "AgentFindingsTable");
  // @web-only the row last clicked, drawn chosen as a row of the other pages is
  const [chosen, setChosen] = useState<string | undefined>();
  return (
    <div className="agent-single">
      <div className="agent-log">
        <table
          className="agent-table agent-findings"
          aria-label={L("Findings")}
          style={{ minWidth: agentTableMinWidth(columns, kept) }}
        >
          <AgentTableHead
            columns={columns}
            kept={kept}
            cellClass={(id) => `agent-finding-col-${id}`}
          />
          <tbody>
            {findings.map((finding) => (
              <tr
                key={finding.id}
                className="agent-row"
                aria-selected={finding.id === chosen}
                onClick={() => setChosen(finding.id)}
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
                      {column === "id" ? (
                        <button
                          type="button"
                          className="agent-row-button"
                          onClick={() => onShow(finding)}
                        >
                          {text}
                        </button>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
