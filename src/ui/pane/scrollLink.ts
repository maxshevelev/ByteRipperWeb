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

  register(id: string, scroller: LinkedScroller): () => void {
    this.panes.set(id, scroller);
    this.announce();
    return () => {
      this.panes.delete(id);
      this.announce();
    };
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

  /** Called when a pane has scrolled. Mirrors it to the others. */
  report(id: string): void {
    this.announce();
    const source = this.panes.get(id);
    if (source === undefined || this.panes.size < 2) return;

    const position = source.position();
    const rowHeight = source.rowHeight();
    for (const [otherId, other] of this.panes) {
      if (otherId === id) continue;
      const extent = other.extent();
      const target = mirroredScroll(
        position,
        { rowHeight },
        { rowHeight: other.rowHeight(), maxTop: extent.maxTop, maxLeft: extent.maxLeft }
      );
      if (target === undefined) continue;
      const current = other.position();
      if (current.top === target.top && current.left === target.left) continue;
      other.moveTo(target);
    }
  }
}

/**
 * The workspace's link. One per browser tab, like the workspace itself (D11),
 * so a pane can join it without being handed one.
 */
export const scrollLink = new ScrollLink();
