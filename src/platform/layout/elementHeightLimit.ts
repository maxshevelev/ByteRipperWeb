/**
 * The tallest box this browser will lay out, measured once.
 *
 * Layout engines keep lengths in fixed-point integers and clamp anything taller:
 * Chromium and WebKit at about 33.5 million CSS pixels, Firefox at about 17.9
 * million. A scroller whose content is taller than that stops short, and the end
 * of a large dump cannot be reached at all. Measured rather than written down,
 * because the number is an engine's implementation detail and the three
 * already disagree about it.
 */

/** Far past any engine's limit, so the probe comes back clamped. */
const PROBE_HEIGHT = 1e9;

/**
 * Kept clear of the measured edge. The limit is where a length is clamped, not a
 * promise that everything just below it still behaves.
 */
const MARGIN = 0.9;

/** For an environment with no layout to ask. Below every engine's limit. */
const FALLBACK = 15_000_000;

let measured: number | undefined;

export function elementHeightLimit(): number {
  if (measured !== undefined) return measured;
  if (typeof document === "undefined" || document.body === null) return FALLBACK;

  const probe = document.createElement("div");
  probe.style.cssText =
    `position:absolute;top:0;left:0;width:1px;height:${PROBE_HEIGHT}px;` +
    "visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();

  measured =
    Number.isFinite(height) && height > 0
      ? Math.floor(Math.min(height, PROBE_HEIGHT) * MARGIN)
      : FALLBACK;
  return measured;
}
