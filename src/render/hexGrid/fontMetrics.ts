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

/**
 * The breathing room a row's natural line height gets over the glyphs'
 * ascender-to-descender box, before the row-height factor scales it down.
 */
const NATURAL_LINE_PADDING = 4;

/**
 * The family as a CSS font stack: the named family first, and the platform's
 * monospaced faces behind it for a machine that does not have it. The empty
 * family is the platform's own.
 *
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.font
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.boldFont
 * @upstream-differs a CSS stack that falls back by itself, rather than a resolved NSFont
 */
export function hexFontStack(family: string): string {
  return family === "" ? MONOSPACE_STACK : `"${family.replaceAll('"', "")}", ${MONOSPACE_STACK}`;
}

/**
 * The vertical pitch of a row: the font's natural line height — its ascender
 * to descender, padded — scaled by the row-height factor, so more rows fit.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.rowHeight
 */
export function rowHeightFor(ascent: number, descent: number, rowHeightScale: number): number {
  const natural = Math.ceil(ascent + descent) + NATURAL_LINE_PADDING;
  // Less a hair, so a factor that lands exactly on a whole pixel is not pushed
  // up to the next one by the binary fraction under it.
  return Math.ceil(natural * rowHeightScale - 1e-9);
}

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
/**
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.charWidth
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.centeredBaseline
 * @upstream-differs the ink is centred in the row where the glyph atlas paints it
 */
export function measureFont(
  sizePx: number,
  family = MONOSPACE_STACK,
  /** Upstream's built-in 0.8, which the settings store owns. */
  rowHeightScale = 0.8
): FontMetrics {
  if (measuringContext === undefined) {
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("a 2D context is required to measure the hex font");
    measuringContext = context;
  }

  measuringContext.font = `${sizePx}px ${family}`;
  const measured = measuringContext.measureText("0");
  // The font's own box, not the ink of "0": a row has to hold every glyph.
  const ascent = Number.isFinite(measured.fontBoundingBoxAscent)
    ? measured.fontBoundingBoxAscent
    : sizePx * 0.8;
  const descent = Number.isFinite(measured.fontBoundingBoxDescent)
    ? measured.fontBoundingBoxDescent
    : sizePx * 0.2;
  return {
    charWidth: Math.max(1, Math.round(measured.width)),
    rowHeight: rowHeightFor(ascent, descent, rowHeightScale),
  };
}
