import { createStore } from "@/state/store";
import type { PaneId, PartId, SlotId } from "@/state/workspaceStore";
import type { SingleFileDropTarget } from "@/ui/drag/dragDrop";

/** A pane in flight from another window of the desktop shell, as that window announced it. */
export interface RemoteDraggedPane {
  readonly from: string;
  /** The pane there: one of its two, or a fragment panel (D6). */
  readonly slot: PaneId;
  readonly name: string;
  readonly size: number;
}

/**
 * What is in flight over the workspace, and what it is asking for (§22.4).
 *
 * The gesture's memory, and the only place it lives: the header that picks a pane
 * up, the overlays that would take it, and the single-file container that splits
 * to offer a free half all read this and nothing else.
 *
 * **The pane's identity has to live somewhere outside the drag**, which is a
 * difference the web forced rather than one it chose. AppKit hands a destination
 * the pasteboard the moment the drag enters it; a browser hides a drag's data
 * from every `dragover` — `dataTransfer.getData` answers "" until the `drop` —
 * so a band that wants to say what it would do cannot ask what is being carried.
 * The identity is therefore written once at pick-up and read from here, which
 * also makes the plane every overlay shares.
 */

/** What a drag is carrying, as far as the workspace is concerned. */
export type DragKind = "file" | "pane";

export interface PaneDragState {
  /** `undefined` when nothing is being dragged over the workspace at all. */
  readonly inFlight: DragKind | undefined;
  /** The pane being dragged, when one of this window's is. */
  readonly paneId: SlotId | undefined;
  /**
   * The fragment panel being dragged by its pill, when one of this window's is
   * (`Design/DESKTOP_WINDOWS.md`, D6).
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fragmentDropOutcome
   */
  readonly partId?: PartId | undefined;
  /**
   * The pane being dragged, when it is another window's (`Design/DESKTOP_WINDOWS.md`, D5).
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Destination.pane
   */
  readonly remote?: RemoteDraggedPane | undefined;
  /**
   * Whether the drag in flight is asking to copy. Held between updates so the
   * captions can be recomputed without the event to hand.
   */
  readonly copying: boolean;
  /**
   * The zone the pointer is over, when that zone has something to offer it.
   * `undefined` means nothing is lit — the pointer is over a zone that refuses
   * what it carries, or over none at all.
   */
  readonly zone: SingleFileDropTarget | undefined;
  /**
   * The drop region the zone belongs to: only its bands are lit. Every pane has the same three
   * bands, so the band alone would light the same one on every pane.
   *
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.updateHover
   * @upstream-differs upstream's hover is each view's own state; here it is the window's, so it says whose
   */
  readonly zoneRegion?: Element | undefined;
}

const IDLE: PaneDragState = {
  inFlight: undefined,
  paneId: undefined,
  copying: false,
  zone: undefined,
};

export const paneDragStore = createStore<PaneDragState>(IDLE);

/**
 * A file drag is over the workspace.
 *
 * The window raises this one, since a file can be dropped anywhere on it — and
 * on the landing screen, where there is no pane to enter.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onDragSessionChanged
 */
export function beginFileDrag(): void {
  paneDragStore.update((state) =>
    state.inFlight === "file" ? state : { ...IDLE, inFlight: "file" }
  );
}

/**
 * Picks a pane up: a drag carrying nothing but this pane's identity — see this
 * file's header for why the identity lives here rather than on the drag.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginPaneDrag
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onDragSessionChanged
 * @upstream-differs the identity is written here rather than onto a pasteboard, because a browser
 * hides a drag's data from every destination until the drop
 */
export function beginPaneDrag(paneId: SlotId): void {
  paneDragStore.update(() => ({ ...IDLE, inFlight: "pane", paneId }));
}

/**
 * A pane from another window of the desktop shell has come over this one.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingEntered
 * @upstream-differs the pane is known from the window it left, which announced it: the drag's
 * own data is hidden until the drop
 */
export function beginRemotePaneDrag(remote: RemoteDraggedPane): void {
  paneDragStore.update(() => ({ ...IDLE, inFlight: "pane", remote }));
}

/**
 * A fragment panel of this window picked up by its pill.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginPaneDrag
 * @upstream-differs by the pill, the panel's header being where a pull folds it
 */
export function beginPartDrag(partId: PartId): void {
  paneDragStore.update(() => ({ ...IDLE, inFlight: "pane", partId }));
}

/** This window's fragment panel in flight, if that is what is dragged. */
export function draggedPartId(): PartId | undefined {
  return paneDragStore.getSnapshot().partId;
}

/** The other window's pane in flight over this one, if that is what is dragged. */
export function draggedRemotePane(): RemoteDraggedPane | undefined {
  return paneDragStore.getSnapshot().remote;
}

/**
 * The drag is over — dropped, cancelled, or taken out of the workspace.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggingEnded
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.onDragSessionChanged
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.forgetDraggedPane
 * @upstream-differs the pane is forgotten when the drag ends rather than when an overlay is left:
 * the payload is here, so forgetting it on the way out would leave the rest of the drag with
 * nothing to answer for — the very bug `forgetDraggedPane`'s own comment describes
 */
export function endDrag(): void {
  paneDragStore.update((state) => (state.inFlight === undefined ? state : IDLE));
}

/**
 * Records the modifier, so the bands can be captioned from it without the
 * dragging info to hand.
 *
 * Upstream this is two functions — `notePaneDragCopying` and the `setPaneDragCopying`
 * another zone calls with the news it heard — because AppKit sends
 * `draggingUpdated` to the destination under the pointer and to no other, and
 * the window has to push the news out itself (`setPaneDragCopyingEverywhere`).
 * React re-renders every subscriber, so the news is written once and read
 * everywhere, and neither of those two has a counterpart.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.notePaneDragCopying
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.onCopyModifierChanged
 * @upstream ByteRipperApp/DragDrop/SingleFileDropView.swift#SingleFileDropView.onCopyModifierChanged
 * @upstream-differs one writer, not two: there is nobody to relay the news to in the web
 */
export function notePaneDragCopying(copying: boolean): void {
  paneDragStore.update((state) => (state.copying === copying ? state : { ...state, copying }));
}

/**
 * The zone the pointer is over: shows the bands for the drag's lifetime, and
 * highlights whichever band is under the pointer. `undefined` takes them down.
 *
 * The bands must be truly hidden while idle — otherwise they swallow every click
 * over the pane (§4.3) — and a drop with no meaning is refused by the cursor
 * rather than swallowed and ignored, which is why a zone that refuses what it
 * carries is written as `undefined` rather than as itself.
 *
 * Whatever the pointer is over, the drag itself is untouched: a band that
 * refuses a pane takes the bands down, not the flight, or every band after it
 * would answer "no" for the rest of the gesture.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.setDragActive
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.updateHover
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.clearHover
 * @upstream-differs one setter for three: the band under the pointer and whether the bands are up
 * are the same fact — a zone with nothing to offer is not a zone — so they are one field here
 * rather than two
 */
export function notePaneDragZone(
  zone: SingleFileDropTarget | undefined,
  region?: Element | undefined
): void {
  const zoneRegion = zone === undefined ? undefined : region;
  paneDragStore.update((state) =>
    state.zone === zone && state.zoneRegion === zoneRegion ? state : { ...state, zone, zoneRegion }
  );
}

/**
 * The pointer has left `region`. Its zone is taken down only if it is still the one lit: a
 * browser tells the region entered before the one left, and that one's zone is not this one's.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.clearHover
 */
export function leavePaneDragZone(region: Element): void {
  if (paneDragStore.getSnapshot().zoneRegion === region) notePaneDragZone(undefined);
}

/**
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggedPaneID
 */
export function draggedPaneId(): SlotId | undefined {
  return paneDragStore.getSnapshot().paneId;
}

/**
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.draggedPaneIsCopying
 */
export function paneDragIsCopying(): boolean {
  return paneDragStore.getSnapshot().copying;
}
