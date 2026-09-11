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

/** A scrolling element the link can read and move. */
export interface LinkedScroller {
  readonly element: HTMLElement;
  /** Read fresh each time: the layout changes with the font and the word size. */
  rowHeight: () => number;
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
   * What this link last set each pane to.
   *
   * A browser fires the scroll event *after* the frame, so a synchronous flag
   * cannot tell an echo from a real scroll. Remembering the resulting position
   * can: a report matching it is the echo. Should the user happen to scroll to
   * precisely that position themselves, mirroring it would have been a no-op
   * anyway.
   */
  private readonly expected = new Map<string, ScrollPosition>();

  register(id: string, scroller: LinkedScroller): () => void {
    this.panes.set(id, scroller);
    this.announce();
    return () => {
      this.panes.delete(id);
      this.expected.delete(id);
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
    const element = pane.element;
    const firstRow = Math.floor(element.scrollTop / rowHeight);
    const rows = Math.ceil(element.clientHeight / rowHeight);
    return { start: firstRow * bytesPerRow, end: (firstRow + rows) * bytesPerRow };
  }

  /**
   * Puts an offset's row at the top of a pane, clamped to what it can scroll.
   *
   * Nothing here touches the caret: this is a way of looking somewhere.
   */
  scrollToOffset(id: string, offset: number, bytesPerRow: number): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const rowHeight = pane.rowHeight();
    if (rowHeight <= 0) return;
    const element = pane.element;
    // Centred, so a click on the map shows the surroundings of what was aimed
    // at rather than putting it against the top edge.
    const rowTop = Math.floor(offset / bytesPerRow) * rowHeight;
    const target = rowTop - element.clientHeight / 2 + rowHeight;
    element.scrollTop = Math.max(0, Math.min(target, element.scrollHeight - element.clientHeight));
    this.report(id);
  }

  /** Scrolls a pane by a wheel's worth, and mirrors it. */
  scrollBy(id: string, deltaY: number): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    const element = pane.element;
    element.scrollTop = Math.max(
      0,
      Math.min(element.scrollTop + deltaY, element.scrollHeight - element.clientHeight)
    );
    this.report(id);
  }

  /** Called when a pane has scrolled. Mirrors it to the others. */
  report(id: string): void {
    this.announce();
    const source = this.panes.get(id);
    if (source === undefined || this.panes.size < 2) return;

    const position: ScrollPosition = {
      top: source.element.scrollTop,
      left: source.element.scrollLeft,
    };

    const echo = this.expected.get(id);
    if (echo !== undefined && echo.top === position.top && echo.left === position.left) {
      this.expected.delete(id);
      return;
    }
    this.expected.delete(id);

    const rowHeight = source.rowHeight();
    for (const [otherId, other] of this.panes) {
      if (otherId === id) continue;
      const target = mirroredScroll(
        position,
        { rowHeight },
        {
          rowHeight: other.rowHeight(),
          maxTop: other.element.scrollHeight - other.element.clientHeight,
          maxLeft: other.element.scrollWidth - other.element.clientWidth,
        }
      );
      if (target === undefined) continue;
      if (other.element.scrollTop === target.top && other.element.scrollLeft === target.left) {
        continue;
      }
      other.element.scrollTop = target.top;
      other.element.scrollLeft = target.left;
      // Read back rather than remembering what was asked for. A browser clamps
      // and rounds an assigned offset — a pane already at its end reports a
      // fractionally different number — and an expectation that did not match
      // would be taken for a real scroll and mirrored back, dragging the longer
      // pane up to the shorter one's last row.
      this.expected.set(otherId, {
        top: other.element.scrollTop,
        left: other.element.scrollLeft,
      });
    }
  }
}

/**
 * The workspace's link. One per browser tab, like the workspace itself (D11),
 * so a pane can join it without being handed one.
 */
export const scrollLink = new ScrollLink();
