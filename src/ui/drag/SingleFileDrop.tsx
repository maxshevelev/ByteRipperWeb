import { type ReactNode, useRef } from "react";
import { paneDragStore } from "@/state/paneDragStore";
import { useStore } from "@/state/useStore";
import type { PaneId, PaneLayout } from "@/state/workspaceStore";
import { DropZoneView } from "@/ui/drag/DropZoneView";
import {
  isDuplicate,
  type SingleFileDropTarget,
  singleFileDropTargetTitle,
} from "@/ui/drag/dragDrop";
import {
  PaneDropBands,
  type PaneDropOutcomeResolver,
  paneDropRegion,
} from "@/ui/drag/PaneDropBands";

/**
 * Single-file mode's content view (§4.3, amended by §22.4): wraps the pane and
 * splits the workspace into two targeted drop regions along the current pane
 * layout. The "this file" half is divided into the three bands; the "second
 * file" half is the single Open-as-Second target.
 *
 * A plain container, and the drop destination for the whole content area: the
 * two overlay halves are purely visual and pass the pointer through to the pane
 * behind them, so the drag system reaches this element by walking up from the
 * dump. A file drag anywhere in here therefore lands somewhere — the free half
 * is a target too, so nothing falls through to the window.
 *
 * The bands are the container's own, not the pane's: upstream's overlay sits
 * *beside* the pane in this view rather than inside it, sized to the first half,
 * which is what makes the three bands shares of that half rather than of the
 * whole dump view.
 *
 * The split exists only for the drag's lifetime, and only when the second half
 * has something to offer: a drop that cannot use it gets no second half, and the
 * bands take the room rather than leaving a space reserved for something that
 * will not happen. Upstream holds that as constraints it swaps — `bandsShareHalf`
 * and `bandsTakeAll`, re-made from `splitConstraints` when the pane layout
 * changes direction — and the free half as `addTarget`; here the half is rendered
 * or not rendered, and the split is the layout attribute the CSS reads.
 *
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView
 * @upstream-differs the halves are rendered while a drag is in flight rather than kept and
 * constrained, and the split direction is the workspace's own layout rather than a settings
 * notification this view has to observe to hear about
 */
export interface SingleFileDropProps {
  /** The workspace's split direction, which the two halves follow. */
  readonly layout: PaneLayout;
  /**
   * Asks what letting the drag go in a zone would do.
   *
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.paneDropOutcome
   */
  readonly outcomeFor: PaneDropOutcomeResolver;
  /**
   * A dragged pane was let go in a zone.
   *
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.onPaneDropped
   */
  readonly onPaneDropped: (paneId: PaneId, band: SingleFileDropTarget, copying: boolean) => void;
  /**
   * Files were let go in a zone.
   *
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.onDrop
   */
  readonly onFilesDropped: (band: SingleFileDropTarget, event: React.DragEvent) => void;
  /** The pane itself, which both halves lie over. */
  readonly children: ReactNode;
}

/**
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.applySplit
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.setSecondHalfOffered
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.updateDragTarget
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.clearDragTarget
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.retitlePaneZones
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.endPaneDrag
 */
export function SingleFileDrop({
  layout,
  outcomeFor,
  onPaneDropped,
  onFilesDropped,
  children,
}: SingleFileDropProps) {
  const { inFlight, copying, zone } = useStore(paneDragStore);
  /**
   * The "this file" half, whose box the three bands divide.
   *
   * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.thisFileBands
   */
  const bandsRef = useRef<HTMLDivElement | null>(null);

  const { onDragOver, onDragLeave, onDrop } = paneDropRegion({
    bands: bandsRef,
    outcomeFor,
    // The pointer outside the bands is in the "second file" half, which is one
    // target rather than three.
    fallbackBand: "addSecond",
    onPaneDropped,
    onFilesDropped,
  });

  // A pane from this very workspace has nowhere to be put beside itself, so that
  // half goes away for it — while a file, and a pane from anywhere else, always
  // have something to put there.
  const second = inFlight === "pane" ? outcomeFor("addSecond", copying) : undefined;
  const secondHalf = inFlight === "file" || (second !== undefined && second.kind !== "none");

  return (
    // The whole view is one region, so its handlers go on the container: the half
    // beside the file is a target of the same drop, not a second one. Every act
    // the region offers has a command in the menus, which is the keyboard's route.
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target is not interactivity of its own.
    <div
      className="single-file-drop"
      data-second-half={secondHalf ? "" : undefined}
      data-layout={layout}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <div className="single-file-drop-bands" ref={bandsRef} hidden={!secondHalf}>
        <PaneDropBands outcomeFor={outcomeFor} />
      </div>
      {secondHalf ? (
        // Captioned from what it will do: a pane from elsewhere becomes this
        // workspace's second one, so the zone's own name is the right words for
        // it; this workspace's own pane is copied, and "Open as Second File"
        // would say nothing about the copy being made (§23).
        <div className="single-file-drop-second">
          <DropZoneView
            title={
              second !== undefined && isDuplicate(second)
                ? "Duplicate Here"
                : singleFileDropTargetTitle("addSecond")
            }
            highlighted={zone === "addSecond"}
          />
        </div>
      ) : null}
    </div>
  );
}
