/**
 * What a tree row and the legend's header open with: AppKit's disclosure
 * chevron, turned a quarter when the thing it opens is open.
 *
 * Drawn rather than typed. A character stood here — `▸`, then the full-size
 * `▶` — and neither is the mark the original shows. Upstream's tree is an
 * `NSOutlineView` and its legend's header is an `NSButton` with
 * `bezelStyle = .disclosure`; both wear AppKit's own disclosure button. A
 * browser cannot be given that button, so it is given its shape instead.
 *
 * That shape is not `chevron.right`, which is what it looks like from a
 * distance: SF Symbols' chevron opens to 64 degrees, and the button's is a
 * right angle, and it is the smaller of the two — a 7-point mark at 13-point
 * text where SF's is 8.56 out of a taller box. Measured off the control: ink 4
 * by 7, which for a right angle is a 3-by-6 polyline with half a stroke around
 * it. The stroke below is a little heavier than the control's own point, which
 * is what it takes to read the same at 1x: AppKit draws the mark on the pixel
 * grid and a browser antialiases it across one.
 *
 * The box is square so that opening a row turns this path a quarter about its
 * middle rather than drawing a second one — which is also what the system
 * button does, and why opening a row does not make its mark jump.
 *
 * `em` rather than pixels, so the mark grows with the text beside it — which is
 * upstream's own test of it (`UEFIChecksumFlowTests`, "the triangle grew with
 * the text beside it").
 *
 * @upstream-differs upstream's is an AppKit control; this is the same button's
 * shape, for a place where no such control exists
 */
export function DisclosureChevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      className="disclosure-chevron"
      viewBox="0 0 7 7"
      width="0.538em"
      height="0.538em"
      aria-hidden="true"
    >
      <path
        d="M2 0.5 5 3.5 2 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        // A quarter turn about the middle of the square: right becomes down.
        transform={open ? "rotate(90 3.5 3.5)" : undefined}
      />
    </svg>
  );
}
