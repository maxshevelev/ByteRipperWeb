import type { PaneLayout } from "@/state/workspaceStore";

/**
 * What the toolbar carries, in what order, and when each item can act —
 * everything about it that is not drawing, so it can be checked without a DOM.
 */

/**
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.tools
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.goTo
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.find
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.segments
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.insertMode
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.wordSize
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.diffNavigation
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.previousDifference
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.nextDifference
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.filesIdentical
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.paneLayout
 * @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.toggleMinimap
 */
export type ToolbarItemId =
  | "tools"
  | "goTo"
  | "find"
  | "segments"
  | "insertMode"
  | "wordSize"
  | "diffNavigation"
  | "filesIdentical"
  | "paneLayout"
  | "toggleMinimap"
  | "space"
  | "flexibleSpace";

/**
 * Two groups, and the flexible space between them pins the right-hand one to
 * the edge. Left: Tools, on the side its panel opens from; the commands that
 * act on the dump in the active pane; the two controls that carry a state.
 * Right: the difference plaque, the pane arrangement, the minimap.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbarDefaultItemIdentifiers
 */
export const TOOLBAR_DEFAULT_ITEMS: readonly ToolbarItemId[] = [
  "tools",
  "space",
  "goTo",
  "find",
  "segments",
  "space",
  "insertMode",
  "wordSize",
  "flexibleSpace",
  "diffNavigation",
  "space",
  "paneLayout",
  "space",
  "toggleMinimap",
];

/**
 * The items on screen. The difference block is carried only in a comparison —
 * a pair of buttons that can never do anything still reads as something the
 * window offers — and there, when the files hold no differences at all, the
 * "Files are identical" badge takes its slot.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncDiffNavigationToolbarItem
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.applyDiffNavigationToolbarItem
 */
export function toolbarItems(comparison: boolean, identical: boolean): ToolbarItemId[] {
  return TOOLBAR_DEFAULT_ITEMS.flatMap((id): ToolbarItemId[] => {
    if (id !== "diffNavigation") return [id];
    if (!comparison) return [];
    return [identical ? "filesIdentical" : "diffNavigation"];
  });
}

/**
 * Whether the plaque shows the badge, given what it showed before. Only a
 * finished comparison decides it: while a rebuild runs the outcome is unknown,
 * and falling back to the arrows for the build's duration is what made the
 * plaque flicker on every edit.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showsIdenticalBadge
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateIdenticalBadgeState
 */
export function identicalBadgeAfter(
  previous: boolean,
  comparison: { readonly status: string; readonly differingBytes: number }
): boolean {
  return comparison.status === "ready" ? comparison.differingBytes === 0 : previous;
}

/**
 * What the pane-layout item offers: the arrangement a click will produce,
 * named by its icon and said in words by its tooltip.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makePaneLayoutItem
 */
export function paneLayoutOffer(layout: PaneLayout): {
  readonly next: PaneLayout;
  readonly label: string;
  readonly toolTip: string;
} {
  return layout === "sideBySide"
    ? { next: "stacked", label: "Stack Panes", toolTip: "Stack the panes" }
    : { next: "sideBySide", label: "Side-by-Side Panes", toolTip: "Place the panes side by side" };
}

export interface ToolbarContext {
  /** A file is open in the active pane. */
  readonly activeOpen: boolean;
  /** Both panes are open. */
  readonly comparison: boolean;
  /** Where difference navigation has somewhere to go from the caret. */
  readonly navigation: { readonly previousDifference: boolean; readonly nextDifference: boolean };
}

/**
 * Whether an item can act. The document commands and Tools need a dump in the
 * active pane; the arrows need a change in their direction; the arrangement
 * needs two panes; the word size and the minimap are view settings, live on an
 * empty window.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateToolbarItem
 * @upstream ByteRipperApp/App/MainWindowController.swift#ControlToolbarItem
 * @upstream ByteRipperApp/App/MainWindowController.swift#ControlToolbarItem.validate
 * @upstream-differs the insert-mode toggle needs an open pane, since the typing mode is its controller's
 */
export function toolbarItemEnabled(
  id: ToolbarItemId | "previousDifference" | "nextDifference",
  context: ToolbarContext
): boolean {
  switch (id) {
    case "tools":
    case "goTo":
    case "find":
    case "segments":
    case "insertMode":
      return context.activeOpen;
    case "previousDifference":
      return context.navigation.previousDifference;
    case "nextDifference":
      return context.navigation.nextDifference;
    case "paneLayout":
      return context.comparison;
    default:
      return true;
  }
}
