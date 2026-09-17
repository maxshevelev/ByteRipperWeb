/**
 * The comparison, as blocks.
 *
 * Ported from `DiffBlock.swift`. Comparison is strictly by absolute zero-based
 * offset — no block matching, no alignment, ever. The blocks partition
 * `[0, maxSize)` into alternating runs of same and different, and the bytes
 * only the longer file has (the shorter one is past EOF) fold into a different
 * block.
 *
 * **The storage diverges from upstream, deliberately.** Swift holds an array of
 * `DiffBlock` structs; here that would be an array of JavaScript objects, and
 * upstream already records the case that makes it untenable — two very
 * different large files produce a block per byte, and millions of objects is
 * hundreds of megabytes plus the garbage collector's attention. The blocks are
 * held as three parallel typed arrays instead: seventeen bytes a block rather
 * than fifty-odd, no object headers, and every query below is the same binary
 * search it is upstream. {@link DiffBlockIndex.blocks} materialises objects for
 * the callers that want them, which is tests and nothing on a hot path.
 */

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlock.Kind */
export type DiffKind = "same" | "different";

/**
 * A maximal contiguous run of offsets where two files have the same state.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlock
 */
export interface DiffBlock {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlock.kind */
  readonly kind: DiffKind;
  /**
   * Half-open `[start, end)`, in absolute offsets (D13).
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlock.range
   */
  readonly start: number;
  readonly end: number;
}

const SAME = 0;
const DIFFERENT = 1;

/**
 * Accumulates maximal runs, merging a new run into the last when they share a
 * kind and touch.
 *
 * Ported from upstream's `BlockBuilder`. Plain number arrays while building —
 * V8 stores those unboxed — and typed arrays once the length is known.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.coalesced
 * @upstream-differs adjacent runs merge as they are appended, instead of over a finished list
 */
export class DiffBlockBuilder {
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly kinds: number[] = [];

  appendRun(kind: DiffKind, start: number, end: number): void {
    if (start >= end) return;
    const last = this.kinds.length - 1;
    if (last >= 0 && this.kinds[last] === kindCode(kind) && this.ends[last] === start) {
      this.ends[last] = end;
      return;
    }
    this.starts.push(start);
    this.ends.push(end);
    this.kinds.push(kindCode(kind));
  }

  /** Appends a whole block, for splicing an old index's untouched parts back. */
  append(block: DiffBlock): void {
    this.appendRun(block.kind, block.start, block.end);
  }

  get count(): number {
    return this.kinds.length;
  }

  finish(leftSize: number, rightSize: number): DiffBlockIndex {
    return DiffBlockIndex.fromColumns(
      leftSize,
      rightSize,
      Float64Array.from(this.starts),
      Float64Array.from(this.ends),
      Uint8Array.from(this.kinds)
    );
  }
}

const kindCode = (kind: DiffKind): number => (kind === "same" ? SAME : DIFFERENT);
const kindOf = (code: number): DiffKind => (code === SAME ? "same" : "different");

/**
 * An immutable snapshot of the comparison between two byte streams.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex
 */
export class DiffBlockIndex {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.leftSize */
  readonly leftSize: number;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.rightSize */
  readonly rightSize: number;

  private readonly starts: Float64Array;
  private readonly ends: Float64Array;
  private readonly kinds: Uint8Array;

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.init */
  private constructor(
    leftSize: number,
    rightSize: number,
    starts: Float64Array,
    ends: Float64Array,
    kinds: Uint8Array
  ) {
    this.leftSize = leftSize;
    this.rightSize = rightSize;
    this.starts = starts;
    this.ends = ends;
    this.kinds = kinds;
  }

  /** From already-coalesced columns — what the builder produces. */
  static fromColumns(
    leftSize: number,
    rightSize: number,
    starts: Float64Array,
    ends: Float64Array,
    kinds: Uint8Array
  ): DiffBlockIndex {
    return new DiffBlockIndex(leftSize, rightSize, starts, ends, kinds);
  }

  /** From a block list, coalescing adjacent blocks that share a kind and touch. */
  static of(leftSize: number, rightSize: number, blocks: readonly DiffBlock[]): DiffBlockIndex {
    const builder = new DiffBlockBuilder();
    for (const block of blocks) builder.append(block);
    return builder.finish(leftSize, rightSize);
  }

  /** An index over two files that have not been compared yet. */
  static empty(leftSize = 0, rightSize = 0): DiffBlockIndex {
    return DiffBlockIndex.of(leftSize, rightSize, []);
  }

  /**
   * The longer file's length — the extent of the comparison.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.maxSize
   */
  get maxSize(): number {
    return Math.max(this.leftSize, this.rightSize);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.isEmpty */
  get isEmpty(): boolean {
    return this.kinds.length === 0;
  }

  get blockCount(): number {
    return this.kinds.length;
  }

  /**
   * True when there is at least one different block. O(1): coalesced blocks
   * alternate kinds, so two or more blocks guarantee a difference, and a single
   * block is one only if it is different.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.hasDifferences
   */
  get hasDifferences(): boolean {
    if (this.kinds.length === 0) return false;
    if (this.kinds.length === 1) return this.kinds[0] === DIFFERENT;
    return true;
  }

  /**
   * How many offsets differ between the two files, an EOF-only tail included —
   * the figure the panes' readout takes its share out of (§14.4).
   *
   * @web-only upstream writes the same sum as the reduce in
   * `ComparisonSummary.init(index:)`, over `index.blocks`; the index holds its
   * three columns flat, so it is one pass here and builds no block objects.
   * The share itself is `comparisonSummary()` in
   * `src/core/diff/comparisonSummary.ts`.
   */
  get differingBytes(): number {
    let differing = 0;
    for (let i = 0; i < this.kinds.length; i++) {
      if (this.kinds[i] === DIFFERENT) differing += (this.ends[i] ?? 0) - (this.starts[i] ?? 0);
    }
    return differing;
  }

  block(index: number): DiffBlock | undefined {
    if (index < 0 || index >= this.kinds.length) return undefined;
    return {
      kind: kindOf(this.kinds[index] ?? SAME),
      start: this.starts[index] ?? 0,
      end: this.ends[index] ?? 0,
    };
  }

  /**
   * Every block as an object. For tests and diagnostics, never a hot path.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.blocks
   */
  get blocks(): DiffBlock[] {
    const result: DiffBlock[] = [];
    for (let i = 0; i < this.kinds.length; i++) {
      const block = this.block(i);
      if (block !== undefined) result.push(block);
    }
    return result;
  }

  /**
   * The state at an offset, or `undefined` at or past the longer file's EOF.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.state
   */
  stateAt(offset: number): DiffKind | undefined {
    let low = 0;
    let high = this.kinds.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (offset < (this.starts[mid] ?? 0)) high = mid - 1;
      else if (offset >= (this.ends[mid] ?? 0)) low = mid + 1;
      else return kindOf(this.kinds[mid] ?? SAME);
    }
    return undefined;
  }

  /**
   * The blocks intersecting `[start, end)`, found by binary search.
   *
   * Consumers that only care about a window — the renderer painting a screen,
   * the minimap computing a few rows — must not flatten the whole index to get
   * at it. Upstream measured building the full difference list on every
   * keystroke at a third of the main thread on a 16 MB comparison.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.blocks
   */
  blocksIn(start: number, end: number): DiffBlock[] {
    if (this.kinds.length === 0 || start >= end) return [];

    // The first block whose end is past the window's start.
    let low = 0;
    let high = this.kinds.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.ends[mid] ?? 0) <= start) low = mid + 1;
      else high = mid;
    }
    const first = low;
    if (first >= this.kinds.length || (this.starts[first] ?? 0) >= end) return [];

    const result: DiffBlock[] = [];
    for (let i = first; i < this.kinds.length && (this.starts[i] ?? 0) < end; i++) {
      const block = this.block(i);
      if (block !== undefined) result.push(block);
    }
    return result;
  }

  // MARK: - Navigation

  /**
   * The first block starting strictly after `offset`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.firstBlock
   */
  firstBlockAfter(offset: number): DiffBlock | undefined {
    const index = this.firstBlockStartAfter(offset);
    return index === undefined ? undefined : this.block(index);
  }

  /**
   * The last block ending at or before `offset`.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.firstBlock
   */
  lastBlockAtOrBefore(offset: number): DiffBlock | undefined {
    const index = this.lastBlockEndAtOrBefore(offset);
    return index === undefined ? undefined : this.block(index);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.nextDifference */
  nextDifference(offset: number): DiffBlock | undefined {
    return this.nextOfKind(offset, DIFFERENT);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.previousDifference */
  previousDifference(offset: number): DiffBlock | undefined {
    return this.previousOfKind(offset, DIFFERENT);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.nextSame */
  nextSame(offset: number): DiffBlock | undefined {
    return this.nextOfKind(offset, SAME);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/DiffBlock.swift#DiffBlockIndex.previousSame */
  previousSame(offset: number): DiffBlock | undefined {
    return this.previousOfKind(offset, SAME);
  }

  /**
   * Blocks alternate kinds, so the wanted one is the next block or the one
   * after it — never further.
   */
  private nextOfKind(offset: number, code: number): DiffBlock | undefined {
    const index = this.firstBlockStartAfter(offset);
    if (index === undefined) return undefined;
    if (this.kinds[index] === code) return this.block(index);
    const next = index + 1;
    if (next >= this.kinds.length || this.kinds[next] !== code) return undefined;
    return this.block(next);
  }

  private previousOfKind(offset: number, code: number): DiffBlock | undefined {
    const index = this.lastBlockEndAtOrBefore(offset);
    if (index === undefined) return undefined;
    if (this.kinds[index] === code) return this.block(index);
    const previous = index - 1;
    if (previous < 0 || this.kinds[previous] !== code) return undefined;
    return this.block(previous);
  }

  /**
   * The first block starting strictly after `offset`, by binary search.
   *
   * The navigation queries used to scan linearly upstream, and a pair of very
   * different large files made every caret move re-scan millions of blocks —
   * drag selection froze the moment indexing finished.
   */
  private firstBlockStartAfter(offset: number): number | undefined {
    let low = 0;
    let high = this.kinds.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) low = mid + 1;
      else high = mid;
    }
    return low < this.kinds.length ? low : undefined;
  }

  /** The last block ending at or before `offset`. */
  private lastBlockEndAtOrBefore(offset: number): number | undefined {
    let low = 0;
    let high = this.kinds.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((this.ends[mid] ?? 0) <= offset) low = mid + 1;
      else high = mid;
    }
    return low - 1 >= 0 ? low - 1 : undefined;
  }
}
