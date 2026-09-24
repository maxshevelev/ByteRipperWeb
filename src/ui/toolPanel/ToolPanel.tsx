import { useCallback, useState } from "react";
import { showNotice } from "@/state/noticeStore";
import { openLinkedPart } from "@/state/openLinkedPart";
import { beginFileDrag, draggedPaneId, endDrag, paneDragStore } from "@/state/paneDragStore";
import {
  activate,
  activeModule,
  DEFAULT_TOOL_PANEL_WIDTH,
  MAX_TOOL_PANEL_WIDTH,
  MIN_TOOL_PANEL_WIDTH,
  paneChoices,
  paneDropTitle,
  panelTakesDrops,
  selectorEnabled,
  selectPane,
  sessionOn,
  setToolPanelWidth,
  toolController,
} from "@/state/toolController";
import { showTransientMessage } from "@/state/transientMessageStore";
import { useStore } from "@/state/useStore";
import {
  isSlot,
  PANE_IDS,
  type PaneId,
  paneIn,
  type SlotId,
  type SurfaceId,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";
import type { ToolContext } from "@/tools/toolModule";
import { DropTargetView } from "@/ui/drag/DropTargetView";
import { singleFileDropTargetTitle } from "@/ui/drag/dragDrop";
import { dragCarried } from "@/ui/drag/PaneDropBands";
import { CloseButton } from "@/ui/shell/CloseButton";
import { ChevronShapes } from "@/ui/shell/chevronGlyph";
import { EdgeSplitter } from "@/ui/shell/EdgeSplitter";
import { useKeyboardInput } from "@/ui/shell/useKeyboardInput";

/**
 * The tool panel's chrome: a header naming the tool and the file its session is
 * bound to, a close button, and the tool's own view below.
 *
 * The header answers the one question the panel would otherwise leave open —
 * which file this is — and is where that file is changed. A session is bound to
 * the pane it was opened for and does not follow the active pane, so in a
 * comparison the panel and the pane being typed in can be different files, and
 * what the header names is where the tool's writes go. Choosing the other pane
 * in its selector moves the tool there; clicking into that pane does not.
 *
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView
 */
export function ToolPanel({
  surface = WORKSPACE_SURFACE,
  onReveal,
  onFilesDropped,
}: {
  /**
   * The surface this panel belongs to: the workspace's, or the part of the
   * panel it is drawn inside. Each runs its own session, so the Tools menu
   * means whatever is in front and a folded panel keeps its own choice (G50).
   */
  readonly surface?: SurfaceId;
  readonly onReveal: (pane: PaneId, start: number, end: number) => void;
  /**
   * Files were let go on the panel: they replace the file it is reading, which
   * is what its own pane's Replace Current File band does with them.
   *
   * The event is the only handle on them — a browser hands a drop its data and
   * nothing else, and empties it the moment the handler returns.
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onDropFiles
   * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.wireToolPanel
   */
  readonly onFilesDropped?: ((pane: SlotId, event: React.DragEvent) => void) | undefined;
}) {
  const workspace = useStore(workspaceStore);
  const session = sessionOn(useStore(toolController), surface);
  const { boundPane, width } = session;
  const tool = activeModule(session);
  const slot = boundPane === undefined ? undefined : paneIn(workspace, boundPane);
  const choices = paneChoices(workspace.panes);
  const switchable = selectorEnabled(choices);
  const keyboardRing = useKeyboardInput();
  const drag = useStore(paneDragStore);
  /**
   * Whether the pointer is over the panel with something in hand. The zone is
   * shown for that, not for the whole drag: upstream puts it up in
   * `draggingEntered` and takes it down on the way out, where the panes' bands
   * are up for the session's whole length.
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.dropZone
   */
  const [dragOver, setDragOver] = useState(false);

  const reveal = useCallback(
    (start: number, end: number) => {
      if (boundPane !== undefined) onReveal(boundPane, start, end);
    },
    [onReveal, boundPane]
  );

  // MARK: - Dropping on the panel

  /**
   * What the zone says it will do, or `undefined` to refuse — a panel that
   * takes no drops, and a pane the tool is already reading, both wear the
   * refusal rather than staying blank: an area that does nothing and says
   * nothing does not say why (§4.3).
   *
   * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.draggingEntered
   */
  const zoneTitle = (): string | undefined => {
    if (!panelTakesDrops(surface)) return undefined;
    if (drag.inFlight === "pane") {
      return drag.paneId === undefined ? undefined : paneDropTitle(surface, drag.paneId);
    }
    return singleFileDropTargetTitle("replace");
  };

  /** @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.draggingUpdated */
  const onDragOver = (event: React.DragEvent) => {
    const carried = dragCarried(event.dataTransfer);
    if (carried === undefined) return;
    // Ours whichever way it goes: a panel that cannot take what is carried
    // refuses it rather than letting the workspace behind it open something.
    event.stopPropagation();
    // A file entering the panel is what tells the workspace a drag is on, as it
    // is anywhere else: the panes' bands have to come up too.
    if (carried === "file") beginFileDrag();
    setDragOver(true);
    if (zoneTitle() === undefined) {
      // Cancelled even though it refuses, and `none` is what refuses it: the
      // drop never fires and nothing happens, which is the refusal upstream
      // gives. Cancelling is what tells the browser this page is handling the
      // drag at all — and the `stopPropagation` above has taken the event away
      // from the window's own handler, which was the only thing cancelling it. A
      // dragover left uncancelled here is one the browser answers by navigating
      // to the file, taking the workspace and every unsaved edit with it.
      event.preventDefault();
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = carried === "pane" ? "move" : "copy";
  };

  /** @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.draggingExited */
  const onDragLeave = (event: React.DragEvent) => {
    // Fires for every child the pointer crosses, so only a leave that takes it
    // out of the panel entirely counts.
    const related = event.relatedTarget as Node | null;
    if (related !== null && event.currentTarget.contains(related)) return;
    setDragOver(false);
  };

  /** @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.performDragOperation */
  const onDrop = (event: React.DragEvent) => {
    const carried = dragCarried(event.dataTransfer);
    if (carried === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const accepted = zoneTitle() !== undefined;
    setDragOver(false);
    if (carried === "pane") {
      const paneId = draggedPaneId();
      // Ended before the act, as upstream ends the session before routing it: a
      // refused act still has to leave the workspace with no drag in flight.
      endDrag();
      // The door a pane chosen in the header's selector uses, so a session is
      // never re-pointed underneath itself.
      // @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onDropPane
      if (accepted && paneId !== undefined) selectPane(paneId);
      return;
    }
    if (accepted && boundPane !== undefined && isSlot(boundPane)) {
      onFilesDropped?.(boundPane, event);
    }
    endDrag();
  };

  if (tool === undefined || boundPane === undefined || slot === undefined) return null;
  const context: ToolContext = {
    pane: boundPane,
    // What the session was handed as it started, from the same place the pane
    // and the width come from: it is the host that took it out of the box, and
    // the panel draws the session it belongs to.
    restored: session.restored,
    reveal,
    // What the panel just did, in the line of the pane it is about — the same
    // two seconds and the same restore the window's own messages get.
    report: (text) => showTransientMessage(boundPane, text),
    // The window's own plate, through the presenter every other notice goes
    // through, so a tool's confirmation cannot come to look like another app's.
    // @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.showNotice
    showNotice,
    // Bytes the panel hands over, opened as a part over the file they came out
    // of, with the link back to where they are in it. The panel says what they
    // are; where they open, and what the link is worth, is not its business.
    // @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.openPart
    // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPartForTool
    openPart: (bytes, name, source, layout, part) => {
      void openLinkedPart({
        parent: boundPane,
        bytes,
        name,
        source,
        layout,
        ...(part === undefined ? {} : { kind: part.kind, rebuildTarget: part.rebuild }),
      });
    },
  };

  return (
    // The whole panel is the drop region, as upstream's view is; the zone below
    // is purely visual and covers the body, so the tool's own view keeps the
    // pointer while nothing is being dragged.
    <aside
      className="tool-panel"
      aria-label="Tools"
      style={{ width }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setTitle */}
      <header className="tool-panel-head">
        <ToolsIcon />
        <span className="tool-panel-title">{tool.title}</span>
        {/* The header answers the panel's open question — which file the tool
            reads and writes — and is where that file is changed: in a
            comparison, choosing the other pane here is how the tool is moved
            to it. The name and the chevron are one control, and it goes through
            `selectPane`, the door a pane dropped on the panel would use, so a
            session is never re-pointed underneath itself.
            The control is a native `<select>` doing the job upstream's
            `NSPopUpButton` does: the option it shows *is* its selection, which
            is the rule upstream has to re-assert by hand after every title
            change, and the keyboard reaches it for free. It is stretched
            invisibly over the name and the chevron — the two are drawn by this
            side — so a tap on either opens it, which a `<select>` whose box
            ended at the text would not do, and so the focus ring is drawn
            around the whole control rather than around the words alone.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setPanes
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onSelectPane
            @upstream-differs one control whose shown option is its tick, rather than a menu whose items each carry a tick state
            @web-only the tooltip and the accessible name — "Link to file panel": upstream's popup carries neither, and a control with no visible label of its own needs one here */}
        <span
          className={`tool-panel-file${keyboardRing ? " is-keyboard" : ""}`}
          title="Link to file panel"
        >
          <span className="tool-panel-file-name">{slot.name}</span>
          <svg
            className={`menu-chevron tool-panel-file-chevron${switchable ? "" : " is-off"}`}
            width="8"
            height="5"
            viewBox="0 0 8 5"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ChevronShapes />
          </svg>
          <select
            className="tool-panel-file-select"
            aria-label="Link to file panel"
            value={boundPane}
            disabled={!switchable}
            onChange={(event) => selectPane(event.target.value as PaneId)}
          >
            {choices.map((choice, index) => {
              const pane = PANE_IDS[index];
              // One entry per pane, so neither of these can be missing: the
              // guard is here for the type checker, not for a real case.
              if (pane === undefined) return null;
              return (
                <option key={pane} value={pane} disabled={!choice.isEnabled}>
                  {choice.fileName}
                </option>
              );
            })}
          </select>
        </span>
        {/* The panel's ✕ is Tools ▸ None by another route.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onClose */}
        <CloseButton label="Close the tool panel" onClick={() => activate(undefined, surface)} />
      </header>

      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setContent */}
      <div className="tool-panel-body">
        <tool.View key={`${tool.id}:${boundPane}`} context={context} />
        {/* Over the body and only while the pointer is here with something in
            hand, inset from the panel's edges as upstream insets it.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.show */}
        {dragOver && drag.inFlight !== undefined ? (
          <div className="tool-panel-drop">
            <DropTargetView title={zoneTitle()} highlighted={zoneTitle() !== undefined} />
          </div>
        ) : null}
      </div>

      <EdgeSplitter
        edge="right"
        label="Resize the tool panel"
        width={width}
        min={MIN_TOOL_PANEL_WIDTH}
        max={MAX_TOOL_PANEL_WIDTH}
        initial={DEFAULT_TOOL_PANEL_WIDTH}
        onChange={(next) => setToolPanelWidth(surface, next)}
      />
    </aside>
  );
}

/**
 * The wrench the header carries, so the panel reads as the tools' own.
 *
 * @upstream-differs upstream's `wrench.and.screwdriver` symbol, drawn as a wrench: SF Symbols do not ship to a browser
 */
function ToolsIcon() {
  return (
    <svg className="tool-panel-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.9 11.5a1.4 1.4 0 0 0 2 2l4.8-4.8a4 4 0 0 0 5.2-3.8l-2.2 2.2-2.1-.6-.6-2.1z" />
    </svg>
  );
}
