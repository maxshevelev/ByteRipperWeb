import { L } from "@/core/localization/localization";

/**
 * A place an agent marked in a dump and what it said about it (`Design/PORT_AGENT.md`, "Marks").
 *
 * A layer of its own on the pane, not a zone: zones belong to the tool-module session that
 * published them and go when it stops, and an agent's mark has to outlive the panel — it is what
 * the agent is talking about. It goes when the agent removes it, when the person clears it in the
 * Agent window, or when the document it is in closes.
 *
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.id
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.range
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.label
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.note
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.relatedTo
 */
export interface AgentMark {
  /** `m1`, `m2`… — what the agent removes it and relates others to it by. */
  readonly id: string;
  /** Half-open, in the document's own addresses. */
  readonly start: number;
  readonly end: number;
  /** A few words: what the bytes are. */
  readonly label: string;
  /** A sentence or two: why they matter. Shown when the pointer rests on the bytes. */
  readonly note: string;
  /** The marks this one is about — a pointer and what it points at. */
  readonly relatedTo: readonly string[];
}

/**
 * What the pointer resting on the bytes shows: the label, the note and the marks this one is
 * about, named by `labels` where it knows them.
 *
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.tooltip
 */
export const markTooltip = (mark: AgentMark, labels: ReadonlyMap<string, string>): string =>
  [mark.label, mark.note, markRelations(mark, labels)].filter((part) => part !== "").join("\n");

/**
 * "Related Marks: m1 FIT pointer, m3", or "" for a mark about no other — the one place a relation
 * reads, in the Agent window and over the dump.
 *
 * @upstream ByteRipperApp/Agent/AgentMark.swift#AgentMark.relations
 */
export function markRelations(mark: AgentMark, labels: ReadonlyMap<string, string>): string {
  if (mark.relatedTo.length === 0) return "";
  const named = mark.relatedTo.map((id) => {
    const label = labels.get(id);
    return label === undefined ? id : `${id} ${label}`;
  });
  return L("Related Marks: %1$@", named.join(", "));
}

/** Each mark's label by its id: what a relation is named by. */
export function markLabels(marks: readonly AgentMark[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const mark of marks) if (!labels.has(mark.id)) labels.set(mark.id, mark.label);
  return labels;
}

/**
 * What the agent said about the byte at `offset` — the innermost mark holding it — or "" for none.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexAgentMarkTooltip
 */
export function agentMarkTooltip(marks: readonly AgentMark[], offset: number): string {
  let found: AgentMark | undefined;
  for (const mark of marks) {
    if (offset < mark.start || offset >= mark.end) continue;
    if (found === undefined || mark.end - mark.start < found.end - found.start) found = mark;
  }
  return found === undefined ? "" : markTooltip(found, markLabels(marks));
}
