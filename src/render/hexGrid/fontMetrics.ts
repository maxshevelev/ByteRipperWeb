/**
 * How wide a character is, and how tall a row.
 *
 * The whole grid's geometry hangs off one number — the width of a monospaced
 * character at the current size — and the only honest way to get it is to ask
 * the font. Measured through a canvas rather than a DOM node, because that is
 * the context the glyphs are actually drawn in.
 *
 * The stack is named here rather than in CSS so the atlas and the measurement
 * can never disagree about which font was used.
 */

export const MONOSPACE_STACK =
  'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

/** Rows are this many times the font size. Upstream's 17px at 13px type. */
const ROW_HEIGHT_FACTOR = 1.3;

export interface FontMetrics {
  readonly charWidth: number;
  readonly rowHeight: number;
}

let measuringContext: CanvasRenderingContext2D | undefined;

/**
 * Measures one character of `family` at `sizePx`.
 *
 * `0` is the character measured: in a monospaced font every glyph is the same
 * width, and a digit is the one a fallback font is least likely to get wrong.
 * The width is rounded to a whole pixel so column boundaries land on pixel
 * boundaries and the glyph tiles stay crisp.
 */
export function measureFont(sizePx: number, family = MONOSPACE_STACK): FontMetrics {
  if (measuringContext === undefined) {
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("a 2D context is required to measure the hex font");
    measuringContext = context;
  }

  measuringContext.font = `${sizePx}px ${family}`;
  const measured = measuringContext.measureText("0").width;
  return {
    charWidth: Math.max(1, Math.round(measured)),
    rowHeight: Math.round(sizePx * ROW_HEIGHT_FACTOR),
  };
}
