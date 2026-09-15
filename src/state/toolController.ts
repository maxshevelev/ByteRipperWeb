import { closeFirmware } from "@/state/firmwareStore";
import { createStore } from "@/state/store";
import { PANE_IDS, type PaneId, workspaceStore } from "@/state/workspaceStore";
import { clearZones } from "@/state/zoneStore";
import { toolById } from "@/tools/registry";

/**
 * The tool-module side of the workspace: which one is active, and the pane its
 * session is bound to.
 *
 * Two places choose the tool — the toolbar's picker and the ☰ menu — so the
 * choice lives here rather than inside the panel. One tool at a time; None is
 * how the panel is closed.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController
 */

/**
 * Wide enough at the minimum for a tree row to say a name, a type, an offset
 * and a size; wide enough at the maximum for the ME tool's longest facts.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.minPanelWidth
 * @upstream-differs one width for every tool and wider bounds (320–960 against 220–720), chosen when the panel moved to the left
 */
export const MIN_TOOL_PANEL_WIDTH = 320;
/** @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.maxPanelWidth */
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

export interface ToolControllerState {
  /**
   * The active tool-module's identifier, or nothing for None. An identifier
   * the registry does not answer to is never stored: it reads as None.
   *
   * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.activeIdentifier
   */
  readonly activeIdentifier: string | undefined;
  /**
   * The pane the session reads and writes. Bound when the session starts and
   * never re-pointed: clicking the other pane does not re-target a tool,
   * because what the panel's header names is where its writes go.
   *
   * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.boundPane
   */
  readonly boundPane: PaneId | undefined;
  /** The panel's width in CSS pixels. */
  readonly width: number;
}

/**
 * The active tool-module, if the registry still holds one by that name.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.activeModule
 */
export const activeModule = (state: ToolControllerState) =>
  state.activeIdentifier === undefined ? undefined : toolById(state.activeIdentifier);

export const toolController = createStore<ToolControllerState>({
  activeIdentifier: undefined,
  boundPane: undefined,
  width: storedWidth(),
});

/**
 * Whether the panel is open: exactly when a session is running.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.isPanelVisible
 */
export const isPanelVisible = (state: ToolControllerState): boolean =>
  state.activeIdentifier !== undefined && state.boundPane !== undefined;

/**
 * Makes `identifier` the active tool-module, or closes the current one when it
 * is nothing. Picking the one already active is not a toggle: the menu is a
 * radio group, and choosing the checked row means "yes, this one". The session
 * starts on the active pane, and with no file there the choice falls back to
 * None.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.activate
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateTool
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.tools
 */
export function activate(identifier: string | undefined): void {
  const resolved =
    identifier !== undefined && toolById(identifier) !== undefined ? identifier : undefined;
  const state = toolController.getSnapshot();
  if (resolved === state.activeIdentifier) return;

  endSession(state.boundPane);
  const { panes, activePane } = workspaceStore.getSnapshot();
  const pane = resolved !== undefined && panes[activePane] !== undefined ? activePane : undefined;
  toolController.update((current) => ({
    ...current,
    activeIdentifier: pane === undefined ? undefined : resolved,
    boundPane: pane,
  }));

  // @web-only The parsed tree is the largest thing this application holds; it is kept while any tool shows it and dropped with None.
  if (pane === undefined) {
    for (const one of PANE_IDS) closeFirmware(one);
  }
}

/**
 * Ends the running session, whatever ended it. The map goes with the session
 * that authored it: nothing else draws zones, so a dump left carrying them
 * would be showing a tool's reading of a file after that tool has gone.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.endSession
 */
function endSession(boundPane: PaneId | undefined): void {
  if (boundPane !== undefined) clearZones(boundPane);
}

/**
 * The bound file was closed: there is nothing left for the tool to work on, so
 * the session ends and the panel closes. Called before the pane forgets which
 * file it held.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneClosed
 */
export function paneClosed(pane: PaneId): void {
  if (toolController.getSnapshot().boundPane === pane) activate(undefined);
}

/**
 * The two files changed sides. Upstream binds the pane object, which moves with
 * its file when the panes are swapped; here the binding is a slot, so it is
 * moved by hand to keep following the same file.
 *
 * @web-only upstream's binding is an object reference, which a swap carries along by itself.
 */
export function panesSwapped(): void {
  toolController.update((state) =>
    state.boundPane === undefined
      ? state
      : { ...state, boundPane: state.boundPane === "a" ? "b" : "a" }
  );
}

/**
 * Whether the menu row for `identifier` is available, and whether it is the
 * checked one. A tool reads and writes the open file, so it needs one; None
 * stays available always, since it is how the panel is closed.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.menuState
 */
export function menuState(
  identifier: string | undefined,
  fileIsOpen: boolean
): { readonly enabled: boolean; readonly checked: boolean } {
  return {
    enabled: identifier === undefined || fileIsOpen,
    checked: identifier === toolController.getSnapshot().activeIdentifier,
  };
}

/**
 * Resizes the panel, clamped and remembered.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.persistPanelWidth
 * @upstream-differs one remembered width for every tool, not one per tool-module
 */
export function setToolPanelWidth(width: number): void {
  const next = clampToolPanelWidth(width);
  if (toolController.getSnapshot().width === next) return;
  toolController.update((state) => ({ ...state, width: next }));
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
  } catch {
    // A private window may refuse to store it; the width still applies here.
  }
}
