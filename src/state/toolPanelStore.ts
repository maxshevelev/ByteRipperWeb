import { createStore } from "@/state/store";
import { TOOLS } from "@/tools/registry";

/**
 * Which tool the panel is showing.
 *
 * It lives here rather than inside the panel because two places choose it: the
 * panel's own picker, and the ☰ menu, which names every tool so that opening
 * one is a single gesture rather than "show the panel, then find the tool in a
 * popup". A component's own state cannot be the answer to a question something
 * outside it also answers.
 */

export interface ToolPanelState {
  readonly toolId: string;
}

export const toolPanelStore = createStore<ToolPanelState>({ toolId: TOOLS[0]?.id ?? "" });

export function chooseTool(toolId: string): void {
  toolPanelStore.update(() => ({ toolId }));
}
