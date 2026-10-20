import type { CalloutRect } from "@/state/hoverCalloutStore";

/**
 * How far the capsule stands off the thing it names.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.gap
 */
export const CALLOUT_GAP = 4;

/**
 * Where a capsule of `size` goes beside `anchor`: level with the anchor's middle, the gap off the
 * side `opensRight` names — or off the other side when that one runs out of `bounds` — and moved
 * back inside `bounds` when it still does not fit.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.capsuleFrame
 */
export function calloutFrame(
  size: { readonly width: number; readonly height: number },
  anchor: CalloutRect,
  opensRight: boolean,
  bounds: CalloutRect
): CalloutRect {
  const right = anchor.x + anchor.width + CALLOUT_GAP;
  const left = anchor.x - CALLOUT_GAP - size.width;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  let x: number;
  if (opensRight) x = right + size.width <= maxX ? right : left;
  else x = left >= bounds.x ? left : right;
  x = Math.max(bounds.x, Math.min(x, maxX - size.width));
  const y = Math.max(
    bounds.y,
    Math.min(anchor.y + anchor.height / 2 - size.height / 2, maxY - size.height)
  );
  return { x, y, width: size.width, height: size.height };
}
