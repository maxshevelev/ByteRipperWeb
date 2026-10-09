import type { BinaryDocument } from "@/core/document/binaryDocument";
import { BYTES_PER_ROW } from "@/core/document/rowWidth";
import { selection as makeSelection } from "@/core/document/selectionModel";
import { NavigationHistory } from "@/core/navigation/navigationHistory";
import { createStore } from "@/state/store";
import {
  focusToolChoice,
  showToolChoice,
  type ToolChoice,
  toolChoiceOf,
} from "@/state/toolNavigation";
import {
  foldParts,
  isSlot,
  type PaneId,
  paneInFront,
  paneState,
  raisePart,
  type SlotId,
  setActivePane,
  workspaceStore,
} from "@/state/workspaceStore";
import { scrollLink } from "@/ui/pane/scrollLink";

/**
 * The navigation history of the tab: Back and Forward through the places its jumps have left
 * (§10.6), the way a browser's do.
 *
 * A jump — Go To, a difference, a search result, a click on the minimap — calls `recordJump`
 * before it moves; Back and Forward walk the two stacks and put the place back. What counts
 * as a jump is decided by the callers, not here: the arrow keys and the mouse in the dump
 * record nothing, and a history that filled up a row at a time would be one nobody could use.
 *
 * The history is the tab's (`WindowViewModel`), not a pane's: one per workspace, which a
 * browser tab already is (D11).
 */

/**
 * The selection in one pane a jump moved. A pane is named with the document it held: a pane
 * outlives the file in it, and a place in a file since closed, or replaced by another one, is
 * not a place to go back to.
 *
 * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.Spot
 * @upstream-differs the pane's id and its document, where upstream holds the pane weakly
 * and names its document by identity
 */
export interface NavigationSpot {
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.Spot.pane */
  readonly pane: PaneId;
  readonly document: BinaryDocument;
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.Spot.start */
  readonly start: number;
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.Spot.end */
  readonly end: number;
}

/**
 * A place in the navigation history (§10.6): the selection in each pane a jump moved, the
 * first byte on screen in the pane it was made in, and the row the tool panel had chosen.
 *
 * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace
 */
export interface NavigationPlace {
  /**
   * The pane the jump was made in first; in a comparison, the other one after it.
   *
   * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.spots
   */
  readonly spots: readonly NavigationSpot[];
  /** @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.top */
  readonly top: number;
  /**
   * What the tool reading the pane had chosen — a row, a node — so Back chooses it again, zones
   * and all.
   *
   * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.tool
   * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.ToolChoice
   */
  readonly tool?: ToolChoice | undefined;
  /**
   * A step of the tool's table: the place was come to, or left, by a click on a row. Going back
   * to it gives the keyboard to that table rather than to the dump. Not part of what makes two
   * places the same: how a place was reached does not make another place of it.
   *
   * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace.isToolStep
   */
  readonly isToolStep?: boolean | undefined;
}

/** Two choices of a tool are the same when they name one tool and one mark. */
const sameChoice = (left: ToolChoice | undefined, right: ToolChoice | undefined): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.module === right.module && JSON.stringify(left.mark) === JSON.stringify(right.mark);

/**
 * Whether two places are the same one: the same panes, in the same documents, selecting the
 * same bytes, from the same first row.
 *
 * @upstream ByteRipperApp/Navigation/NavigationPlace.swift#NavigationPlace
 */
export const samePlace = (left: NavigationPlace, right: NavigationPlace): boolean =>
  left.top === right.top &&
  sameChoice(left.tool, right.tool) &&
  left.spots.length === right.spots.length &&
  left.spots.every((spot, index) => {
    const other = right.spots[index];
    return (
      other !== undefined &&
      spot.pane === other.pane &&
      spot.document === other.document &&
      spot.start === other.start &&
      spot.end === other.end
    );
  });

/** @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.navigationHistory */
export const navigationHistory = new NavigationHistory<NavigationPlace>(samePlace);

/**
 * True while Back or Forward is putting a place back: what that moves is not a step of its
 * own.
 *
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.isWalkingHistory
 */
let walking = false;
export const isWalkingHistory = (): boolean => walking;

/**
 * The place the reader stands on was come to by a click on a row of a tool's table. The next
 * place recorded is marked as a step of that table too.
 *
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.arrivedByToolStep
 */
let arrivedByToolStep = false;

/** @web-only the window never starts over in a tab; the tests do, with the history emptied. */
export const forgetToolArrival = (): void => {
  arrivedByToolStep = false;
};

/**
 * Ticks whenever the history or the place the reader stands on changes, for what draws Back
 * and Forward greyed or not.
 *
 * @web-only upstream revalidates the toolbar; a component here subscribes
 */
export const navigationStore = createStore<{ readonly version: number }>({ version: 0 });
const changed = (): void => navigationStore.update((state) => ({ version: state.version + 1 }));

/**
 * Where `pane` stands: its selection and the first byte on screen — and, in a comparison, the
 * other pane's selection too, since a jump moves both.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.navigationPlace
 */
export function navigationPlaceOf(pane: PaneId): NavigationPlace {
  const panes: PaneId[] = [pane];
  if (isSlot(pane)) {
    const other: SlotId = pane === "a" ? "b" : "a";
    if (paneState(pane) !== undefined && paneState(other) !== undefined) panes.push(other);
  }
  const spots = panes.flatMap((one): NavigationSpot[] => {
    const document = paneState(one)?.document;
    if (document === undefined) return [];
    const { start, end } = document.selection;
    return [{ pane: one, document, start, end }];
  });
  const top =
    scrollLink.visibleRange(pane, BYTES_PER_ROW)?.start ?? paneState(pane)?.document.caret ?? 0;
  return { spots, top, tool: toolChoiceOf(pane) };
}

/**
 * A place can be gone back to while every pane it names is still in this tab and still holds
 * the document it was in.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.isReachable
 */
export const isReachable = (place: NavigationPlace): boolean =>
  place.spots.length > 0 &&
  place.spots.every((spot) => paneState(spot.pane)?.document === spot.document);

/** The first byte on screen while the caret last was, per pane; absent while it is off screen. */
const topWithCaretOnScreen = new Map<PaneId, number>();

/**
 * A step was just recorded for what is moving the view now — a click on a minimap, a tool's
 * row whose zone is being shown: the caret leaving the screen on its way is that step, not
 * another one. The caret is watched again once it is seen on screen.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.forgetCaretOnScreen
 */
export function forgetCaretOnScreen(pane: PaneId): void {
  topWithCaretOnScreen.delete(pane);
}

/**
 * A jump is about to move `pane`: the place it leaves goes into the history. Called by every
 * jump the app makes on the user's behalf — and by nothing the caret does a row at a time.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.recordJump
 */
export function recordJump(
  pane: PaneId,
  options: { readonly top?: number; readonly byTool?: boolean } = {}
): void {
  if (paneState(pane) === undefined || walking) return;
  const byTool = options.byTool === true;
  const place = navigationPlaceOf(pane);
  navigationHistory.record({
    ...place,
    ...(options.top === undefined ? {} : { top: options.top }),
    isToolStep: byTool || arrivedByToolStep,
  });
  arrivedByToolStep = byTool;
  forgetCaretOnScreen(pane);
  changed();
}

/**
 * A tool is about to choose a row on the reader's behalf — a click on a row, a search match, a
 * Go To from a row: the place it leaves is a step of the tool's table, taken before the choice
 * changes (`ToolHost.noteNavigationStep`).
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.noteNavigationStep
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.noteNavigationStep
 */
export const noteToolStep = (pane: PaneId): void => recordJump(pane, { byTool: true });

/**
 * The pane the commands mean: the one in front, a panel's or the workspace's active one.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activePane
 */
const frontPaneId = (): PaneId => paneInFront();

/**
 * Whether Back has somewhere to go from where the reader stands.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.canNavigateBack
 */
export function canNavigateBack(): boolean {
  const pane = frontPaneId();
  return (
    paneState(pane) !== undefined &&
    navigationHistory.canGoBack(navigationPlaceOf(pane), isReachable)
  );
}

/** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.canNavigateForward */
export function canNavigateForward(): boolean {
  const pane = frontPaneId();
  return (
    paneState(pane) !== undefined &&
    navigationHistory.canGoForward(navigationPlaceOf(pane), isReachable)
  );
}

/** Where the reader stands, with how it was come to. */
const currentPlace = (): NavigationPlace => ({
  ...navigationPlaceOf(frontPaneId()),
  isToolStep: arrivedByToolStep,
});

/**
 * View ▸ Back: the place the last jump left.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.navigateBack
 */
export function navigateBack(): void {
  const place = navigationHistory.goBack(currentPlace(), isReachable);
  if (place !== undefined) go(place);
}

/**
 * View ▸ Forward: the place Back left.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.navigateForward
 */
export function navigateForward(): void {
  const place = navigationHistory.goForward(currentPlace(), isReachable);
  if (place !== undefined) go(place);
}

/**
 * Puts the tab back on `place`: the panel it was in brought to the front — or put away, for a
 * place in the tab's own panes — the selections as they were and the view scrolled where it
 * was.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.go
 */
function go(place: NavigationPlace): void {
  const first = place.spots[0]?.pane;
  if (first === undefined) return;
  // What putting the place back moves is not a step of its own.
  walking = true;
  try {
    if (isSlot(first)) {
      if (workspaceStore.getSnapshot().dock.expanded !== undefined) foldParts();
      if (workspaceStore.getSnapshot().activePane !== first) setActivePane(first);
    } else {
      raisePart(first);
    }
    // The tool's choice first: choosing it publishes its zones, and the host may scroll to them —
    // which the place's own view then replaces. A place whose tool is no longer the one open on
    // the pane gives back the dump alone.
    const choiceShown = showToolChoice(first, place.tool);
    for (const spot of place.spots) {
      const document = paneState(spot.pane)?.document;
      document?.setSelection(makeSelection(spot.start, spot.end, document.size));
    }
    scrollLink.scrollToOffset(first, place.top, BYTES_PER_ROW);
    // The keyboard goes to the tool's table for a step made in it, so the arrow keys go on from
    // the row it chose; to the dump otherwise.
    arrivedByToolStep = place.isToolStep === true;
    if (choiceShown && place.isToolStep === true) focusToolChoice(first);
    else focusDump(first);
    // The caret is where the place has it; whether the view shows it is seen from here on.
    noteCaretIfOnScreen(first);
  } finally {
    walking = false;
  }
  changed();
}

/** The dump is found in the document: a pane says which one it is (`data-pane`). */
function focusDump(pane: PaneId): void {
  if (typeof document === "undefined") return;
  const dump = document.querySelector(`.hex-pane[data-pane="${pane}"] .hex-scroller`);
  if (dump instanceof HTMLElement) dump.focus();
}

/**
 * A caret moved onto the screen without the view moving — a click, an arrow key within the
 * rows shown — is seen from here on.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.noteCaretIfOnScreen
 */
export function noteCaretIfOnScreen(pane: PaneId): void {
  const range = scrollLink.visibleRange(pane, BYTES_PER_ROW);
  const slot = paneState(pane);
  if (range === undefined || slot === undefined) return;
  if (caretIsOnScreen(slot.document, range)) topWithCaretOnScreen.set(pane, range.start);
}

/** The caret past the last byte sits at the end of the visible range. */
const caretIsOnScreen = (
  document: BinaryDocument,
  range: { readonly start: number; readonly end: number }
): boolean => {
  const caret = document.caret;
  return (
    (caret >= range.start && caret < range.end) || (caret === range.end && caret === document.size)
  );
};

/**
 * The view of the pane in front has moved: if that took the caret off screen — a scroll, Page
 * Up/Down, Home/End, a tool's zone shown — the place it left, with the rows that were on
 * screen while the caret was, is a step. The view moving on while the caret stays off screen
 * is the same step, so this says it once until the caret is seen again.
 *
 * Only the pane the reader is in: the other pane of a comparison scrolls with it and would
 * record the same place twice.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.followCaretVisibility
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onCaretLeftView
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.caretLeftView
 */
export function followCaretVisibility(): void {
  if (walking) return;
  const pane = frontPaneId();
  const slot = paneState(pane);
  const range = scrollLink.visibleRange(pane, BYTES_PER_ROW);
  if (slot === undefined || range === undefined) return;
  if (caretIsOnScreen(slot.document, range)) {
    topWithCaretOnScreen.set(pane, range.start);
    return;
  }
  const top = topWithCaretOnScreen.get(pane);
  if (top === undefined) return;
  topWithCaretOnScreen.delete(pane);
  recordJump(pane, { top });
}

/** The view moves; what that owes the history is asked of the link on every scroll. */
scrollLink.onChange(followCaretVisibility);

/** An edit, or a file replaced, can unmake a place: what draws Back and Forward is told. */
workspaceStore.subscribe(changed);
