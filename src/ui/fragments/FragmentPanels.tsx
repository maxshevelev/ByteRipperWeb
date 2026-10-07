import type React from "react";
import { useState } from "react";
import { L } from "@/core/localization/localization";
import { closeHelp } from "@/state/helpStore";
import { useStore } from "@/state/useStore";
import {
  foldParts,
  type PaneState,
  type PartId,
  partPane,
  toggleHelpPanel,
  togglePart,
  workspaceStore,
} from "@/state/workspaceStore";
import { type DockItem, FragmentDockStrip } from "@/ui/fragments/FragmentDockStrip";
import {
  FragmentPanel,
  FragmentPanelHost,
  foldAwayOnClose,
} from "@/ui/fragments/FragmentPanelView";
import { usePartsWithChanges } from "@/ui/fragments/usePartLink";
import { HelpPanel } from "@/ui/help/HelpPanel";

/**
 * The workspace's panels: the dock of pills, and the one panel that is up over
 * the panes (`Design/GAPS.md` G48).
 *
 * Nearly all of them are fragments — parts taken out of a file — and one of
 * them may be the help book, which holds no bytes and is drawn by its own
 * component (`Design/HELP.md`). The dock itself knows the difference only well
 * enough to draw the right pill: what a panel *is* has always been the state
 * kept against its id, and the book is a second kind of that state.
 *
 * It is a fragment of two grid items rather than one box, because the two
 * belong in different rows of the shell: the panel lies over the panes, the
 * dock takes a row of its own under them.
 *
 * The dump inside the panel is not built here. The shell builds it, with the
 * same wiring it gives its own panes — the two context menus, the search
 * results, the reveal, the saves — because that wiring is the shell's to give
 * and a panel that assembled its own would be a second, quieter pane
 * (`wireFragmentPaneView`). What is here is what the panel *is*: which part is
 * up, and the pills of the ones that are not.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.wireFragmentPaneView
 */
// help: shell.fragments
export function FragmentPanels({
  renderPane,
  onClose,
}: {
  /** The dump for a part, wired by the shell. */
  readonly renderPane: (pane: PartId, part: PaneState) => React.ReactNode;
  /** The pill's ✕: the same close the panel's own header asks for. */
  readonly onClose: (pane: PartId) => void;
}) {
  const state = useStore(workspaceStore);
  // The pill's dot is about bytes, which the workspace store does not change
  // for — the hook reads them again on every edit anywhere.
  const unreturned = usePartsWithChanges(state.dock.panels.map((id) => partPane(id)));

  // What is up, and what has just been folded away and is still folding into its pill. The
  // motion is upstream's: a panel brought up from nothing grows out of its pill, one folded to
  // nothing flies back into it, and one switched to from another in the dock just arrives —
  // the reader asked to look at the other panel, not to watch this one leave. A panel that
  // is *new* is different: it still grows out of its pill, and the one it replaces finishes
  // folding first, or the two flights read as one muddle. A panel that was closed folds into
  // where its pill was, drawn from what was on screen, since its state is already gone
  // (`foldAwayOnClose`).
  // Derived while rendering rather than in an effect, so that the panel that is folding is
  // never taken away and put back.
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.apply
  // @upstream-differs a transition is applied by rendering: the state says which panel is up and React puts it there
  const upNow = state.dock.expanded;
  const [seenUp, setSeenUp] = useState(upNow);
  const [seenPanels, setSeenPanels] = useState(state.dock.panels);
  const [folded, setFolded] = useState<typeof upNow>(undefined);
  const [raisedFromNothing, setRaisedFromNothing] = useState(true);
  if (upNow !== seenUp) {
    setSeenUp(upNow);
    const stillThere = seenUp !== undefined && state.dock.panels.includes(seenUp);
    // New to the dock: opened just now rather than switched to.
    const isNew = upNow !== undefined && !seenPanels.includes(upNow);
    setFolded(stillThere && (upNow === undefined || isNew) ? seenUp : undefined);
    setRaisedFromNothing(seenUp === undefined || isNew);
    // Closed while it was up: it folds away as it goes.
    if (seenUp !== undefined && !stillThere) foldAwayOnClose(seenUp);
  }
  if (state.dock.panels !== seenPanels) setSeenPanels(state.dock.panels);

  // Brings the pills in line with what the panels hold: names, the one that is
  // up, and which of them have bytes the parent has not got back.
  //
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.refreshDock
  const items: DockItem[] = state.dock.panels.map((id) => ({
    id,
    title:
      id === state.helpPanel
        ? L("Help", { context: "panel" })
        : (state.parts[partPane(id)]?.name ?? ""),
    isHelp: id === state.helpPanel,
    isUp: state.dock.expanded === id,
    // The dot is "the parent has not got these bytes", which is the link's
    // question; a part with no link falls back to its own unsaved work, which
    // is upstream's own fallback.
    // A book has no bytes to give back, so it never wears the dot.
    hasChanges: id !== state.helpPanel && unreturned.has(partPane(id)),
  }));
  if (items.length === 0) return null;

  // The one leaving stays on stage until it is gone; the one arriving waits for it.
  const folding = folded !== undefined;
  const up = folded ?? state.dock.expanded;
  const helpIsUp = up !== undefined && up === state.helpPanel;
  const motion = {
    pill: up,
    opensOutOfPill: raisedFromNothing && !folding,
    folding,
    onFolded: () => setFolded(undefined),
    // The pull carried on: the dock folds — not a toggle, which would raise a panel the
    // keyboard folded while the hand still held it. Only the panel that is still up.
    // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.finishPullDown
    onCollapse: () => {
      if (up === undefined || workspaceStore.getSnapshot().dock.expanded !== up) return false;
      foldParts();
      return true;
    },
  };
  const pane: PartId | undefined = up === undefined || helpIsUp ? undefined : partPane(up);
  const part = pane === undefined ? undefined : state.parts[pane];

  return (
    <>
      {helpIsUp ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>
            <HelpPanel />
          </FragmentPanel>
        </FragmentPanelHost>
      ) : pane !== undefined && part !== undefined ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>{renderPane(pane, part)}</FragmentPanel>
        </FragmentPanelHost>
      ) : null}
      <FragmentDockStrip
        items={items}
        onSelect={(id) => (id === state.helpPanel ? toggleHelpPanel() : togglePart(partPane(id)))}
        onClose={(id) => (id === state.helpPanel ? closeHelp() : onClose(partPane(id)))}
      />
    </>
  );
}
