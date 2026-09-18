import type { MatchSet } from "@/core/search/matchSet";
import { OverviewBinning } from "@/render/minimap/overviewBinning";

/**
 * How many matches one overview row is marked from before it has said all it
 * can say at this scale.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.matchOverlay
 */
export const PER_ROW_MARK_LIMIT = 32;

/** Every column of a row marked. */
const FULL_ROW = 0xffff;

/**
 * One map's worth of match bits.
 *
 * Walks the **rows**, not the matches: a two-byte pattern in a dump has hundreds
 * of thousands of occurrences and the overview has a couple of thousand rows,
 * so per-match work is the wrong way round — and on this thread it held the
 * interface for as long as it took. Each row stops early once every column is
 * marked or after {@link PER_ROW_MARK_LIMIT} matches.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.matchOverlay
 * @upstream-differs a row no match reaches is not visited: the walk jumps to the row the next match starts in
 */
export function matchOverlayMarks(
  set: MatchSet | undefined,
  extent: number,
  rowCount: number
): Uint16Array | undefined {
  if (set === undefined || !set.isHighlightable || rowCount <= 0 || extent <= 0) return undefined;
  const binning = new OverviewBinning(extent, rowCount);
  const rows = { from: 0, to: rowCount };
  const length = set.patternLength;
  const reach = Math.max(length - 1, 0);
  const matched = new Uint16Array(rowCount);

  let row = 0;
  while (row < rowCount) {
    const rowStart = binning.startOfRow(row);
    const rowEnd = binning.startOfRow(row + 1);
    if (rowEnd <= rowStart) {
      row++;
      continue;
    }
    // A match starting just above the row can still reach into it.
    let start = set.startAtOrAfter(rowStart > reach ? rowStart - reach : 0);
    if (start === undefined) break;
    if (start >= rowEnd) {
      // Nothing reaches the rows before the one the next match starts in. The
      // row is estimated in floating point, so it steps back one to be sure of
      // never passing the match by.
      const estimate = Math.floor((start * rowCount) / extent);
      row = Math.max(row + 1, estimate - 1);
      continue;
    }

    let marks = 0;
    while (
      start !== undefined &&
      start < rowEnd &&
      marks < PER_ROW_MARK_LIMIT &&
      matched[row] !== FULL_ROW
    ) {
      // The whole row range, not this one row: a match can cross into the next.
      binning.markHexColumns(start, start + length, rows, matched);
      marks++;
      start = set.startAtOrAfter(start + 1);
    }
    row++;
  }
  return matched;
}

/**
 * The row bits for the find indicator alone — one range, so this is what a step
 * of ‹ › costs on the map.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController.currentMatchMarks
 */
export function currentMatchMarks(
  range: { readonly start: number; readonly end: number } | undefined,
  extent: number,
  rowCount: number
): Uint16Array | undefined {
  if (range === undefined || rowCount <= 0 || extent <= 0) return undefined;
  const marks = new Uint16Array(rowCount);
  new OverviewBinning(extent, rowCount).markHexColumns(
    range.start,
    range.end,
    { from: 0, to: rowCount },
    marks
  );
  return marks;
}
