/**
 * One targeted drop zone (§4.3): the whole box the drop lands in, outlined and
 * — on hover — flooded with a translucent accent fill, and a caption on a
 * frosted plate of its own in the middle of it, so the words stay readable
 * wherever the fill and the file content behind them are busy.
 *
 * The zone is the element that fills the box, not the plate around the words:
 * what a drop lands in is the band, and the fill has to say so. Upstream's
 * colours go on the zone's own layer for the same reason, with only the
 * caption's plate over them.
 *
 * Purely visual — the drop handling lives in the region that owns it
 * (`paneDropRegion` in `PaneDropBands`), and neither the zone nor its plate is
 * hit-testable, so the hex dump behind it keeps the mouse.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView
 * @upstream-differs the plate's material is the browser's own blend of the surface token rather
 * than an `NSVisualEffectView`, which has no counterpart here
 *
 * Upstream builds one of these out of four views — `plate`, `label`, the
 * refusal's `refusalIcon` and the two constraints it squares the plate with
 * (`plateSquareWidth`, `plateSquareHeight`) — where the caption's plate is one
 * element here, holding either the words or the symbol.
 */
export interface DropTargetViewProps {
  /**
   * What the zone says it will do, or `undefined` to refuse: a no-entry symbol
   * in place of a caption. A caption would have to find words for "nothing", and
   * an empty plate says nothing at all — which is what the middle band looked
   * like when a pane was dragged over its own slot.
   *
   * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.isShowingRefusal
   */
  readonly title?: string | undefined;
  /** Whether the zone wears its hover fill. */
  readonly highlighted?: boolean | undefined;
}

/**
 * The side of the square plate a refusal wears.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.refusalPlateSide
 */
export const DROP_REFUSAL_PLATE_SIDE = 56;

/**
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setTitle
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setRefused
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setHighlighted
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.applyPlateColors
 */
export function DropTargetView({ title, highlighted = false }: DropTargetViewProps) {
  const refused = title === undefined;
  return (
    // The zone takes the whole of the box it is given — the band, or the free
    // half — because that is the area a drop lands in: the fill and the border
    // have to say so, not just the words in the middle of it.
    <div className="drop-target" data-hovered={highlighted ? "" : undefined}>
      <div
        className="drop-plate"
        // A refusal is a symbol, not a sentence, so its plate is a square rather
        // than the lozenge a caption needs.
        style={
          refused ? { width: DROP_REFUSAL_PLATE_SIDE, height: DROP_REFUSAL_PLATE_SIDE } : undefined
        }
      >
        {refused ? (
          // `nosign`: a circle with a stroke through it.
          <svg
            className="drop-refusal"
            viewBox="0 0 30 30"
            role="img"
            aria-label="Not allowed here"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="15" cy="15" r="13" strokeWidth="2.6" />
            <path d="M5.8 5.8l18.4 18.4" strokeWidth="2.6" />
          </svg>
        ) : (
          <span className="drop-caption">{title}</span>
        )}
      </div>
    </div>
  );
}
