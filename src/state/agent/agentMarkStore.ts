import type { AgentMark } from "@/core/agent/agentMark";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { createStore } from "@/state/store";
import { type PaneId, paneState, workspaceStore } from "@/state/workspaceStore";

/**
 * What an agent has marked in each pane's document, drawn over the dump with the pane
 * (`Design/PORT_AGENT.md`, "Marks").
 *
 * Its own layer: a zone map is the tool session's and goes with it, these stay until the agent or
 * the person removes them, or the document goes. Each pane's marks are kept with the document they
 * are about, so a file opened into the pane later is never read as carrying them.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.agentMarks
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setAgentMarks
 */
export interface AgentMarkState {
  readonly panes: Readonly<
    Partial<
      Record<PaneId, { readonly document: BinaryDocument; readonly marks: readonly AgentMark[] }>
    >
  >;
}

export const agentMarkStore = createStore<AgentMarkState>({ panes: {} });

const NONE: readonly AgentMark[] = [];

/** The marks in a pane's document as it is now; none for a document that has gone. */
export function agentMarksFor(pane: PaneId, state: AgentMarkState = agentMarkStore.getSnapshot()) {
  const held = state.panes[pane];
  if (held === undefined || held.document !== paneState(pane)?.document) return NONE;
  return held.marks;
}

/** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.setAgentMarks */
export function setAgentMarks(pane: PaneId, marks: readonly AgentMark[]): void {
  const document = paneState(pane)?.document;
  if (document === undefined) return;
  agentMarkStore.update((state) => {
    if (sameMarks(agentMarksFor(pane, state), marks)) return state;
    const panes = { ...state.panes };
    if (marks.length === 0) delete panes[pane];
    else panes[pane] = { document, marks };
    return { panes };
  });
}

const sameMarks = (one: readonly AgentMark[], two: readonly AgentMark[]): boolean =>
  one.length === two.length &&
  one.every((mark, index) => {
    const other = two[index];
    return (
      other !== undefined &&
      mark.id === other.id &&
      mark.start === other.start &&
      mark.end === other.end &&
      mark.label === other.label &&
      mark.note === other.note &&
      mark.relatedTo.join("\u0000") === other.relatedTo.join("\u0000")
    );
  });

// The bytes they were about are gone; so are they.
// @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.open
workspaceStore.subscribe(() => {
  const state = agentMarkStore.getSnapshot();
  const stale = (Object.keys(state.panes) as PaneId[]).filter(
    (pane) => state.panes[pane]?.document !== paneState(pane)?.document
  );
  if (stale.length === 0) return;
  agentMarkStore.update((current) => {
    const panes = { ...current.panes };
    for (const pane of stale) delete panes[pane];
    return { panes };
  });
});
