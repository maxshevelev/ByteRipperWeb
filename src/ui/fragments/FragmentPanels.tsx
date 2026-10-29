import type React from "react";
import { useState } from "react";
import { L } from "@/core/localization/localization";
import { agentAnnotationStore } from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { closeHelp } from "@/state/helpStore";
import { beginPartDrag } from "@/state/paneDragStore";
import { useStore } from "@/state/useStore";
import { endLocalPaneDrag } from "@/state/workspace/paneTransfer";
import {
  foldParts,
  type PaneState,
  type PartId,
  partPane,
  toggleAgentPanel,
  toggleHelpPanel,
  toggleNotesPanel,
  togglePart,
  workspaceStore,
} from "@/state/workspaceStore";
import { AgentWindow } from "@/ui/agent/AgentWindow";
import { setPaneDragImage } from "@/ui/drag/paneDragImage";
import { type DockItem, FragmentDockStrip } from "@/ui/fragments/FragmentDockStrip";
import {
  FragmentPanel,
  FragmentPanelHost,
  foldAwayOnClose,
} from "@/ui/fragments/FragmentPanelView";
import { partTransform } from "@/ui/fragments/partTransform";
import { usePartsWithChanges } from "@/ui/fragments/usePartLink";
import { HelpPanel } from "@/ui/help/HelpPanel";
import { NotesPanel } from "@/ui/notes/NotesPanel";
import { documentGlyphElement } from "@/ui/pane/DocumentIcon";

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
  onAgentSettings,
  onTearOff,
}: {
  /** The dump for a part, wired by the shell. */
  readonly renderPane: (pane: PartId, part: PaneState) => React.ReactNode;
  /** The pill's ✕: the same close the panel's own header asks for. */
  readonly onClose: (pane: PartId) => void;
  /** The Agent panel's link to Settings ▸ Agent. */
  readonly onAgentSettings: () => void;
  /** A part's panel into a window of its own: the desktop shell's (D6). */
  readonly onTearOff?: ((pane: PartId) => void) | undefined;
}) {
  const state = useStore(workspaceStore);
  const agent = useStore(agentService.store);
  const annotations = useStore(agentAnnotationStore);
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
  const [isNewPanel, setIsNewPanel] = useState(true);
  if (upNow !== seenUp) {
    setSeenUp(upNow);
    const stillThere = seenUp !== undefined && state.dock.panels.includes(seenUp);
    // New to the dock: opened just now rather than switched to.
    const isNew = upNow !== undefined && !seenPanels.includes(upNow);
    setFolded(stillThere && (upNow === undefined || isNew) ? seenUp : undefined);
    setRaisedFromNothing(seenUp === undefined || isNew);
    setIsNewPanel(isNew);
    // Closed while it was up: it folds away as it goes.
    if (seenUp !== undefined && !stillThere) foldAwayOnClose(seenUp);
  }
  if (state.dock.panels !== seenPanels) setSeenPanels(state.dock.panels);

  // Brings the pills in line with what the panels hold: names, the one that is
  // up, and which of them have bytes the parent has not got back.
  //
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.refreshDock
  // @upstream-differs the dock's row comes and goes at once, so a change asked for without animation already has none; upstream grows and shrinks it unless told not to
  const items: DockItem[] = state.dock.panels.map((id) => {
    const transform =
      id === state.helpPanel || id === state.agentPanel || id === state.notesPanel
        ? undefined
        : partTransform(state, partPane(id));
    return {
      id,
      title:
        id === state.helpPanel
          ? L("Help", { context: "panel" })
          : id === state.agentPanel
            ? L("Agent")
            : id === state.notesPanel
              ? L("Annotations")
              : (state.parts[partPane(id)]?.name ?? ""),
      kind:
        id === state.helpPanel
          ? "help"
          : id === state.agentPanel
            ? "agent"
            : id === state.notesPanel
              ? "notes"
              : "part",
      unseen: id === state.notesPanel ? annotations.unseen.size : undefined,
      connected: id === state.agentPanel && agent.connections > 0,
      isUp: state.dock.expanded === id,
      // The dot is "the parent has not got these bytes", which is the link's
      // question; a part with no link falls back to its own unsaved work, which
      // is upstream's own fallback.
      // A book has no bytes to give back, so it never wears the dot.
      hasChanges:
        id !== state.helpPanel &&
        id !== state.agentPanel &&
        id !== state.notesPanel &&
        unreturned.has(partPane(id)),
      transform: transform?.text,
      transformExplanation: transform?.explanation,
    };
  });
  if (items.length === 0) return null;

  // The one leaving stays on stage until it is gone; the one arriving waits for it.
  const folding = folded !== undefined;
  const up = folded ?? state.dock.expanded;
  const helpIsUp = up !== undefined && up === state.helpPanel;
  const agentIsUp = up !== undefined && up === state.agentPanel;
  const notesAreUp = up !== undefined && up === state.notesPanel;
  const motion = {
    pill: up,
    opensOutOfPill: raisedFromNothing && !folding,
    // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.apply
    risesFromBelow: isNewPanel,
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
  const pane: PartId | undefined =
    up === undefined || helpIsUp || agentIsUp || notesAreUp ? undefined : partPane(up);
  const part = pane === undefined ? undefined : state.parts[pane];

  return (
    <>
      {helpIsUp ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>
            <HelpPanel />
          </FragmentPanel>
        </FragmentPanelHost>
      ) : agentIsUp ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>
            <AgentWindow onSettings={onAgentSettings} />
          </FragmentPanel>
        </FragmentPanelHost>
      ) : notesAreUp ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>
            <NotesPanel />
          </FragmentPanel>
        </FragmentPanelHost>
      ) : pane !== undefined && part !== undefined ? (
        <FragmentPanelHost folding={folding}>
          <FragmentPanel {...motion}>{renderPane(pane, part)}</FragmentPanel>
        </FragmentPanelHost>
      ) : null}
      <FragmentDockStrip
        items={items}
        onSelect={(id) =>
          id === state.helpPanel
            ? toggleHelpPanel()
            : id === state.agentPanel
              ? toggleAgentPanel()
              : id === state.notesPanel
                ? toggleNotesPanel()
                : togglePart(partPane(id))
        }
        onClose={(id) =>
          id === state.helpPanel
            ? closeHelp()
            : id === state.agentPanel
              ? agentService.setWindowOpen(false)
              : onClose(partPane(id))
        }
        carry={
          onTearOff === undefined
            ? undefined
            : {
                onTearOff: (id) => onTearOff(partPane(id)),
                // The pill carries off the panel's pane exactly as its header does, in the
                // picture the header's drag wears.
                // @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginPaneDrag
                onDragStart: (id, transfer) => {
                  const pane = partPane(id);
                  const part = workspaceStore.getSnapshot().parts[pane];
                  if (part !== undefined) {
                    // A folded panel's pane is off screen, but it is a pane: a header's height,
                    // its name, and its document glyph as its own header would draw it.
                    const header = document.querySelector(".pane-header");
                    setPaneDragImage(
                      transfer,
                      part.name,
                      documentGlyphElement({
                        dirty: part.document.isDirty,
                        untitled: part.untitled === true,
                      }),
                      header?.getBoundingClientRect().height ?? 0
                    );
                  }
                  // The panel up over the panes folds as its pill is picked up: what it is
                  // carried to may be one of the panes it covers.
                  if (workspaceStore.getSnapshot().dock.expanded !== undefined) foldParts();
                  beginPartDrag(pane);
                },
                onDragEnd: endLocalPaneDrag,
              }
        }
      />
    </>
  );
}
