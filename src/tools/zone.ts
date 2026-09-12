/**
 * What a tool asks the application to draw.
 *
 * A tool's model is thousands of nodes; the handful of ranges worth drawing is
 * all that crosses the seam. A zone is one of those: a named range the shell
 * can mark in the minimap's margin, offer in the dump's right-click menu, and
 * put the caret on — without knowing what a volume or a FIT row is.
 *
 * Ids are the tool's own and are stable across a re-read, which is what lets a
 * zone survive being written down: the panel publishes a fresh map after every
 * edit, and the focus still names the same thing.
 */

export interface Zone {
  readonly id: string;
  readonly name: string;
  /** Half-open `[start, end)`, the application's convention throughout. */
  readonly start: number;
  readonly end: number;
}

export interface ZoneMap {
  readonly zones: readonly Zone[];
  /** The one the panel is looking at, drawn louder than the rest. */
  readonly focus: string | undefined;
}

export const EMPTY_ZONES: ZoneMap = { zones: [], focus: undefined };

/**
 * The zones covering `offset`, innermost last.
 *
 * Zones nest — a FIT table, the row in it, the microcode a row points at — so
 * a byte is often inside several, and the smallest is the one a click is
 * aiming at.
 */
export function zonesContaining(map: ZoneMap, offset: number): Zone[] {
  return map.zones
    .filter((zone) => offset >= zone.start && offset < zone.end)
    .sort((left, right) => right.end - right.start - (left.end - left.start));
}
