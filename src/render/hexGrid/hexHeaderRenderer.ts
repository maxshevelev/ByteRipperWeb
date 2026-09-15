/**
 * The pinned column header above the hex dump.
 *
 * The column names — "Offset", the byte offsets `00`…`0F` over the hex cells,
 * and "Decoded text" — in ink blue, with a thin rule between the header and the
 * rows. Ported from `ByteRipperApp/Hex/HexColumnHeaderView.swift`.
 *
 * It sits in the pane chrome above the scroller, so it never scrolls
 * vertically; it mirrors the scroller's horizontal offset so each label stays
 * over the column it names.
 *
 * Drawn with `fillText` rather than through the glyph atlas next door. The
 * atlas exists because the dump blits tens of thousands of glyphs a frame; this
 * is nineteen labels redrawn when the layout or the sideways scroll changes, so
 * an atlas here would be machinery bought with nothing.
 */

import type { HexLayout } from "@/render/hexGrid/hexLayout";

/**
 * Padding above and below the labels. Without it the strip is one hex row tall
 * and the ink — drawn at the row baseline — nearly touches both edges.
 *
 * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.verticalPadding
 */
export const HEADER_VERTICAL_PADDING = 4;

/**
 * One hex row plus symmetric padding, so the labels have breathing room.
 *
 * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.headerHeight
 */
export function headerHeight(rowHeight: number): number {
  return rowHeight + 2 * HEADER_VERTICAL_PADDING;
}

const OFFSET_TITLE = "Offset";
const TEXT_TITLE = "Decoded text";

export interface HexHeaderColors {
  readonly background: string;
  /** The labels and the rule beneath them. */
  readonly ink: string;
  /** The rule, which is the same ink held back so it separates without ruling. */
  readonly rule: string;
}

/**
 * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView
 * @upstream-differs a canvas renderer the pane redraws, not a view that observes the hex view
 */
export class HexHeaderRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private ratio = 1;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("This browser did not give the header a 2D context.");
    this.canvas = canvas;
    this.context = context;
  }

  /**
   * Sizes the backing store. Only the backing store: the element's box is CSS's
   * business, and writing both is how a canvas and its observer end up chasing
   * each other.
   */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.ratio = Math.max(1, devicePixelRatio);
    const width = Math.max(1, Math.round(cssWidth * this.ratio));
    const height = Math.max(1, Math.round(cssHeight * this.ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.draw
   * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.labelFrames
   * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.hexView
   * @upstream ByteRipperApp/Hex/HexColumnHeaderView.swift#HexColumnHeaderView.horizontalOffset
   * @upstream-differs the layout and the scroll offset are passed to each draw; the labels are placed inline
   */
  draw(options: {
    readonly layout: HexLayout;
    readonly fontPx: number;
    readonly fontFamily: string;
    readonly colors: HexHeaderColors;
    /** The scroller's horizontal offset, which the labels shift left by. */
    readonly scrollLeft: number;
  }): void {
    const context = this.context;
    const { layout, colors } = options;
    const width = this.canvas.width / this.ratio;
    const height = this.canvas.height / this.ratio;

    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = colors.background;
    context.fillRect(0, 0, width, height);

    // "Decoded text" sits at the far end of a full hex row, so in a pane too
    // narrow to show one it lands past this strip's trailing edge. Clip, or the
    // label paints over whatever is beside the pane — the other file, the
    // minimap. The rows themselves need no such clip: they are inside the
    // scroller, and this strip is pinned outside it.
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.translate(-options.scrollLeft, 0);

    context.font = `${options.fontPx}px ${options.fontFamily}`;
    context.textBaseline = "alphabetic";
    context.fillStyle = colors.ink;

    // The labels' ink centred in the strip, as the rows' glyphs are.
    const ink = context.measureText("0A");
    const middle = height / 2 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2;
    context.fillText(OFFSET_TITLE, layout.offsetColumnFrame(0).x, middle);
    for (let column = 0; column < BYTES_PER_ROW; column++) {
      context.fillText(columnIndex(column), layout.hexByteX(column), middle);
    }
    context.fillText(TEXT_TITLE, layout.textX(0), middle);

    // A thin rule separating the header from the dump, as wide as the content.
    context.fillStyle = colors.rule;
    context.fillRect(0, height - 1 / this.ratio, layout.contentWidth, 1 / this.ratio);
    context.restore();
  }
}

/** The dump's row width, which is also how many indices the header carries. */
const BYTES_PER_ROW = 16;

/** The sequential byte offset over a hex cell: `00`…`0F`. */
function columnIndex(column: number): string {
  return column.toString(16).toUpperCase().padStart(2, "0");
}
