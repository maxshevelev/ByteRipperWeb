import { useRef } from "react";
import type { MinimapMode } from "@/render/minimap/minimapGeometry";
import { CONTENT_PADDING } from "@/render/minimap/minimapLayout";
import {
  marginMarkerReach,
  OVERVIEW_MARKER_INSET,
  overviewUsesRectangle,
  VIEWPORT_MARKER_SIDE,
} from "@/render/minimap/viewportMarker";

/**
 * Where the panes are, drawn over a map.
 *
 * In detail the band is the visible rows themselves. In overview a band tall
 * enough to see is the same translucent rectangle; a sliver — a large file's
 * visible page — is a triangle in each outer margin at the middle of the slice,
 * so the position it marks is the one the arrows point at rather than the top
 * edge of a strip.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.drawViewports
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.drawOverviewViewportMarkers
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.viewportDamage
 * @upstream-differs elements over the canvas, positioned by CSS against the map's own edges
 */
export function ViewportMarks({
  mode,
  band,
}: {
  readonly mode: MinimapMode;
  readonly band: { readonly top: number; readonly height: number } | undefined;
}) {
  // One decision per overlay, sticky across the overlap between the two edges.
  const rectangle = useRef(false);
  if (band === undefined) return null;
  const style = { top: band.top, height: band.height };
  if (mode === "detail") return <div className="minimap-band" style={style} />;

  rectangle.current = overviewUsesRectangle(rectangle.current, band.height);
  if (rectangle.current) return <div className="minimap-band" style={style} />;

  const side = VIEWPORT_MARKER_SIDE;
  const reach = marginMarkerReach(side);
  const top = band.top + band.height / 2 - side / 2;
  // The apex the inset short of the content: `CONTENT_PADDING` from the edge.
  const outer = CONTENT_PADDING - OVERVIEW_MARKER_INSET - reach;
  return (
    <>
      <svg
        className="minimap-viewport-marker"
        style={{ top, left: outer, width: reach, height: side }}
        viewBox={`0 0 ${reach} ${side}`}
        aria-hidden="true"
      >
        <path d={`M0 0L${reach} ${side / 2}L0 ${side}Z`} />
      </svg>
      <svg
        className="minimap-viewport-marker"
        style={{ top, right: outer, width: reach, height: side }}
        viewBox={`0 0 ${reach} ${side}`}
        aria-hidden="true"
      >
        <path d={`M${reach} 0L0 ${side / 2}L${reach} ${side}Z`} />
      </svg>
    </>
  );
}
