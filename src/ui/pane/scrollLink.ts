/**
 * Locking two panes to the same offsets.
 *
 * Ported from upstream's `ComparisonView` scroll synchronisation. Comparison is
 * by absolute offset, so two panes showing the same offsets at the same row is
 * the whole arrangement — and scrolling one without the other throws that away
 * the moment you move.
 *
 * Three rules, all of them upstream's and all of them earned:
 *
 * - **Pixels only stand for content while both panes are measured the same
 *   way.** A font change re-lays out the panes one at a time, and a sync across
 *   that gap hands the other pane a position pointing at different bytes; that
 *   pane then corrects and syncs back, and both walk away from where the user
 *   was — further the further down the file. Waiting costs nothing: the pane
 *   that finishes last brings the pair back into lock-step.
 * - **Clamp to the other pane's extent**, so a shorter file cannot be scrolled
 *   into blank space below its own end.
 * - **An echo is not a scroll.** Setting the other pane's position makes the
 *   browser fire a scroll event there, and mirroring that back would be a loop.
 *   The pane filters those itself (`PaneScroller`), because only it knows what
 *   it last set — so a move made through `moveTo` is never reported back.
 * - **A pane fitting itself is not a scroll either.** A resize, a file that
 *   grows or shrinks, a font change: the pane settles under the position the
 *   panes share, and the other pane is not told. Reported, the shorter file's
 *   clamp at its own end would drag the longer one back to it.
 *
 * Positions are in content pixels, not the elements' own offsets: a file taller
 * than a browser lays out scrolls a scaled track, and two panes with different
 * viewport heights would scale it differently.
 */

export interface ScrollPosition {
  readonly top: number;
  readonly left: number;
}

export interface PaneScrollMetrics {
  /** What says whether the two panes are measured the same way. */
  readonly rowHeight: number;
  /** The furthest this pane can scroll — `scrollHeight - clientHeight`. */
  readonly maxTop: number;
  readonly maxLeft: number;
}

/**
 * Where the other pane should go, or `undefined` when it should not move.
 *
 * Pure, so the rules above can be tested without a DOM.
 */
export function mirroredScroll(
  from: ScrollPosition,
  fromMetrics: Pick<PaneScrollMetrics, "rowHeight">,
  to: PaneScrollMetrics
): ScrollPosition | undefined {
  // Mid-relayout the two are measured differently and a pixel means different
  // bytes on each side.
  if (fromMetrics.rowHeight !== to.rowHeight || to.rowHeight <= 0) return undefined;

  return {
    top: Math.max(0, Math.min(from.top, to.maxTop)),
    left: Math.max(0, Math.min(from.left, to.maxLeft)),
  };
}

/** A pane the link can read and move. */
export interface LinkedScroller {
  /** Read fresh each time: the layout changes with the font and the word size. */
  rowHeight(): number;
  /** Where the pane is, in content pixels. */
  position(): ScrollPosition;
  /** How far it can scroll, and how much of it is on screen. */
  extent(): { readonly maxTop: number; readonly maxLeft: number; readonly viewportHeight: number };
  /** Moves it without reporting back: a move the link makes is not a scroll to mirror. */
  moveTo(position: ScrollPosition): void;
}

/**
 * Keeps the registered panes at the same offsets.
 *
 * One per workspace. Panes register on mount and deregister on unmount, so with
 * a single file open there is nothing to mirror and nothing happens.
 */
export class ScrollLink {
  private readonly panes = new Map<string, LinkedScroller>();

  /**
   * The position the panes share: where a pane was last *taken* — by the user's
   * scroll or by a navigation — in content pixels, with the row height it was
   * measured at.
   *
   * It is the only position there is. Every other move a pane makes — a resize,
   * its file growing or shrinking under an edit or a revert, a font change — is
   * that pane fitting itself back under this position as far as its own file
   * reaches, never a new position handed to the other pane. That is what keeps
   * two panes from drifting apart: the one place they may disagree is past the
   * end of the shorter file, and the moment it reaches that far again it is
   * level again.
   *
   * Kept when the last pane leaves, so a pane whose file is replaced — which
   * remounts it — comes back where it was; {@link forget} drops it when a pane
   * is closed on purpose.
   */
  private shared:
    | { readonly top: number; readonly left: number; readonly rowHeight: number }
    | undefined;

  /**
   * Joins a pane to the link. Joining is not a scroll: the pane comes to where
   * the panes already are, and nothing already open moves to meet it — the
   * comparison opens in lock-step from the position the reader was at.
   *
   * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.isSyncArmed
   * @upstream-differs every pane that joins is aligned, not only the second one on the first layout
   */
  register(id: string, scroller: LinkedScroller): () => void {
    this.panes.set(id, scroller);
    this.align(scroller);
    this.announce();
    return () => {
      if (this.panes.get(id) === scroller) this.panes.delete(id);
      this.announce();
    };
  }

  /**
   * A pane is being closed on purpose, not remounted: when it is the last one,
   * the next file opens at its top rather than at where this one was.
   */
  forget(id: string): void {
    for (const other of this.panes.keys()) if (other !== id) return;
    this.shared = undefined;
  }

  /**
   * A pane's extent or its measure changed: it goes back under the shared
   * position, as far as its file reaches, and reports nothing. Returns false
   * when there is no shared position to go back to — nothing has scrolled yet,
   * or the pane is not laid out — so the pane can decide for itself.
   */
  settle(id: string): boolean {
    const pane = this.panes.get(id);
    if (pane === undefined || this.shared === undefined || pane.rowHeight() <= 0) return false;
    this.align(pane);
    this.announce();
    return true;
  }

  /** Moves a pane under the shared position, clamped to its own extent. */
  private align(pane: LinkedScroller): void {
    const shared = this.shared;
    const rowHeight = pane.rowHeight();
    if (shared === undefined || rowHeight <= 0) return;
    // The same rows, whatever each pane is measured at now: a font change
    // re-lays the panes out one at a time, and pixels only stand for content at
    // the row height they were taken at.
    const top =
      shared.rowHeight === rowHeight ? shared.top : (shared.top / shared.rowHeight) * rowHeight;
    const extent = pane.extent();
    const target = mirroredScroll(
      { top, left: shared.left },
      { rowHeight },
      { rowHeight, maxTop: extent.maxTop, maxLeft: extent.maxLeft }
    );
    if (target === undefined) return;
    const current = pane.position();
    if (current.top === target.top && current.left === target.left) return;
    pane.moveTo(target);
  }

  /**
   * Told whenever a pane's position changes.
   *
   * The minimap draws where the panes are, so it needs to hear about every
   * scroll — including the mirrored ones. It subscribes here rather than having
   * the position passed down through the shell: the link already holds the
   * scrolling elements, and a second path to the same number is a second way
   * for the map and the dump to disagree.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private readonly listeners = new Set<() => void>();

  private announce(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * The byte range a pane is showing, or `undefined` when it is not measured.
   *
   * Rounded outward: a row half on screen is a row the user can see, and the
   * band should cover it.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.visibleByteRange
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.onVisibleRangeChanged
   */
  visibleRange(id: string, bytesPerRow: number): { start: number; end: number } | undefined {
    const pane = this.panes.get(id);
    if (pane === undefined) return undefined;
    const rowHeight = pane.rowHeight();
    if (rowHeight <= 0) return undefined;
    const firstRow = Math.floor(pane.position().top / rowHeight);
    const rows = Math.ceil(pane.extent().viewportHeight / rowHeight);
    return { start: firstRow * bytesPerRow, end: (firstRow + rows) * bytesPerRow };
  }

  /**
   * Takes a pane to an offset, clamped to what it can scroll.
   *
   * Two ways of arriving, because they answer different gestures. A click on
   * the map means "show me this", so the row is **centred** and its
   * surroundings come with it. A drag or a wheel is a scroll, so the row goes
   * to the **top** — anything else would make the content slide under the hand
   * by half a screen.
   *
   * Nothing here touches the caret: this is a way of looking somewhere.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.selectMinimapOffset
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.trackMinimapViewport
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.updateMinimapViewports
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.minimapViewports
   */
  scrollToOffset(
    id: string,
    offset: number,
    bytesPerRow: number,
    options: { readonly centre?: boolean } = {}
  ): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const rowHeight = pane.rowHeight();
    if (rowHeight <= 0) return;
    const extent = pane.extent();
    const rowTop = Math.floor(offset / bytesPerRow) * rowHeight;
    const target =
      options.centre === true ? rowTop - extent.viewportHeight / 2 + rowHeight : rowTop;
    pane.moveTo({
      top: Math.max(0, Math.min(target, extent.maxTop)),
      left: pane.position().left,
    });
    this.report(id);
  }

  /**
   * Called when a pane has scrolled. Mirrors it to the others.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onHexViewportChanged
   */
  report(id: string): void {
    const source = this.panes.get(id);
    const rowHeight = source?.rowHeight() ?? 0;
    if (source !== undefined && rowHeight > 0) {
      const position = source.position();
      this.shared = { top: position.top, left: position.left, rowHeight };
      for (const [otherId, other] of this.panes) {
        if (otherId !== id) this.align(other);
      }
    }
    this.announce();
  }
}

/**
 * The workspace's link. One per browser tab, like the workspace itself (D11),
 * so a pane can join it without being handed one.
 */
export const scrollLink = new ScrollLink();
