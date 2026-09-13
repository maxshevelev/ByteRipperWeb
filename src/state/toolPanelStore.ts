import { closeFirmware } from "@/state/firmwareStore";
import { createStore } from "@/state/store";
import { PANE_IDS } from "@/state/workspaceStore";

/**
 * Which tool the panel is showing, if any, and how wide the panel is.
 *
 * It lives here rather than inside the panel because two places choose it: the
 * toolbar's picker, and the ☰ menu, which names every tool so that opening one
 * is a single gesture. A component's own state cannot be the answer to a
 * question something outside it also answers.
 *
 * No tool is None, and None is how the panel is closed — upstream's Tools menu
 * and toolbar pull-down work the same way, "None until one is picked".
 */

/**
 * Wide enough at the minimum for a tree row to say a name, a type, an offset
 * and a size; wide enough at the maximum for the ME tool's longest facts.
 */
export const MIN_TOOL_PANEL_WIDTH = 320;
export const MAX_TOOL_PANEL_WIDTH = 960;
export const DEFAULT_TOOL_PANEL_WIDTH = 440;

const WIDTH_STORAGE_KEY = "byteripper.toolPanelWidth";

export const clampToolPanelWidth = (width: number): number =>
  Math.min(MAX_TOOL_PANEL_WIDTH, Math.max(MIN_TOOL_PANEL_WIDTH, Math.round(width)));

/** The width the user last chose; see `minimapStore`'s twin for why a failure is the default. */
function storedWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_TOOL_PANEL_WIDTH;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampToolPanelWidth(parsed) : DEFAULT_TOOL_PANEL_WIDTH;
  } catch {
    return DEFAULT_TOOL_PANEL_WIDTH;
  }
}

export interface ToolPanelState {
  /** The tool on screen, or nothing — None, with no panel at all. */
  readonly toolId: string | undefined;
  /** The panel's width in CSS pixels. */
  readonly width: number;
}

export const toolPanelStore = createStore<ToolPanelState>({
  toolId: undefined,
  width: storedWidth(),
});

export function chooseTool(toolId: string | undefined): void {
  if (toolPanelStore.getSnapshot().toolId === toolId) return;
  toolPanelStore.update((state) => ({ ...state, toolId }));
  // The tree is worth keeping while a tool shows it and not a byte longer: it
  // is the largest thing this application holds. Switching between tools keeps
  // it, because one tree serves all three.
  if (toolId === undefined) {
    for (const pane of PANE_IDS) closeFirmware(pane);
  }
}

/** Resizes the panel, clamped and remembered. */
export function setToolPanelWidth(width: number): void {
  const next = clampToolPanelWidth(width);
  if (toolPanelStore.getSnapshot().width === next) return;
  toolPanelStore.update((state) => ({ ...state, width: next }));
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
  } catch {
    // A private window may refuse to store it; the width still applies here.
  }
}
