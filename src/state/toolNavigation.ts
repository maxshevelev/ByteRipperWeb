import type { PaneId } from "@/state/workspaceStore";

/**
 * What the navigation history keeps of a tool's panel (§10.6): the row it had chosen, so Back
 * chooses it again, zones and all.
 *
 * Upstream's `ToolSession` answers `navigationMark` and takes `showNavigationMark` and
 * `focusChoice`; a React panel cannot be asked, so the session hands the window the same three
 * as a handle while it is open (`registerToolNavigation`), and the window asks it from here.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.navigationMark
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.showNavigationMark
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.focusChoice
 * @upstream-differs a handle registered for the session's life, where upstream calls the session
 */
export interface ToolNavigationHandle {
  /** The row in focus, as the tool keeps it; nothing when none is. */
  readonly mark: () => unknown;
  /**
   * Back or Forward came to where `mark` was in focus: the row is chosen again with its zones,
   * without taking the dump anywhere.
   */
  readonly show: (mark: unknown) => void;
  /** The table takes the keyboard, so the arrow keys go on from the row. */
  readonly focus: () => void;
}

/** A tool's choice: which tool, and what it had chosen. */
export interface ToolChoice {
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.ToolChoice.module */
  readonly module: string;
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.ToolChoice.mark */
  readonly mark: unknown;
}

/** The sessions that are open, by the pane each reads. */
const open = new Map<PaneId, { readonly module: string; readonly handle: ToolNavigationHandle }>();

/**
 * What the panel had chosen when no session is reading the pane any more — the last session's
 * choice, or the one Back or Forward came to since — so a place the history records while the
 * tool is closed still knows the row to choose when the tool is open again.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.ClosedChoice
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.closedChoice
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.ClosedChoice.pane
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.ClosedChoice.module
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.ClosedChoice.mark
 */
let closed: (ToolChoice & { readonly pane: PaneId }) | undefined;

/**
 * A session reading `pane` is open: it says what it has chosen, and how to choose it again.
 * Returns what ends it, which keeps the choice for when the tool is next open.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.endSession
 */
export function registerToolNavigation(
  pane: PaneId,
  module: string,
  handle: ToolNavigationHandle
): () => void {
  const entry = { module, handle };
  open.set(pane, entry);
  closed = undefined;
  return () => {
    if (open.get(pane) !== entry) return;
    open.delete(pane);
    const mark = handle.mark();
    closed = mark === undefined ? undefined : { module, pane, mark };
  };
}

/**
 * The tool's choice in `pane` as the history records it: the open session's, or the closed
 * one's.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.navigationPlace
 */
export function toolChoiceOf(pane: PaneId): ToolChoice | undefined {
  const session = open.get(pane);
  if (session !== undefined) {
    const mark = session.handle.mark();
    return mark === undefined ? undefined : { module: session.module, mark };
  }
  return closed !== undefined && closed.pane === pane
    ? { module: closed.module, mark: closed.mark }
    : undefined;
}

/**
 * Chooses `choice` again in `pane` when the same tool is still open on it, and says so. With no
 * tool to choose it in the choice is carried, so the place Back or Forward leaves next still
 * has it. A place whose tool is no longer the one open on the pane gives back the dump alone.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.go
 */
export function showToolChoice(pane: PaneId, choice: ToolChoice | undefined): boolean {
  const session = open.get(pane);
  if (choice !== undefined && session !== undefined && session.module === choice.module) {
    session.handle.show(choice.mark);
    return true;
  }
  if (session === undefined) {
    closed = choice === undefined ? undefined : { ...choice, pane };
  }
  return false;
}

/**
 * The table the choice is in takes the keyboard.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.focusChoice
 */
export function focusToolChoice(pane: PaneId): void {
  open.get(pane)?.handle.focus();
}

/** For a test: nothing is open and nothing is kept. */
export function resetToolNavigation(): void {
  open.clear();
  closed = undefined;
}
