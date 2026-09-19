import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { dragCarriesFiles } from "@/platform/files/dragDrop";
import {
  beginFileDrag,
  draggedPaneId,
  endDrag,
  notePaneDragCopying,
  notePaneDragZone,
  paneDragIsCopying,
  paneDragStore,
} from "@/state/paneDragStore";
import { useStore } from "@/state/useStore";
import type { SlotId } from "@/state/workspaceStore";
import { DropTargetView } from "@/ui/drag/DropTargetView";
import {
  DropBandLayout,
  dragCarriesPane,
  PANE_DROP_NONE,
  type PaneDropOutcome,
  paneBandTitle,
  type SingleFileDropTarget,
  singleFileDropTargetTitle,
} from "@/ui/drag/dragDrop";

/**
 * A pane's drop overlay (§4.3, amended by §22.4): the three bands a drop on this
 * pane lands in, and the region that answers for them.
 *
 * **One overlay serves files and panes both**, as upstream's does. The three
 * bands mean the same thing either way — a file dropped on one joins, replaces
 * or appends; a pane dropped on one swaps, moves or joins — so there is one set
 * of plates, one geometry and one set of handlers, and only the captions differ.
 *
 * The plates are purely visual: the region's element (`HexPane`'s pane, or a
 * single-file workspace's container) is what receives the events, and the plates
 * never stand between it and the pointer.
 *
 * Upstream keeps its three plates as three views — `insertTarget`,
 * `replaceTarget`, `appendTarget` — and re-titles them in place.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView
 * @web-only the region's event half is `paneDropRegion` rather than the view's own `dragging*`
 * overrides, so a comparison pane and a single-file container can each spread it on the element
 * that owns the drop
 */

/**
 * What letting the pane in flight go on this band would mean, or `undefined`
 * when the caller has no answer — a file drag, or a region that does not take
 * panes at all.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.paneDropOutcome
 */
export type PaneDropOutcomeResolver = (
  band: SingleFileDropTarget,
  copying: boolean
) => PaneDropOutcome | undefined;

export interface PaneDropBandsProps {
  /** Asks what a band would do with the pane in flight. */
  readonly outcomeFor: PaneDropOutcomeResolver;
}

/** The three bands of a pane, top to bottom as they are laid out. */
const BANDS = ["insertAtStart", "replace", "appendAtEnd"] as const;

/**
 * The overlay's plates, drawn only while a drag is over the workspace and one of
 * these bands has something to offer.
 *
 * The geometry is the ported rule, measured rather than assumed: a pane can be
 * any height, and `DropBandLayout` is what decides how its two strips and its
 * middle divide it.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.layout
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.showBands
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.hideBands
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.retitleBands
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.retitleBandsForFile
 */
export function PaneDropBands({ outcomeFor }: PaneDropBandsProps) {
  const { inFlight, copying, zone } = useStore(paneDragStore);
  const ref = useRef<HTMLDivElement | null>(null);
  const height = useMeasuredHeight(ref, inFlight !== undefined);

  // Never mounted while idle: a transparent overlay still takes the pointer, and
  // up to now these bands were what the two dashed `.join-band` strips did with
  // a click over a pane.
  if (inFlight === undefined) return null;

  const layout = new DropBandLayout({ halfHeight: height });
  const strip = layout.stripHeight;
  // Top-down, as the layout rule is: the strips at either end, the middle band
  // between them, collapsing to nothing in a very short pane.
  const frames: Record<(typeof BANDS)[number], { top: number; height: number }> = {
    insertAtStart: { top: 0, height: strip },
    replace: { top: strip, height: Math.max(0, layout.bandHeight - 2 * strip) },
    appendAtEnd: { top: Math.max(0, height - strip), height: strip },
  };

  return (
    <div className="pane-drop-bands" ref={ref} aria-hidden="true">
      {BANDS.map((band) => {
        // A band is captioned from **its own** outcome, never from the one under
        // the pointer: the others would then be captioned for something they do
        // not do, and a band that will not take what is carried says so with the
        // refusal symbol rather than with an empty plate. A file always has
        // something to offer, so it gets the file words.
        const outcome =
          inFlight === "pane" ? (outcomeFor(band, copying) ?? PANE_DROP_NONE) : undefined;
        const title =
          outcome === undefined ? singleFileDropTargetTitle(band) : paneBandTitle(outcome);
        return (
          <div
            key={band}
            className="pane-drop-band"
            style={{ top: frames[band].top, height: frames[band].height }}
          >
            <DropTargetView title={title} highlighted={zone === band} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Measures the element's height, and keeps it measured while a drag is on: a
 * window resize or a layout change during the gesture moves the bands with the
 * pane rather than leaving them behind.
 *
 * Measured before the paint, so the bands appear at the pane's own height on the
 * first frame rather than for one frame at nothing.
 */
function useMeasuredHeight(ref: RefObject<HTMLElement | null>, measured: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setHeight(element.getBoundingClientRect().height);
    if (!measured) return;
    const observer = new ResizeObserver(() => setHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, measured]);
  return height;
}

/** A drag's own kind, as far as a region is concerned. */
export type DragCarried = "file" | "pane" | undefined;

/**
 * What a drag is carrying, or `undefined` when it is neither of the two this
 * workspace takes — a dragged selection of text, a link, another app's own type.
 *
 * A pane is asked first, as upstream reads it: its own private type is
 * unambiguous, while a browser widens an element drag with the element's own
 * `text/html` and `text/plain` besides.
 */
export function dragCarried(transfer: DataTransfer | null): DragCarried {
  if (dragCarriesPane(transfer)) return "pane";
  return dragCarriesFiles(transfer) ? "file" : undefined;
}

export interface PaneDropRegionOptions {
  /**
   * The element the bands divide, when it is not the region's own element: the
   * "this file" half of a single-file workspace, which the region's container is
   * larger than. Leave it out where the bands do fill the region, as a
   * comparison pane's do, and the region measures its own element.
   *
   * @web-only upstream's own view is always the box the bands divide — it reads its
   * `bounds.height` — so there is nothing to point at; here the region and the box it
   * divides can be two elements, and the ref names the second one
   */
  readonly bands?: RefObject<HTMLElement | null> | undefined;
  /** What a band would do with the pane in flight. */
  readonly outcomeFor: PaneDropOutcomeResolver;
  /**
   * The band a pointer inside the region but outside the bands means, when there
   * is one — the free half of a single-file workspace, which is one target
   * rather than three bands.
   *
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.dropTarget
   */
  readonly fallbackBand?: SingleFileDropTarget | undefined;
  /**
   * A dragged pane was let go on a band.
   *
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onPaneDropped
   */
  readonly onPaneDropped: (paneId: SlotId, band: SingleFileDropTarget, copying: boolean) => void;
  /**
   * Files were let go on a band. The event is the only handle on them — a
   * browser hands a drop its data and nothing else.
   *
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onDrop
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.onDrop
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onDropFiles
   */
  readonly onFilesDropped: (band: SingleFileDropTarget, event: React.DragEvent) => void;
}

export interface PaneDropRegion {
  /** Asks what a band would do, for the plates to caption themselves from. */
  readonly outcomeFor: PaneDropOutcomeResolver;
  readonly onDragOver: (event: React.DragEvent) => void;
  readonly onDragLeave: (event: React.DragEvent) => void;
  readonly onDrop: (event: React.DragEvent) => void;
}

/**
 * The event half of a drop region, spread on the element that owns the drop.
 *
 * A pane is read from the drag itself — the modifier off the event, the pane's
 * identity out of `paneDragStore`, since a browser will not hand out a drag's
 * data before the drop — and the band from where the pointer is, which is why
 * the region has to measure the element the bands divide rather than trust its
 * own box.
 *
 * A drop with no meaning is refused by the cursor rather than swallowed and
 * ignored: the events are still ours, so nothing below tries to open what the
 * user was told could not be dropped here.
 *
 * The session is raised and lowered from here as well as from the window,
 * because a region is the only thing that hears a drag it stops: a file that
 * comes in over a pane has to bring the bands up on **every** pane, and only
 * the window's own handlers would have heard it through the propagation the
 * region stopped.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingEntered
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingUpdated
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingExited
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingEnded
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.performDragOperation
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.prepareForDragOperation
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onDragSessionChanged
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.paneOperation
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.band
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.updateHover
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.draggingEntered
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.draggingUpdated
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.draggingExited
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.draggingEnded
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.prepareForDragOperation
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.performDragOperation
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingEntered
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingExited
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.draggingEnded
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.performDragOperation
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.prepareForDragOperation
 * @upstream-differs entry and exit are one `dragover` and one `dragleave` here: a browser
 * re-sends the move for every pixel, where AppKit separates the entering from the moving, and
 * the end of the session is heard from the source's own `dragend` as well as from the drop
 * @upstream-differs the prepare step has no counterpart — a browser goes straight from the drop
 * to the operation, so the queued one both panes share is answered with "yes" by having no
 * equivalent to answer with
 */
export function paneDropRegion(options: PaneDropRegionOptions): PaneDropRegion {
  const { bands, outcomeFor, fallbackBand, onPaneDropped, onFilesDropped } = options;

  /**
   * The band under the pointer, or the region's fallback when the pointer is not
   * within the bands at all.
   *
   * Measured from the element the bands divide — the region's own element unless
   * a `bands` ref names a smaller one — and **both axes are asked**, as
   * upstream's own `bounds.contains(point)` does before it reads the y off the
   * band rule. The height alone is not enough: in single-file mode the bands
   * divide one half of a split view, so a point in the *other* half is inside the
   * bands' vertical range and would be answered with a band of the half the
   * pointer is not in — and the free half would never be the answer.
   *
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.band
   */
  const bandUnder = (event: React.DragEvent): SingleFileDropTarget | undefined => {
    const element = bands?.current ?? (event.currentTarget as HTMLElement | null);
    if (element === null) return fallbackBand;
    const rect = element.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom;
    if (!inside) return fallbackBand;
    return (
      new DropBandLayout({ halfHeight: rect.height }).band(event.clientY - rect.top) ?? fallbackBand
    );
  };

  return {
    outcomeFor,

    onDragOver: (event) => {
      const carried = dragCarried(event.dataTransfer);
      if (carried === undefined) return;
      const band = bandUnder(event);
      if (band === undefined) return;
      // A file entering a region is what tells the whole workspace a drag is on:
      // the bands of *other* panes have to come up too, and only this store
      // reaches them.
      // @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onDragSessionChanged
      if (carried === "file") beginFileDrag();
      // A join and a duplicate both copy — the pane they came from is left as
      // it was — so the cursor carries the + that says so.
      // @upstream ByteRipperApp/DragDrop/DragDrop.swift#NSDraggingInfo.isCopyRequested
      const copying = carried === "pane" && event.altKey;
      if (carried === "pane") notePaneDragCopying(copying);
      const outcome = carried === "pane" ? outcomeFor(band, copying) : undefined;
      // Ours whichever way it goes: a region that cannot take what is carried
      // refuses it rather than letting the window behind it open something.
      event.stopPropagation();
      if (carried === "pane" && (outcome === undefined || outcome.kind === "none")) {
        event.dataTransfer.dropEffect = "none";
        notePaneDragZone(undefined);
        return; // no `preventDefault`: the drop never happens here
      }
      event.preventDefault();
      if (carried === "file") event.dataTransfer.dropEffect = "copy";
      else event.dataTransfer.dropEffect = isCopyOperation(outcome) ? "copy" : "move";
      notePaneDragZone(band);
    },

    onDragLeave: (event) => {
      // Fires for every child the pointer crosses, so only a leave that takes it
      // out of the region entirely counts.
      const related = event.relatedTarget as Node | null;
      if (related !== null && event.currentTarget.contains(related)) return;
      notePaneDragZone(undefined);
    },

    onDrop: (event) => {
      const carried = dragCarried(event.dataTransfer);
      if (carried === undefined) return;
      const band = bandUnder(event);
      if (band === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      notePaneDragZone(undefined);
      if (carried === "pane") {
        const paneId = draggedPaneId();
        const copying = paneDragIsCopying();
        // Ended before the act, as upstream ends the session before routing it:
        // the act is a command that may be refused, and a refusal still has to
        // leave the workspace with no drag in flight.
        // @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.performDragOperation
        endDrag();
        if (paneId !== undefined) onPaneDropped(paneId, band, copying);
        return;
      }
      onFilesDropped(band, event);
      endDrag();
    },
  };
}

/** Whether an outcome copies rather than moves, which is what the cursor says. */
function isCopyOperation(outcome: PaneDropOutcome | undefined): boolean {
  return outcome?.kind === "join" || outcome?.kind === "duplicate";
}
