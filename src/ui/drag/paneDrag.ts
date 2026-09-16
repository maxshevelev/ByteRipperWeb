/**
 * The pill a pane is carried by (§22.4).
 *
 * Pure arithmetic and nothing else: how big the plate is, and what a name too
 * long for it is cut down to. The drawing lives in `paneDragImage.ts`, and the
 * browser is what actually carries the picture — so this is the half of the pill
 * that can be checked without a canvas, a drag or a session in flight.
 */

/**
 * The pill is carried at its drawn size. It is a plate with a file name on it,
 * and a name that has to be squinted at says nothing worth carrying — leaving
 * its pane is already visible from the pill leaving the pane.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragMinWidth
 */
export const PANE_DRAG_MIN_WIDTH = 200;

/**
 * The widest the pill gets. Past this the name truncates rather than the pill
 * stretching across the screen.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragMaxWidth
 */
export const PANE_DRAG_MAX_WIDTH = 260;

/**
 * The gap between the content and the pill's rounded ends.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragTextInset
 */
export const PANE_DRAG_TEXT_INSET = 16;

/**
 * The gap between the document glyph and the name.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragIconGap
 */
export const PANE_DRAG_ICON_GAP = 6;

/**
 * The shortest plate there is, whatever the header measures: a pane's header can
 * be short in a window squeezed down to nothing, and a pill that thin is a line.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragPill
 */
export const PANE_DRAG_MIN_HEIGHT = 24;

/**
 * The pill's size, given the width of what goes on it — the document glyph, the
 * gap after it, and the name.
 *
 * Height is the header's: the pill is not scaled at all, so the shape stays the
 * shape the pane wears, which is what makes it recognisable in flight. Width fits
 * the content between its paddings, floored so a two-letter name still gets a
 * plate rather than a lozenge, and capped so a long one truncates.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragPillSize
 */
export function paneDragPillSize(
  contentWidth: number,
  height: number
): { readonly width: number; readonly height: number } {
  const padded = contentWidth + PANE_DRAG_TEXT_INSET * 2;
  const width = Math.min(PANE_DRAG_MAX_WIDTH, Math.max(PANE_DRAG_MIN_WIDTH, padded));
  return { width, height };
}

/**
 * The height the pill is drawn at: the header's, floored so a very short header
 * does not produce a line rather than a plate.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragPill
 */
export function paneDragPillHeight(headerHeight: number): number {
  return Math.max(PANE_DRAG_MIN_HEIGHT, headerHeight);
}

/** What is left for the name once the glyph, its gap and the paddings are paid for. */
export function paneDragNameBudget(width: number, iconWidth: number): number {
  const gap = iconWidth === 0 ? 0 : PANE_DRAG_ICON_GAP;
  return Math.max(0, width - PANE_DRAG_TEXT_INSET * 2 - iconWidth - gap);
}

/**
 * A name cut down to what fits, by removing its middle: `…_donor.bin` against
 * `…_board.bin` is how two dumps of one chip are told apart, so the head and the
 * tail are kept and the middle goes.
 *
 * `measure` is the text's own width in whatever font the pill is drawn in, handed
 * in so this stays arithmetic: the caller has a canvas, the tests have a stub.
 *
 * @web-only the platform has no middle truncation to reach for — a browser draws
 * `text-overflow: ellipsis` at one end only, and a canvas draws no ellipsis at
 * all — so the rule is written here rather than configured, which also makes it
 * checkable
 */
export function middleTruncated(
  name: string,
  maxWidth: number,
  measure: (text: string) => number
): string {
  if (measure(name) <= maxWidth) return name;

  const ellipsis = "…";
  const budget = maxWidth - measure(ellipsis);
  if (budget <= 0) return ellipsis;

  // Split what is left evenly between the two ends, the way the platform's own
  // middle truncation does. The head is grown first, so an odd remainder lands
  // there rather than in the tail — where the extension is, and where a
  // character less is more likely to cost something.
  const head = longestPrefix(name, (budget + 1) / 2, measure);
  const tail = longestSuffix(name, head.length, budget - measure(head), measure);
  return `${head}${ellipsis}${tail}`;
}

/** The longest prefix of `text` that measures no wider than `maxWidth`, in code points. */
function longestPrefix(text: string, maxWidth: number, measure: (text: string) => number): string {
  const points = [...text];
  for (let end = points.length; end > 0; end -= 1) {
    const candidate = points.slice(0, end).join("");
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return "";
}

/** The longest suffix of `text` after `skip` that measures no wider than `maxWidth`. */
function longestSuffix(
  text: string,
  skip: number,
  maxWidth: number,
  measure: (text: string) => number
): string {
  const points = [...text].slice(skip);
  for (let start = 0; start < points.length; start += 1) {
    const candidate = points.slice(start).join("");
    if (measure(candidate) <= maxWidth) return candidate;
  }
  return "";
}
