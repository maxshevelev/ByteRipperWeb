import {
  contentToTrack,
  isScaled,
  type TrackMetrics,
  trackHeightFor,
  trackToContent,
  wheelPixels,
} from "@/ui/pane/scrollTrack";

/**
 * Where a pane is in its content, and the scroller that shows it.
 *
 * The position is kept here in content pixels — the coordinates rows, offsets
 * and the other pane are measured in — and the element's own `scrollTop` is
 * derived from it (see `scrollTrack.ts`). For a file that fits the two are the
 * same number and this is a thin wrapper round the element. For one taller than
 * the browser can lay out, the element's offset is a scaled thumb position, too
 * coarse to be the truth: one pixel of it is several of content.
 *
 * It owns the spacer's geometry too, because the scroll range is only what the
 * mapping assumes if the spacer is exactly the track's height and pulled up
 * under the sticky canvas by exactly the viewport's height.
 *
 * Written against the handful of properties it touches, so it can be tested
 * without a DOM.
 */

export interface ScrollHost {
  scrollTop: number;
  scrollLeft: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

export interface ScrollSpacer {
  readonly style: { height: string; marginTop: string };
}

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}

export class PaneScroller {
  private readonly host: ScrollHost;
  private readonly spacer: ScrollSpacer;
  private readonly limit: number;

  private contentHeight = 0;
  private trackHeight = 0;
  private contentTop = 0;
  /**
   * The element offsets this scroller last set or saw. The browser fires a
   * scroll event after any assignment, and an event that finds these unchanged
   * is that echo rather than the user.
   */
  private seenTrackTop = 0;
  private seenLeft = 0;

  constructor(host: ScrollHost, spacer: ScrollSpacer, limit: number) {
    this.host = host;
    this.spacer = spacer;
    this.limit = limit;
  }

  /** The top of the viewport, in content pixels. */
  get top(): number {
    return this.contentTop;
  }

  /** Sideways is never scaled: a row is a few hundred pixels wide. */
  get left(): number {
    return this.host.scrollLeft;
  }

  get viewportHeight(): number {
    return this.host.clientHeight;
  }

  get maxTop(): number {
    return Math.max(0, this.contentHeight - this.host.clientHeight);
  }

  get maxLeft(): number {
    return Math.max(0, this.host.scrollWidth - this.host.clientWidth);
  }

  /** True when the file is taller than the browser lays out, so the thumb is scaled. */
  get scaled(): boolean {
    return isScaled(this.metrics());
  }

  /** The content grew or shrank. Returns whether that moved the position. */
  setContentHeight(height: number): boolean {
    if (height === this.contentHeight) return false;
    this.contentHeight = height;
    this.trackHeight = trackHeightFor(height, this.limit);
    this.spacer.style.height = `${this.trackHeight}px`;
    return this.place(this.contentTop, this.host.scrollLeft);
  }

  /** The viewport changed size. Returns whether that moved the position. */
  fit(): boolean {
    this.spacer.style.marginTop = `${-this.host.clientHeight}px`;
    return this.place(this.contentTop, this.host.scrollLeft);
  }

  /** Scrolls to a content position, clamped. Returns whether anything moved. */
  moveTo(top: number, left: number = this.host.scrollLeft): boolean {
    return this.place(top, left);
  }

  /**
   * Called from the element's scroll event. Returns true when the user moved it
   * — the thumb, a trackpad, the browser's own keys — and false for the echo of
   * an offset this scroller set.
   */
  noteScroll(): boolean {
    const trackTop = this.host.scrollTop;
    const left = this.host.scrollLeft;
    const movedTop = trackTop !== this.seenTrackTop;
    const movedLeft = left !== this.seenLeft;
    this.seenTrackTop = trackTop;
    this.seenLeft = left;
    if (movedTop) {
      this.contentTop = this.scaled
        ? Math.min(Math.max(trackToContent(trackTop, this.metrics()), 0), this.maxTop)
        : trackTop;
    }
    return movedTop || movedLeft;
  }

  /**
   * Takes a wheel event when the track is scaled, and says whether it did.
   *
   * Left to the browser, a wheel would move the scaled thumb — so a notch meant
   * as three rows would cover a dozen, and a fine trackpad movement would jump.
   * Taken here, content moves by exactly the distance asked for. A file that fits
   * never gets here, and neither does a pinch, which is the browser's zoom.
   */
  wheel(event: WheelInput, lineHeight: number): boolean {
    if (!this.scaled || event.ctrlKey) return false;
    const dy = wheelPixels(event.deltaY, event.deltaMode, lineHeight, this.host.clientHeight);
    const dx = wheelPixels(event.deltaX, event.deltaMode, lineHeight, this.host.clientWidth);
    if (dy === 0 && dx === 0) return false;
    this.place(this.contentTop + dy, this.host.scrollLeft + dx);
    return true;
  }

  private place(top: number, left: number): boolean {
    const beforeTop = this.contentTop;
    const beforeLeft = this.host.scrollLeft;
    this.contentTop = Math.min(Math.max(top, 0), this.maxTop);
    this.host.scrollTop = contentToTrack(this.contentTop, this.metrics());
    this.host.scrollLeft = Math.min(Math.max(left, 0), this.maxLeft);
    this.seenTrackTop = this.host.scrollTop;
    this.seenLeft = this.host.scrollLeft;
    // One-to-one, the position is wherever the element settled: a browser rounds
    // an assigned offset, and the rows have to be drawn where the scrollbar says.
    if (!this.scaled) this.contentTop = this.host.scrollTop;
    return this.contentTop !== beforeTop || this.host.scrollLeft !== beforeLeft;
  }

  private metrics(): TrackMetrics {
    return {
      contentHeight: this.contentHeight,
      trackHeight: this.trackHeight,
      viewportHeight: this.host.clientHeight,
    };
  }
}
