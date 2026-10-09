import type { AgentMark } from "@/core/agent/agentMark";
import { L } from "@/core/localization/localization";

/**
 * The Marks page of the Agent window: what each column says of a mark.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.Column.title
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.text
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.shownText
 */
export type AgentMarkColumn = "id" | "label" | "document" | "range" | "note" | "related";

export const AGENT_MARK_COLUMNS: readonly AgentMarkColumn[] = [
  "id",
  "label",
  "document",
  "range",
  "note",
  "related",
];

export function markColumnTitle(column: AgentMarkColumn): string {
  switch (column) {
    case "id":
      return L("Mark");
    case "label":
      return L("Label");
    case "document":
      return L("File");
    case "range":
      return L("Bytes");
    case "note":
      return L("Note");
    case "related":
      return L("About");
  }
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/**
 * A row's cell. `fileName` is what the pane calls its file; `all` is every mark listed, for the
 * labels of a relation's other end.
 */
export function markText(
  mark: AgentMark,
  column: AgentMarkColumn,
  fileName: string,
  all: readonly AgentMark[]
): string {
  switch (column) {
    case "id":
      return mark.id;
    case "label":
      return mark.label;
    case "document":
      return fileName;
    case "range":
      return `${hex(mark.start)}–${hex(mark.end)}`;
    case "note":
      return mark.note;
    case "related":
      // Each end of a relation by its id and label, so the pair reads without looking the other
      // row up.
      return mark.relatedTo
        .map((id) => {
          const label = all.find((one) => one.id === id)?.label;
          return label === undefined ? id : `${id} ${label}`;
        })
        .join(", ");
  }
}
