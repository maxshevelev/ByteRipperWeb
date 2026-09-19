/**
 * The dock of fragment panels a workspace has taken out of its files: which
 * panels exist, in what order they sit along the bottom, and which one of them
 * is up (upstream's `Design/FRAGMENT_PANELS_PLAN.md`).
 *
 * Pure, and deliberately ignorant. It holds identity and order and nothing else
 * — no document, no pane, not even a title, because a title copied in here is
 * one that goes stale the moment a Save As renames the document it was copied
 * from. What a panel *is* lives in the state kept against its id; what the pill
 * reads is asked of that when it is drawn.
 *
 * **At most one panel is up.** That is the one invariant, and every function
 * below preserves it rather than leaving it to the caller to maintain.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock
 * @upstream-differs a value with functions over it rather than a mutating
 * struct: the stores here hold immutable snapshots, so each mutation hands back
 * the dock that follows it beside the transition it caused
 */

/**
 * A panel's identity. The dock makes them and hands them out; nothing is read
 * off one, and two panels opened on the same part of the same file are still
 * two panels — the dock does not deduplicate, because opening a zone twice has
 * always made two documents and this is not the place to change that.
 *
 * Branded so that only `openPanel` can make one: upstream's is a struct around
 * a `UUID` whose initialiser is private to its file, which is the same promise
 * in the other language.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.PanelID
 */
export type PanelId = number & { readonly isPanelId: unique symbol };

/** The counter behind them, so two docks in one workspace never share an id. */
let nextPanelId = 1;

/**
 * What a mutation did, in the terms an animation would be written in: one panel
 * leaves the stage, another takes it, and because at most one can be up those
 * two are nearly always the same gesture rather than two that happen to
 * overlap.
 *
 * Handed back rather than left for the caller to work out by diffing the dock
 * before and after — the diff is where the "fold this, then raise that, unless
 * they are the same one" mistakes live.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition
 */
export interface DockTransition {
  /**
   * The panel folding down into its pill.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition.folding
   */
  readonly folding?: PanelId | undefined;
  /**
   * The panel rising from its pill.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition.raising
   */
  readonly raising?: PanelId | undefined;
  /**
   * The panel the dock no longer holds. What was kept against it is dropped
   * once the fold has finished, which is why this can arrive together with
   * `folding` naming the same panel.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition.removed
   */
  readonly removed?: PanelId | undefined;
}

/**
 * Nothing moved.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition.none
 */
export const NO_TRANSITION: DockTransition = {};

/**
 * Whether a transition is that one.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.Transition.isEmpty
 */
export const movedNothing = (transition: DockTransition): boolean =>
  transition.folding === undefined &&
  transition.raising === undefined &&
  transition.removed === undefined;

export interface FragmentDock {
  /**
   * The panels, in the order they were opened, which is the order the pills sit
   * in. Nothing reorders them: a dock that shuffles under the pointer is a dock
   * you have to read every time instead of remembering.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.panels
   */
  readonly panels: readonly PanelId[];
  /**
   * The panel that is up, or nothing when the stage is clear and the
   * workspace's own panes are in full view.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.expanded
   */
  readonly expanded: PanelId | undefined;
}

/** A dock with nothing in it. */
export const EMPTY_DOCK: FragmentDock = { panels: [], expanded: undefined };

/** @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.isEmpty */
export const dockIsEmpty = (dock: FragmentDock): boolean => dock.panels.length === 0;

/** @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.count */
export const dockCount = (dock: FragmentDock): number => dock.panels.length;

/** @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.contains */
export const dockHolds = (dock: FragmentDock, id: PanelId): boolean => dock.panels.includes(id);

/** What a mutation leaves behind: the dock that follows, and what moved. */
export interface DockChange {
  readonly dock: FragmentDock;
  readonly transition: DockTransition;
}

/**
 * Opens a panel at the end of the dock and raises it, folding whatever was up.
 *
 * Raising it is not a choice the caller gets: a part you asked to open and that
 * appears only as a pill is a part you cannot see, and every route into this —
 * a zone, a decompressed body, a tool-module handing bytes over — is someone
 * asking to look at something.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.open
 */
export function openPanel(dock: FragmentDock): DockChange & { readonly id: PanelId } {
  const id = nextPanelId++ as PanelId;
  const folding = dock.expanded;
  return {
    id,
    dock: { panels: [...dock.panels, id], expanded: id },
    transition: folding === undefined ? { raising: id } : { folding, raising: id },
  };
}

/**
 * Raises `id`, folding whatever was up. A panel the dock does not hold, or the
 * one already up, moves nothing.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.expand
 */
export function expandPanel(dock: FragmentDock, id: PanelId): DockChange {
  if (!dock.panels.includes(id) || dock.expanded === id) {
    return { dock, transition: NO_TRANSITION };
  }
  const folding = dock.expanded;
  return {
    dock: { ...dock, expanded: id },
    transition: folding === undefined ? { raising: id } : { folding, raising: id },
  };
}

/**
 * Folds the panel that is up, leaving the stage clear. Nothing takes its place
 * — Esc means "let me see the dump", not "show me the next part".
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.collapse
 */
export function collapsePanels(dock: FragmentDock): DockChange {
  const up = dock.expanded;
  if (up === undefined) return { dock, transition: NO_TRANSITION };
  return { dock: { ...dock, expanded: undefined }, transition: { folding: up } };
}

/**
 * Takes `id` out of the dock.
 *
 * One function for both ways a panel leaves — closed, or handed over — because
 * the dock cannot tell them apart and has no reason to: either way the pill
 * goes, and either way what was kept behind it is somebody else's to dispose
 * of.
 *
 * If it was up, the stage is left clear rather than handed to a neighbour. What
 * the panel was covering is the file it came out of, and the moment you are
 * most likely to close a fragment is just after putting its bytes back —
 * raising the next pill would hide the very change you were about to look at.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDock.swift#FragmentDock.remove
 */
export function removePanel(dock: FragmentDock, id: PanelId): DockChange {
  if (!dock.panels.includes(id)) return { dock, transition: NO_TRANSITION };
  const panels = dock.panels.filter((one) => one !== id);
  if (dock.expanded !== id) return { dock: { ...dock, panels }, transition: { removed: id } };
  return { dock: { panels, expanded: undefined }, transition: { folding: id, removed: id } };
}
