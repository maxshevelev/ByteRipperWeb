import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import { dragCarriesFiles } from "@/platform/files/dragDrop";
import {
  draggedPaneId,
  draggedPartId,
  draggedRemotePane,
  endDrag,
  notePaneDragCopying,
  paneDragIsCopying,
  paneDragStore,
} from "@/state/paneDragStore";
import type { PaneId } from "@/state/paneId";
import { createStore } from "@/state/store";
import { useStore } from "@/state/useStore";
import { DropTargetView } from "@/ui/drag/DropTargetView";
import { dragCarriesPane } from "@/ui/drag/dragDrop";

/**
 * The New Window strip (`Design/DESKTOP_WINDOWS.md`, D5): along the top of the panes while a pane
 * or a file is dragged, in every window of the desktop shell. A pane let go on it goes into a new
 * window of its own — moved, or copied with Option — and files open in one.
 *
 * Upstream's strip makes a tab, because the system's tab bar cannot be a drop target; the shell's
 * windows have no tabs, so it makes a window.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip
 * @upstream-differs a new window where upstream makes a new tab
 */

/**
 * How tall the strip is.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.height
 */
export const NEW_WINDOW_STRIP_HEIGHT = 44;

/** How long after a drag starts the strip comes up. */
const STRIP_DELAY_MS = 150;

/**
 * Whether the strip is up — the panes then make room for it below — and where it ends, in the
 * viewport: what the bands under it start below.
 */
export const newWindowStripStore = createStore<{
  readonly shown: boolean;
  readonly bottom: number | undefined;
}>({ shown: false, bottom: undefined });

/**
 * How much of the top of a box that starts at `top` the strip covers: what a pane's bands give up.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.topInset
 */
export function newWindowStripInset(top: number): number {
  const { bottom } = newWindowStripStore.getSnapshot();
  return bottom === undefined ? 0 : Math.max(0, bottom - top);
}

/** A pane let go on the strip: whose, and whether it is to be copied. */
export interface StripPane {
  /** The window it is in; nothing for this one. */
  readonly from: string | undefined;
  /** One of the window's two panes, or one of its fragment panels (D6). */
  readonly slot: PaneId;
  readonly copy: boolean;
}

export interface NewWindowStripProps {
  /** A pane was let go on the strip. */
  readonly onPane: (pane: StripPane) => void;
  /** Files were let go on the strip. */
  readonly onFiles: (transfer: DataTransfer) => void;
}

/**
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.setDragActive
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.setPaneDragCopying
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.onDropFiles
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.onPaneDropped
 * @upstream-differs the strip takes the drop itself, where upstream's lets every event through to
 * the window's view (`hitTest` answering nil) and is told what is over it
 */
export function NewWindowStrip({ onPane, onFiles }: NewWindowStripProps) {
  const { inFlight, copying } = useStore(paneDragStore);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Up once the drag is under way rather than as it starts. A pane's header lies under the strip,
  // and an element that comes up under the pointer in the very turn the drag starts in makes
  // Chromium drop the drag at once — which is how a pane's header came to carry nothing.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (inFlight === undefined) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), STRIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [inFlight]);
  const shown = inFlight !== undefined && settled;

  useLayoutEffect(() => {
    const element = ref.current;
    newWindowStripStore.update(() => ({
      shown,
      bottom: shown && element !== null ? element.getBoundingClientRect().bottom : undefined,
    }));
    if (!shown) setHovered(false);
  }, [shown]);

  if (!shown) return null;
  // @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.setTitle
  const title =
    inFlight === "file"
      ? L("Open in New Window")
      : copying
        ? L("Duplicate to New Window")
        : L("Move to New Window");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; File ▸ New Window and the pane header's Open in New Window are the keyboard's way.
    <div
      ref={ref}
      className="new-window-strip"
      style={{ height: NEW_WINDOW_STRIP_HEIGHT }}
      // @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.draggingEntered
      // @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.draggingUpdated
      onDragOver={(event) => {
        const pane = dragCarriesPane(event.dataTransfer);
        if (!pane && !dragCarriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        if (pane) notePaneDragCopying(event.altKey);
        event.dataTransfer.dropEffect = pane && !event.altKey ? "move" : "copy";
        setHovered(true);
      }}
      // @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.draggingExited
      onDragLeave={(event) => {
        const related = event.relatedTarget as Node | null;
        if (related !== null && event.currentTarget.contains(related)) return;
        setHovered(false);
      }}
      // @upstream ByteRipperApp/DragDrop/DropBands.swift#NewTabDropStrip.performDragOperation
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setHovered(false);
        const local = draggedPaneId() ?? draggedPartId();
        const remote = draggedRemotePane();
        const copy = paneDragIsCopying();
        endDrag();
        if (local !== undefined) onPane({ from: undefined, slot: local, copy });
        else if (remote !== undefined) onPane({ from: remote.from, slot: remote.slot, copy });
        else if (event.dataTransfer !== null && dragCarriesFiles(event.dataTransfer)) {
          onFiles(event.dataTransfer);
        }
      }}
    >
      <DropTargetView title={title} highlighted={hovered} />
    </div>
  );
}
