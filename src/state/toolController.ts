import { closeFirmware } from "@/state/firmwareStore";
import {
  discardParkedStateFor,
  forgetSessionParkedState,
  parkToolState,
  type ToolSessionState,
  takeParkedToolState,
  takeSessionParkedState,
} from "@/state/parkedToolState";
import { createStore } from "@/state/store";
import {
  PANE_IDS,
  type PaneId,
  type PaneState,
  paneState,
  type SlotId,
  workspaceStore,
} from "@/state/workspaceStore";
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
  /**
   * What the session was handed as it started: whatever the last session of the
   * same tool left behind for this file, or nothing.
   *
   * Opaque — the host stores it and hands it on, and the tool is the only side
   * that knows what it holds. It is read once, where the panel seeds the state
   * it is about to draw with, and it belongs to the session: a session that
   * ends replaces it with what the next one is handed.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.restore
   */
  readonly restored: ToolSessionState | undefined;
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
  restored: undefined,
  width: storedWidth(),
});

/**
 * A zone the user picked in the dump or on the minimap's gutter, on its way to
 * the open panel.
 *
 * The request is a value with a fresh identity per pick, so a zone picked twice
 * is handed back twice, and cleared when the session ends so a panel that
 * mounts later cannot act on one that was aimed at a session that has gone.
 */
export interface ZoneSelectionRequest {
  /** The pane whose map the zone came out of; only the bound one is ever asked. */
  readonly pane: PaneId;
  /** The zone's id, as the tool published it. */
  readonly zoneId: string;
}

export const zoneSelectionStore = createStore<{ request: ZoneSelectionRequest | undefined }>({
  request: undefined,
});

/**
 * The user picked a zone in the dump. The bytes are the host's to select; this
 * is the other half — telling the tool, which is the only side that knows what
 * the zone stands for.
 *
 * Only for the pane the session is bound to: a zone map belongs to one pane,
 * and a right-click in the other one is about somebody else's bytes.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.zoneSelected
 * @upstream-differs upstream calls the session; a React panel cannot be called, so the request is left in a store the mounted panel reads
 * @web-only the panel is a component rather than an object with a lifetime, so a request is the only way to reach it from the shell
 */
export function zoneSelected(pane: PaneId, zoneId: string): void {
  const { activeIdentifier, boundPane } = toolController.getSnapshot();
  if (activeIdentifier === undefined || boundPane === undefined || pane !== boundPane) return;
  // A new object each time: picking the same zone again is a second request,
  // and an identity-compared store would otherwise swallow it.
  zoneSelectionStore.update(() => ({ request: { pane, zoneId } }));
}

/**
 * The request a panel has still to act on, cleared as it is read.
 *
 * Read from an effect, so clearing it is what keeps the act from happening
 * twice: the store notifies on the read as well as on the write, and a request
 * left standing would be handled again by any later render.
 */
export function takeZoneSelection(): ZoneSelectionRequest | undefined {
  const { request } = zoneSelectionStore.getSnapshot();
  if (request !== undefined) zoneSelectionStore.update(() => ({ request: undefined }));
  return request;
}

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
  // Consumed rather than copied: from here the session owns it, and what comes
  // back next time is whatever this session decides to leave.
  const restored =
    resolved === undefined || pane === undefined ? undefined : takeParkedToolState(resolved, pane);
  // Nothing was said about it yet, so nothing standing from an earlier session
  // can be mistaken for this one's answer.
  forgetSessionParkedState();
  toolController.update((current) => ({
    ...current,
    activeIdentifier: pane === undefined ? undefined : resolved,
    boundPane: pane,
    restored,
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
 * The session's own state is parked here, against the pane it was bound to, and
 * before the panel that holds it unmounts — the moment upstream reads
 * `parkedState`. A file that is closing parks nothing, not by a check here but
 * because the close drops it again a moment later, which is one rule instead of
 * two saying the same thing.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.endSession
 */
function endSession(boundPane: PaneId | undefined): void {
  // The identifier the session is *running* under, which is the one that is
  // about to end: this is called before the choice is assigned below.
  //
  // @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.runningIdentifier
  // @upstream-differs upstream holds it in a field because its `activate` assigns
  // the new choice first and ends the old session after; here the assignment is
  // the last thing `activate` does, so the store's current value is the running one.
  const running = toolController.getSnapshot().activeIdentifier;
  if (running !== undefined && boundPane !== undefined) {
    const handing = takeSessionParkedState(boundPane);
    if (handing !== undefined) parkToolState(running, boundPane, handing);
  }
  // A request aimed at the session that is ending is nothing the next one
  // should act on: the panel it was for is about to unmount, and a panel that
  // mounts in its place has not been handed anything.
  zoneSelectionStore.update((current) =>
    current.request === undefined ? current : { request: undefined }
  );
  if (boundPane !== undefined) clearZones(boundPane);
}

/**
 * The bound file was closed: there is nothing left for the tool to work on, so
 * the session ends and the panel closes. Called before the pane forgets which
 * file it held.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneClosed
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.paneLeft
 */
export function paneClosed(pane: PaneId): void {
  // The session ends first — parking what it hands back — and the parked state
  // goes after, so what the stopping session just left is dropped with the rest.
  if (toolController.getSnapshot().boundPane === pane) activate(undefined);
  discardParkedStateFor(pane);
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
 * Moves the running tool-module onto `pane` — what choosing that pane in the
 * header's selector means.
 *
 * The session is never re-pointed underneath itself: the old one ends — its
 * zones going with it, since nothing else draws them — and a new one starts on
 * the chosen pane, which on this side of the port is the tool's view re-mounting
 * on its new binding. A closed pane is not somewhere the tool can go, and
 * neither is the pane it already reads: a change that changes nothing is a
 * gesture that looks broken.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.selectPane
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.rebind
 * @upstream-differs one function rather than two: upstream's `rebind` is the door a choice and a drop share, and a browser has no pane dragging, so choosing is the only way in
 * @web-only the parsed tree the session was reading is dropped with it: it is the largest thing this application holds, and no tool shows that pane any more — as with `activate`.
 */
export function selectPane(pane: PaneId): void {
  const { activeIdentifier, boundPane } = toolController.getSnapshot();
  if (activeIdentifier === undefined || boundPane === undefined || boundPane === pane) return;
  if (paneState(pane) === undefined) return;

  endSession(boundPane);
  closeFirmware(boundPane);
  // What this tool left on its own file is a state about a file it is no longer
  // reading, so it is taken and refused rather than left standing — and what
  // the new pane held for this tool, if anything, is this session's.
  const restored = takeParkedToolState(activeIdentifier, pane);
  forgetSessionParkedState();
  toolController.update((current) => ({ ...current, boundPane: pane, restored }));
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
 * One entry of the header's file selector: a pane, the file it holds, whether
 * the session is reading that file, and whether it is somewhere the session can
 * be moved to.
 *
 * The pane an entry stands for is its position, as it is upstream: the selector
 * offers the two panes in pane order and nothing else, so an entry needs no name
 * of its own.
 *
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.PaneChoice
 */
export interface PaneChoice {
  /**
   * The name the entry shows — the file's, or "No file" for a pane that holds
   * none. A closed pane keeps its entry rather than losing it, so a position
   * always means the same pane.
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.PaneChoice.fileName
   */
  readonly fileName: string;
  /**
   * Whether the session is bound to this pane — which is the tick, and so also
   * the name the closed selector shows.
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.PaneChoice.isBound
   */
  readonly isBound: boolean;
  /**
   * Whether the tool may be moved here.
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.PaneChoice.isEnabled
   */
  readonly isEnabled: boolean;
}

/**
 * What the header's selector offers: one entry per pane, in pane order, naming
 * the file that pane holds.
 *
 * The tick is on the pane the session is *bound* to, not the active one: the
 * header names the file the tool reads and writes, and clicking into the other
 * pane does not take the session there.
 *
 * Upstream reads this whenever either half can have moved — a file opened,
 * closed or renamed, the session started, ended or re-bound. Here it is read
 * where it is drawn, which is the whole of that list: the component re-renders
 * on every one of those, so there is nothing to keep in step.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.refreshPanelHeader
 */
export function paneChoices(
  panes: Readonly<Record<SlotId, PaneState | undefined>>
): readonly PaneChoice[] {
  const { boundPane } = toolController.getSnapshot();
  return PANE_IDS.map((pane) => ({
    fileName: panes[pane]?.name ?? "No file",
    isBound: boundPane === pane,
    isEnabled: panes[pane] !== undefined,
  }));
}

/**
 * Whether the selector is worth opening at all: with one file open there is
 * nowhere to move the tool, and a control that can do nothing is worse than a
 * name. The ✕ beside it stays live either way.
 *
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setSelectorEnabled
 */
export const selectorEnabled = (choices: readonly PaneChoice[]): boolean =>
  choices.filter((choice) => choice.isEnabled).length > 1;

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
