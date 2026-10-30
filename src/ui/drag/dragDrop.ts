import type { JoinPosition } from "@/core/document/binaryDocument";
import { L } from "@/core/localization/localization";
import type { PaneId, SlotId } from "@/state/workspaceStore";

/**
 * What a drop on a pane means (§4.3, §22.4).
 *
 * Pure, like `hexPointer.ts` and `OpenPlacement`: it knows which pane was picked
 * up and where it was let go, so every branch is decided — and tested — without
 * a window, a drop or a drag in flight. A dragging gesture cannot be unit-tested;
 * this is the part of it that can.
 *
 * **Where the drop lands decides what it means, and the same places mean the
 * same things for a file and for a pane.** Every pane is divided into three
 * horizontal bands — the two join strips at the top and bottom and the replace
 * band between them — and a single-file workspace has a fourth zone beside
 * them, the free second half. None of the outcomes is a new operation: each
 * names one that already exists with commands and tests behind it, which is the
 * whole point. The drag is a second way to reach four verbs, not a second
 * implementation of them.
 *
 * Two arms of upstream's rule are deliberately absent. `NewTabDropStrip` — the
 * strip along the top of a window's content — is excluded from this port: a
 * browser tab has no window chrome above the panes, so there is nowhere for a
 * strip to lie and no tear-off to mean. What is left is the shape upstream
 * keeps for the destinations a workspace really has.
 */

/**
 * The targeted drop destinations inside a pane (§4.3, amended by §22.4): the
 * "this file" half divided into three bands, and the "second file" half's single
 * Open for Comparison zone — a file dropped there opens beside this one instead of
 * replacing it.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget
 */
export type SingleFileDropTarget = "insertAtStart" | "replace" | "appendAtEnd" | "addSecond";

/**
 * What a zone says it will do, in the words the panes' own menus use.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget.title
 */
export function singleFileDropTargetTitle(target: SingleFileDropTarget): string {
  switch (target) {
    case "insertAtStart":
      return L("Insert at Start");
    case "replace":
      return L("Replace Current File");
    case "appendAtEnd":
      return L("Append at End");
    case "addSecond":
      return L("Open for Comparison");
  }
}

/**
 * A join band (insert / append) brings the file's bytes into the pane rather
 * than replacing it (§22.4).
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#SingleFileDropTarget.isJoin
 */
export function isJoin(target: SingleFileDropTarget): boolean {
  return target === "insertAtStart" || target === "appendAtEnd";
}

/**
 * The layout of the three bands inside one pane's half of the drop overlay
 * (§22.4): the two join strips at the top and bottom, sized 25 % of the half's
 * height each and clamped to 48…120 pt, and the replace band filling the
 * middle. Pure — the hit-testing is testable at several pane heights without a
 * view. All y's are top-down within the half (0 at the half's top edge).
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout
 */
export class DropBandLayout {
  /**
   * The half's full height, top-down.
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.halfHeight
   */
  readonly halfHeight: number;

  /**
   * Height taken off the top by the New Tab strip, which lies across every
   * pane's overlay upstream. The bands start below it and share what is left.
   *
   * Nothing in the web edition produces a non-zero inset — the strip is not
   * ported — but the rule keeps the parameter so it stays a formula rather than
   * the one case it is used in.
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.topInset
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.topInset
   */
  readonly topInset: number;

  constructor(options: { readonly halfHeight: number; readonly topInset?: number }) {
    this.halfHeight = options.halfHeight;
    this.topInset = options.topInset ?? 0;
  }

  /** @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.bandHeight */
  get bandHeight(): number {
    return Math.max(0, this.halfHeight - this.topInset);
  }

  /**
   * The join strip's height: 25 % of the band area, clamped to 48…120 pt so the
   * strips stay hittable in a short window and do not swallow the middle in a
   * tall one (§22.4).
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.stripHeight
   */
  get stripHeight(): number {
    return Math.min(120, Math.max(48, this.bandHeight * 0.25));
  }

  /**
   * The middle (replace) band's top-down range, measured from the half's own
   * top; empty when the half is too short for the two clamped strips to leave
   * room for it.
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.replaceRange
   */
  get replaceRange(): { readonly start: number; readonly end: number } {
    const lower = this.topInset + this.stripHeight;
    const upper = this.topInset + this.bandHeight - this.stripHeight;
    return { start: lower, end: Math.max(lower, upper) };
  }

  /**
   * Which band a top-down y within the half maps to, or `undefined` outside it —
   * above the bands (the strip's share) or past the bottom. A drop outside any
   * band changes nothing (§22.4).
   *
   * @upstream ByteRipperApp/DragDrop/DragDrop.swift#DropBandLayout.band
   */
  band(atTopDownY: number): SingleFileDropTarget | undefined {
    const y = atTopDownY;
    if (y < this.topInset || y >= this.halfHeight) return undefined;
    const inBands = y - this.topInset;
    if (inBands < this.stripHeight) return "insertAtStart";
    if (inBands >= this.bandHeight - this.stripHeight) return "appendAtEnd";
    return "replace";
  }
}

/**
 * Where a pane drag was let go.
 *
 * A pane is named by its slot (`PaneId`) rather than by an index, and whether it
 * belongs to the window the drag started in is the same fact one workspace per
 * browser tab gives: every drop in the web edition is in its origin window
 * (D11). The arm is kept all the same — the rule reads as upstream's, and its
 * tests are upstream's.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Destination
 */
export type PaneDropDestination =
  /** Past every target — including the window's own edges. */
  | { readonly kind: "outside" }
  /**
   * A pane slot: which one, whether it belongs to the window the drag started
   * in, and which of that pane's three bands the pointer is over. The band is
   * the same one a dropped *file* lands in, and it means the same thing: the
   * ends join, the middle replaces.
   */
  | {
      readonly kind: "pane";
      readonly index: PaneId;
      readonly inOriginWindow: boolean;
      readonly band: SingleFileDropTarget;
    };

/**
 * What the drop does.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Outcome
 */
export type PaneDropOutcome =
  /** The pane animates back and nothing changes. */
  | { readonly kind: "none" }
  /** The workspace's two panes exchange places. */
  | { readonly kind: "swap" }
  /**
   * The pane moves into the destination pane slot, displacing what is there.
   * Upstream this is a pane arriving from another window; one workspace per
   * browser tab means no drop in the web edition produces it, though the rule
   * still answers for one.
   */
  | { readonly kind: "move"; readonly intoPane: PaneId }
  /**
   * The pane's bytes join the destination pane's, at one end or the other. A
   * join copies — the pane it came from is left as it was, the way a joined file
   * is left on disk.
   */
  | { readonly kind: "join"; readonly intoPane: PaneId; readonly at: JoinPosition }
  /**
   * The pane's content is copied into the destination pane as an untitled
   * document (§23). Into a free pane this is File ▸ Duplicate reached by hand;
   * into an occupied one it replaces what is there, the way a move does, and
   * asks first if that pane has unsaved work.
   */
  | { readonly kind: "duplicate"; readonly intoPane: PaneId };

/**
 * The outcome of a drop that changes nothing, for a caller that has no answer.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Outcome
 * @upstream-differs named and exported: a region that cannot resolve an outcome has to refuse, and
 * refusing is this value rather than an absence
 */
export const PANE_DROP_NONE: PaneDropOutcome = { kind: "none" };

/**
 * Whether this outcome copies the pane rather than moving it.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Outcome.isDuplicate
 */
export function isDuplicate(outcome: PaneDropOutcome): boolean {
  return outcome.kind === "duplicate";
}

/**
 * The meaning of letting `originIndex`'s pane go at `destination`.
 *
 * `copying` is the Option key, and it turns the outcomes that *move* the pane
 * into ones that copy it — the modifier's meaning everywhere else on the
 * platform. The middle band answers it wherever it lands: a swap moves both
 * panes, so its copying form is the one the other bands have, a copy into the
 * slot under the pointer. The only outcome Option leaves alone is the join,
 * which already copies, since the pane it reads from is left as it was.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.outcome
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Destination.pane
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#PaneDrop.Destination.outside
 */
export function paneDropOutcome(
  draggingPaneAt: PaneId,
  onto: PaneDropDestination,
  copying = false
): PaneDropOutcome {
  if (onto.kind === "outside") {
    // Deliberately not "make a new window": an accidental drop onto the desktop
    // would produce one nobody asked for, and the deliberate version of that act
    // has its own command.
    return PANE_DROP_NONE;
  }
  const { index, inOriginWindow, band } = onto;
  const ontoItself = inOriginWindow && index === draggingPaneAt;
  switch (band) {
    case "insertAtStart":
      // A pane joined to itself doubles its dump — the same operation a file
      // dropped on the pane it is already open in performs, and just as real.
      // Only the middle band is meaningless on a pane's own slot.
      return { kind: "join", intoPane: index, at: "start" };
    case "appendAtEnd":
      return { kind: "join", intoPane: index, at: "end" };
    case "replace":
      // Trading a pane with itself is the gesture abandoned, not performed. With
      // Option the band copies wherever it lands, near or far. Otherwise two
      // panes of one workspace trade places, and a pane from elsewhere takes the
      // slot, there being nothing to trade with.
      if (ontoItself) return PANE_DROP_NONE;
      if (copying) return { kind: "duplicate", intoPane: index };
      return inOriginWindow ? { kind: "swap" } : { kind: "move", intoPane: index };
    case "addSecond":
      // The free second pane of a single-file workspace. A pane from elsewhere
      // moves into it — or is copied into it with Option held. The workspace's
      // own pane cannot be *moved* there — it is already in this workspace — but
      // it can be **copied**, which is what File ▸ Duplicate does and is worth
      // having as a gesture: the dump beside itself, so a patch can be made on
      // the copy and every difference that appears is one the user made (§23).
      if (inOriginWindow) return { kind: "duplicate", intoPane: index };
      return copying ? { kind: "duplicate", intoPane: index } : { kind: "move", intoPane: index };
  }
}

/**
 * What letting a fragment panel go on a window's pane `onto` would do (`Design/DESKTOP_WINDOWS.md`,
 * D6).
 *
 * A panel let go on a pane stops being a panel: it becomes that pane, which is what lets a part be
 * compared with another — the second let go on a window's free half. Option copies it instead, as
 * for a pane. The join bands take nothing from a panel: a part's bytes belong in its parent, which
 * Update in Parent already puts them in. The free half is on screen only while that pane is free.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fragmentDropOutcome
 * @upstream-differs the facts are handed in — whether the pane is open, how big the panel's
 * document is — rather than looked up, which keeps it a rule
 */
export function fragmentDropOutcome(
  onto: SlotId,
  band: SingleFileDropTarget,
  ontoIsOpen: boolean,
  sourceSize: number,
  copying: boolean
): PaneDropOutcome {
  if (isJoin(band)) return PANE_DROP_NONE;
  if (band === "addSecond" && ontoIsOpen) return PANE_DROP_NONE;
  if (copying) return sourceSize > 0 ? { kind: "duplicate", intoPane: onto } : PANE_DROP_NONE;
  return { kind: "move", intoPane: onto };
}

/**
 * Which pane a band on the overlay of a single-file workspace acts on, and under
 * which band's rules — the free second half acts on the empty pane, the three
 * bands over the open file act on that file's own pane.
 *
 * The indirection exists because in single-file mode only one pane is open, so a
 * drop carries no pane of its own to argue with: the zone it lands in has to say
 * where it goes. The arrangement is handed in rather than looked up, which keeps
 * this a rule instead of a read.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.singleFilePaneDrop
 * @upstream-differs takes the two slots rather than assuming the file is in the first: the web
 * lets the lone file be the one in `b` (open two, close `a`), where upstream's index 0 is simply
 * "the pane that is open"
 */
export function singleFilePaneDrop(
  band: SingleFileDropTarget,
  arrangement: { readonly open: SlotId; readonly free: SlotId }
): { readonly pane: SlotId; readonly band: SingleFileDropTarget } {
  return { pane: band === "addSecond" ? arrangement.free : arrangement.open, band };
}

/**
 * The private type a pane drag carries its identity under.
 *
 * Private on purpose, as upstream's is: the payload is the pane's slot and
 * nothing else — not the bytes, and not a file URL, which would be a lie (a pane
 * is not a file) and would invite every other app to accept the drag. A type
 * nobody else declares is refused outside this app for free.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#NSPasteboard.PasteboardType.pane
 * @upstream-differs the reverse-DNS name becomes an `application/x-` one, which is what a browser
 * accepts as a drag's own type
 */
export const PANE_DRAG_TYPE = "application/x-byteripper-pane";

/**
 * Whether a drag carries a pane.
 *
 * Asked before the files, as upstream asks it: a pane's own type is
 * unambiguous, while a browser widens an element drag with the element's own
 * `text/html` and `text/plain` besides.
 *
 * @upstream ByteRipperApp/DragDrop/DragDrop.swift#NSPasteboard.draggedPaneID
 * @upstream-differs answers whether this is a pane drag rather than reading the pane from the
 * pasteboard: the identity itself cannot be read until the drop, so it is kept in
 * `paneDragStore` and only the type is asked here
 */
export function dragCarriesPane(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false;
  return Array.from(transfer.types).includes(PANE_DRAG_TYPE);
}

/**
 * What a band says about the pane in flight, or `undefined` when it has nothing
 * to offer — and a band with nothing to offer is refused, and not shown at all.
 *
 * The ends reuse the file bands' own words: it is the same operation, and a
 * second vocabulary for it would only suggest a difference that does not exist.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.paneBandTitle
 */
export function paneBandTitle(outcome: PaneDropOutcome): string | undefined {
  switch (outcome.kind) {
    case "join":
      return singleFileDropTargetTitle(outcome.at === "start" ? "insertAtStart" : "appendAtEnd");
    case "swap":
      return L("Swap Panes");
    case "move":
      return L("Move Here");
    case "duplicate":
      return L("Duplicate Here");
    case "none":
      return undefined;
  }
}

// MARK: - The zones on screen (§4.3)

/**
 * How far a zone's plate stands in from the edges of the box it lies over, and
 * how far apart two zones side by side stand: the plate never meets a pane's
 * border, a divider or its neighbour, so each reads as a place of its own. Where
 * two zones meet, each takes half.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.edgePadding
 */
export const DROP_EDGE_PADDING = 10;

/**
 * The plate's corners.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.cornerRadius
 */
export const DROP_CORNER_RADIUS = 14;

/**
 * How much of the dump an idle zone lets through. Every zone a drag can go to is
 * up while it is over the window, so an idle plate has to leave the dump readable
 * under it: it marks where a zone is, the hovered one's fill says which.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.idleFillAlpha
 */
export const DROP_IDLE_FILL_ALPHA = 0.5;

/**
 * How strong the hovered zone's accent fill is.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.hoverFillAlpha
 */
export const DROP_HOVER_FILL_ALPHA = 0.25;

/**
 * An edge of the box a set of zones lies over, top-down as the page is.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.adjoiningEdge
 * @upstream-differs named by side rather than AppKit's `NSRectEdge`, whose `maxY` is the top of a
 * view that is not flipped
 */
export type DropEdge = "top" | "bottom" | "left" | "right";

/** Where a plate lies in the box it stands for: insets from each edge, top-down. */
export interface DropPlateInsets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * How far a zone's plate stands in from each edge of its box: the padding, or half
 * of it on the edge the box shares with another zone, so the gap between the two
 * plates is the padding once rather than twice.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setAdjoiningEdge
 */
export function dropPlateInsets(adjoiningEdge?: DropEdge): DropPlateInsets {
  const pad = (edge: DropEdge) =>
    edge === adjoiningEdge ? DROP_EDGE_PADDING / 2 : DROP_EDGE_PADDING;
  return { top: pad("top"), bottom: pad("bottom"), left: pad("left"), right: pad("right") };
}

/** One plate of a pane's three bands, top-down within the box the bands divide. */
export interface BandPlateFrame {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Where each of the three bands' plates lies. The plates stand in from the box's
 * edges and from each other by `DROP_EDGE_PADDING`; the bands they stand for still
 * meet, so a drop between two plates lands in the band it is in — `band(atTopDownY:)`
 * is unchanged.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.layout
 */
export function bandPlateFrames(
  layout: DropBandLayout,
  adjoiningEdge?: DropEdge
): Record<"insertAtStart" | "replace" | "appendAtEnd", BandPlateFrame> {
  const h = layout.halfHeight;
  const inset = layout.topInset;
  const strip = layout.stripHeight;
  const gap = DROP_EDGE_PADDING / 2;
  const pad = dropPlateInsets(adjoiningEdge);
  const frame = (top: number, bottom: number): BandPlateFrame => ({
    top,
    height: Math.max(0, bottom - top),
    left: pad.left,
    right: pad.right,
  });
  return {
    insertAtStart: frame(inset + pad.top, inset + strip - gap),
    // The middle collapses to nothing in a very short box.
    replace: frame(inset + strip + gap, h - strip - gap),
    appendAtEnd: frame(h - strip + gap, h - pad.bottom),
  };
}

/** One zone on screen: what it says, and whether it is the one under the pointer. */
export interface DropZonePlate<Zone extends string> {
  readonly zone: Zone;
  readonly title: string;
  readonly highlighted: boolean;
}

/**
 * Which of a set of zones are on screen, and which of them is lit.
 *
 * While a drag is over the window every zone it can land on is up, unlit, and the
 * one under the pointer is lit over that: what the drop can do is read before the
 * pointer gets there, not discovered zone by zone. A zone that would refuse what is
 * carried — its title `undefined` — is not a place to go and is never shown, under
 * the pointer included: the cursor says no, and the other zones stay up.
 *
 * `up` is whether the window has its zones up at all: something is in flight, and
 * no fragment panel covers the panes they lie over.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#PaneDropBandsView.applyBands
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.isRefused
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setRefused
 * @upstream-differs a refusal is a title that is not there rather than a flag the zone is set to and
 * a caption clears: the plates are rebuilt from the drag on every render
 */
export function dropZonePlates<Zone extends string>(
  zones: readonly Zone[],
  options: {
    readonly up: boolean;
    readonly hovered: Zone | undefined;
    readonly titleFor: (zone: Zone) => string | undefined;
  }
): DropZonePlate<Zone>[] {
  if (!options.up) return [];
  return zones.flatMap((zone) => {
    const title = options.titleFor(zone);
    return title === undefined ? [] : [{ zone, title, highlighted: zone === options.hovered }];
  });
}
