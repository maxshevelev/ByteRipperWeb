import type { DiffBlockIndex } from "@/core/diff/diffBlock";

/**
 * Difference *hunks* — the unit Next and Previous Difference step through.
 *
 * Ported from `DiffHunkIndex.swift`. The block index is byte-exact: where
 * differing bytes alternate with matching ones — a rewritten NVRAM region, a
 * config area with a few flipped bits — it holds a block per byte, and stepping
 * through those costs one keypress per byte. A hunk merges difference blocks
 * separated by a matching run shorter than `gap`, so one press lands on the
 * next *significant* change.
 *
 * The merge is by distance only, never on the 16-byte row grid. Row grouping
 * would make the threshold depend on where the differing bytes fall inside a
 * row: differences at 0x00 and 0x1F, thirty matching bytes apart, share two
 * adjacent rows and would merge, while differences at 0x0F and 0x20, sixteen
 * bytes apart, are split by a clean row and would not. Distance is
 * phase-independent — the same spacing always groups the same way.
 *
 * A hunk's bounds are its first and last *differing* byte. The matching runs it
 * swallowed sit inside it, so navigation never lands on a byte that is not a
 * difference.
 *
 * This is navigation only. Highlighting stays per byte and the block index
 * keeps its byte-exact meaning; the hunks are derived from it.
 */

export interface HunkRange {
  readonly start: number;
  readonly end: number;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex */
export class DiffHunkIndex {
  /**
   * The shortest matching run that still separates two hunks: a run of
   * `gap - 1` bytes or fewer is swallowed. A gap of 1 or less merges nothing —
   * blocks always have at least one matching byte between them — which
   * reproduces byte-exact block navigation.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.gap
   */
  readonly gap: number;
  /**
   * The comparison's extent: the longer file's length.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.extent
   */
  readonly extent: number;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.hunks */
  readonly hunks: readonly HunkRange[];

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.init */
  constructor(hunks: readonly HunkRange[], gap: number, extent: number) {
    this.hunks = hunks;
    this.gap = gap;
    this.extent = extent;
  }

  /**
   * Groups an index's difference blocks. One linear pass.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.init
   */
  static from(index: DiffBlockIndex, gap: number): DiffHunkIndex {
    const merged: { start: number; end: number }[] = [];
    for (let i = 0; i < index.blockCount; i++) {
      const block = index.block(i);
      if (block === undefined || block.kind !== "different") continue;
      const last = merged[merged.length - 1];
      if (last !== undefined && block.start - last.end < gap) last.end = block.end;
      else merged.push({ start: block.start, end: block.end });
    }
    return new DiffHunkIndex(merged, gap, index.maxSize);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.isEmpty */
  get isEmpty(): boolean {
    return this.hunks.length === 0;
  }

  get count(): number {
    return this.hunks.length;
  }

  /**
   * The first hunk starting strictly after `offset`.
   *
   * A caret inside a hunk — including inside a matching run the hunk swallowed
   * — therefore lands on the *next* hunk rather than on a fragment of this one.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.nextDifference
   */
  nextDifference(offset: number): HunkRange | undefined {
    const index = this.firstHunkStartAfter(offset);
    return index === undefined ? undefined : this.hunks[index];
  }

  /**
   * The last hunk ending at or before `offset`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.previousDifference
   */
  previousDifference(offset: number): HunkRange | undefined {
    const index = this.lastHunkEndAtOrBefore(offset);
    return index === undefined ? undefined : this.hunks[index];
  }

  /**
   * The first matching run starting strictly after `offset`.
   *
   * The runs that count are the ones *between* hunks, plus the file's leading
   * and trailing runs. The short runs a hunk swallowed are inside a difference
   * and are not navigation targets — otherwise Next Same Block would land in
   * the middle of what Next Difference treats as one change.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.nextSame
   */
  nextSame(offset: number): HunkRange | undefined {
    // Every candidate run starts where a hunk ends; the leading run starts at
    // 0, which is never strictly after an offset.
    const index = this.firstHunkEndAfter(offset);
    return index === undefined ? undefined : this.matchingRunAfter(index);
  }

  /**
   * The last matching run ending at or before `offset`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffHunkIndex.swift#DiffHunkIndex.previousSame
   */
  previousSame(offset: number): HunkRange | undefined {
    if (this.hunks.length === 0) {
      // No differences at all: the extent is one matching run.
      return this.extent > 0 && this.extent <= offset ? { start: 0, end: this.extent } : undefined;
    }

    // The trailing run is the only one ending at the extent, so it wins
    // whenever the caret sits at or past EOF.
    const last = this.hunks[this.hunks.length - 1];
    if (last !== undefined && last.end < this.extent && this.extent <= offset) {
      return { start: last.end, end: this.extent };
    }

    // Otherwise it is the run in front of the last hunk starting at or before
    // `offset`: that run ends at the hunk's start, and every later run ends
    // after `offset`.
    const index = this.lastHunkStartAtOrBefore(offset);
    return index === undefined ? undefined : this.matchingRunAfter(index - 1);
  }

  /**
   * The matching run between hunk `index` and the next one. `-1` asks for the
   * run before the first hunk, and the last index for the one after the last.
   *
   * The leading and trailing runs can be shorter than `gap`: nothing was merged
   * across them, they are simply what is left at the file's edges.
   */
  private matchingRunAfter(index: number): HunkRange | undefined {
    const start = index < 0 ? 0 : (this.hunks[index]?.end ?? 0);
    const next = this.hunks[index + 1];
    const end = next === undefined ? this.extent : next.start;
    return start < end ? { start, end } : undefined;
  }

  // MARK: - Binary-search anchors

  private firstHunkStartAfter(offset: number): number | undefined {
    let low = 0;
    let high = this.hunks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.hunks[mid]?.start ?? 0) <= offset) low = mid + 1;
      else high = mid;
    }
    return low < this.hunks.length ? low : undefined;
  }

  private lastHunkStartAtOrBefore(offset: number): number | undefined {
    const first = this.firstHunkStartAfter(offset);
    if (first === undefined) return this.hunks.length === 0 ? undefined : this.hunks.length - 1;
    return first > 0 ? first - 1 : undefined;
  }

  private firstHunkEndAfter(offset: number): number | undefined {
    let low = 0;
    let high = this.hunks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.hunks[mid]?.end ?? 0) <= offset) low = mid + 1;
      else high = mid;
    }
    return low < this.hunks.length ? low : undefined;
  }

  private lastHunkEndAtOrBefore(offset: number): number | undefined {
    const first = this.firstHunkEndAfter(offset);
    if (first === undefined) return this.hunks.length === 0 ? undefined : this.hunks.length - 1;
    return first > 0 ? first - 1 : undefined;
  }
}
