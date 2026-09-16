import {
  middleTruncated,
  PANE_DRAG_ICON_GAP,
  paneDragNameBudget,
  paneDragPillHeight,
  paneDragPillSize,
} from "@/ui/drag/paneDrag";

/**
 * The pill the hand carries (§22.4): the pane's document glyph and file name on
 * an opaque rounded plate with a hairline edge.
 *
 * **The picture is built rather than snapshotted**, as upstream draws it: the
 * header's own picture is text on nothing, which over a dump reads as a smear of
 * letters with no object behind them and nothing to see the edge of when it
 * crosses into another pane. The glyph is the header's own, so a modified or
 * untitled pane is still recognisable as itself while it is in flight.
 *
 * Upstream draws into an image and hands the window a frame; a browser wants an
 * element and lifts its own picture out of it, so the pill is assembled here,
 * hung off screen for the one frame the snapshot needs it, and taken down again.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginPaneDrag
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragPill
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.paneDragGlyph
 * @upstream-differs the pill is an element the browser snapshots rather than an image drawn at a
 * size, and the middle truncation is measured here rather than configured on the paragraph style
 */
export function setPaneDragImage(
  transfer: DataTransfer,
  name: string,
  header: Element | null
): void {
  const glyph = header?.querySelector(".pane-document") ?? null;
  const iconWidth = glyph === null ? 0 : glyph.getBoundingClientRect().width;
  const gap = iconWidth === 0 ? 0 : PANE_DRAG_ICON_GAP;

  const label = document.createElement("span");
  label.className = "pane-drag-name";
  label.textContent = name;

  const pill = document.createElement("div");
  pill.className = "pane-drag-pill";
  // Off screen but laid out: the browser takes the picture it needs out of a
  // rendered element, and takes it now.
  pill.style.top = "-1000px";
  pill.style.left = "-1000px";
  if (glyph !== null) pill.append(glyph.cloneNode(true));
  pill.append(label);
  document.body.append(pill);

  const measure = textMeasurer(label);
  const size = paneDragPillSize(
    iconWidth + gap + measure(name),
    // The header's own height, so the plate is the shape the pane wears and the
    // gesture reads as the pane itself moving.
    paneDragPillHeight(header?.getBoundingClientRect().height ?? 0)
  );
  const budget = paneDragNameBudget(size.width, iconWidth);
  label.textContent = middleTruncated(name, budget, measure);
  pill.style.width = `${size.width}px`;
  pill.style.height = `${size.height}px`;
  pill.style.columnGap = `${gap}px`;
  pill.style.borderRadius = `${size.height / 2}px`;

  // Centred on the pointer, so the pill goes where the hand goes rather than
  // trailing from wherever in the header the press landed.
  transfer.setDragImage(pill, size.width / 2, size.height / 2);
  // The picture is the browser's from here on, and the plate was only ever for
  // that one frame.
  requestAnimationFrame(() => pill.remove());
}

/**
 * Measures text in an element's own font, through a canvas.
 *
 * The pill's own layout is what clamps what it holds — it is a fixed-width plate
 * with an overflow — so the label cannot be asked how wide it would like to be.
 *
 * @web-only the platform truncates by paragraph style; a browser has no measurement to reach for
 * that is not a canvas
 */
function textMeasurer(element: HTMLElement): (text: string) => number {
  const style = getComputedStyle(element);
  const context = document.createElement("canvas").getContext("2d");
  // Without a 2D context there is nothing to measure with. Everything then
  // "fits" and the plate's own overflow clips the name, which is a worse pill
  // and not a broken one.
  if (context === null) return () => 0;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return (text) => context.measureText(text).width;
}
