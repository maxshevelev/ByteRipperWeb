import type { AgentFinding } from "@/core/agent/agentSurvey";
import { L } from "@/core/localization/localization";

/**
 * The Findings page of the Agent window: what each column says of a finding.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.Column.title
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentFindingsTable.text
 */
export type AgentFindingColumn = "id" | "text" | "file" | "place";

export const AGENT_FINDING_COLUMNS: readonly AgentFindingColumn[] = ["id", "text", "file", "place"];

export function findingColumnTitle(column: AgentFindingColumn): string {
  switch (column) {
    case "id":
      return L("Finding");
    case "text":
      return L("What was found");
    case "file":
      return L("File");
    case "place":
      return L("Where");
  }
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

export function findingText(finding: AgentFinding, column: AgentFindingColumn): string {
  switch (column) {
    case "id":
      return finding.id;
    case "text":
      return finding.text;
    case "file":
      return finding.file;
    case "place": {
      const parts: string[] = [];
      const range = finding.range;
      if (range !== undefined) {
        parts.push(
          range.end <= range.start ? hex(range.start) : `${hex(range.start)}–${hex(range.end)}`
        );
      }
      if (finding.node !== undefined) parts.push(L("node %1$@", finding.node));
      return parts.join(" · ");
    }
  }
}
