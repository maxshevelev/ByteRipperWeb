/**
 * Which rows still need painting.
 *
 * The rule from CLAUDE.md is that the grid repaints dirty regions only, and
 * that when drawing lags the fix is what is repainted rather than a cache of
 * what was painted. This is the bookkeeping that makes the first half possible,
 * kept pure so the rule can be tested without a canvas.
 *
 * Rows are held as merged half-open ranges rather than a set of indices,
 * because the ranges that actually arrive are runs — a scroll exposes a band, an
 * edit dirties a span, a selection change dirties what it covered and what it
 * now covers. A set would hold a million entries for a file that has a million
 * rows and one that is visible.
 */

export interface RowRange {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

export class DirtyRows {
  private ranges: RowRange[] = [];

  /** Marks `[start, end)` as needing paint. */
  invalidate(start: number, end: number): void {
    const from = Math.max(0, Math.floor(start));
    const to = Math.max(from, Math.ceil(end));
    if (to <= from) return;

    this.ranges.push({ start: from, end: to });
    this.ranges.sort((a, b) => a.start - b.start);

    const merged: RowRange[] = [];
    for (const range of this.ranges) {
      const last = merged[merged.length - 1];
      // Touching counts as overlapping: two adjacent bands are one band, and
      // leaving them apart would mean two blits where one would do.
      if (last !== undefined && range.start <= last.end) {
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      } else {
        merged.push(range);
      }
    }
    this.ranges = merged;
  }

  /** Marks a single row. */
  invalidateRow(row: number): void {
    this.invalidate(row, row + 1);
  }

  /** True when nothing needs painting. */
  get isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  /**
   * The dirty runs inside `[first, end)` — what a draw actually paints. Rows
   * outside the viewport stay dirty: they were never painted, so forgetting
   * them would leave them stale when they scroll back in.
   */
  within(first: number, end: number): RowRange[] {
    const result: RowRange[] = [];
    for (const range of this.ranges) {
      const start = Math.max(range.start, first);
      const finish = Math.min(range.end, end);
      if (start < finish) result.push({ start, end: finish });
    }
    return result;
  }

  /** Forgets `[first, end)` — called with exactly what was just painted. */
  clearWithin(first: number, end: number): void {
    if (end <= first) return;
    const kept: RowRange[] = [];
    for (const range of this.ranges) {
      if (range.end <= first || range.start >= end) {
        kept.push(range);
        continue;
      }
      if (range.start < first) kept.push({ start: range.start, end: first });
      if (range.end > end) kept.push({ start: end, end: range.end });
    }
    this.ranges = kept;
  }

  clear(): void {
    this.ranges = [];
  }

  /** Every dirty run, for tests and diagnostics. */
  get all(): readonly RowRange[] {
    return this.ranges;
  }
}
