/**
 * One targeted drop zone (§4.3): a clear plate over the box the drop lands in,
 * edged at idle and — on hover — flooded with a calm accent fill, and a caption on
 * a frosted plate of its own in the middle of it, so the words stay readable
 * wherever the fill and the file content behind them are busy.
 *
 * Every zone a drag can land on is up while it is over the window, so an idle
 * plate lets half the dump through: it marks where a zone is, its edge tells it
 * from its neighbours, and the hovered one's fill says which it is. The plate
 * stands in from the box it is given by `DROP_EDGE_PADDING` — the box is the band
 * or the free half, and the drop lands anywhere in it; the plate is what is drawn.
 *
 * Purely visual — the drop handling lives in the region that owns it
 * (`paneDropRegion` in `PaneDropBands`), and neither the zone nor its plate is
 * hit-testable, so the hex dump behind it keeps the mouse. A zone that would
 * refuse what is carried is never rendered (`dropZonePlates`), so there is no
 * refusal to draw.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView
 * @upstream-differs the plate is a translucent fill, as upstream's is before macOS 26: the clear
 * glass it is made of from 26 (`NSGlassEffectView`) is AppKit's material and has no counterpart in
 * a page, and a `backdrop-filter` blur would frost the dump out of reading, as upstream found of
 * the visual-effect materials. The caption's plate is the browser's own blend of the surface token
 * rather than an `NSVisualEffectView`
 *
 * Upstream builds one of these out of several views — `plate`, `label`, the glass and the hover
 * fill laid over it — where the caption's plate is one element here and the hover fill is the
 * zone's own background.
 */
import {
  DROP_CORNER_RADIUS,
  DROP_HOVER_FILL_ALPHA,
  DROP_IDLE_FILL_ALPHA,
  type DropEdge,
  dropPlateInsets,
} from "@/ui/drag/dragDrop";

export interface DropTargetViewProps {
  /** What the zone says it will do. */
  readonly title: string;
  /** Whether the zone wears its hover fill. */
  readonly highlighted?: boolean | undefined;
  /**
   * Whether the plate stands in from the box it is given, and which edge of it
   * the box shares with another zone (half the padding there). Leave it out
   * where the box is already the plate — a band's frame from `bandPlateFrames`.
   */
  readonly inset?: { readonly adjoining?: DropEdge | undefined } | undefined;
}

/**
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setTitle
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.setHighlighted
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropTargetView.applyPlateColors
 */
export function DropTargetView({ title, highlighted = false, inset }: DropTargetViewProps) {
  const pad = inset === undefined ? undefined : dropPlateInsets(inset.adjoining);
  return (
    <div
      className="drop-target"
      data-hovered={highlighted ? "" : undefined}
      style={
        {
          "--drop-corner": `${DROP_CORNER_RADIUS}px`,
          "--drop-idle-fill": `${DROP_IDLE_FILL_ALPHA * 100}%`,
          "--drop-hover-fill": `${DROP_HOVER_FILL_ALPHA * 100}%`,
          ...(pad === undefined
            ? {}
            : {
                position: "absolute",
                top: pad.top,
                bottom: pad.bottom,
                left: pad.left,
                right: pad.right,
                width: "auto",
                height: "auto",
              }),
        } as React.CSSProperties
      }
    >
      <div className="drop-plate">
        <span className="drop-caption">{title}</span>
      </div>
    </div>
  );
}
