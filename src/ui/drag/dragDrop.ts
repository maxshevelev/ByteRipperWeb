import type { JoinPosition } from "@/core/document/binaryDocument";
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
 * Open-as-Second zone — a file dropped there opens beside this one instead of
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
      return "Insert at Start";
    case "replace":
      return "Replace Current File";
    case "appendAtEnd":
      return "Append at End";
    case "addSecond":
      return "Open as Second File";
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
 * to offer — and a band with nothing to offer shows the refusal symbol rather
 * than an empty plate.
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
      return "Swap Panes";
    case "move":
      return "Move Here";
    case "duplicate":
      return "Duplicate Here";
    case "none":
      return undefined;
  }
}
