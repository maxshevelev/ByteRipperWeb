import { DEFAULT_MAX_RESULTS } from "@/core/search/searchEngine";
import type { CaseFolding, SearchPattern } from "@/core/search/searchPattern";

/**
 * Where every occurrence of one pattern is, in one file.
 *
 * Ported from `MatchSet.swift`. Activating a search scans the whole file, and
 * that one scan is the single source for everything downstream: the dump's
 * greys, the find indicator, Find Next (an index step, not a fresh scan), the
 * count in the find bar, the results panel. They cannot disagree, because they
 * all read this.
 *
 * A match is one number — its start — because every match is the pattern's
 * length. How those numbers are held follows their density, and the
 * representation is what keeps the set exact instead of truncated:
 *
 * - **sparse**: the sorted starts. What a signature search produces.
 * - **bitmap**: a bit per offset, `extent / 8` bytes, exact at *any* count.
 *   Taken over from sparse at `extent / 64` matches — where the two cost the
 *   same — so a 16 MB dump costs at most 2 MB whatever the pattern is.
 * - **counted**: the total alone. Only for an image so large that even its
 *   bitmap would not fit the ceiling; the count stays exact, and the app turns
 *   highlighting off and says why rather than showing a partial one.
 *
 * The set knows nothing about which match the caret is on: "3 of 128" is a
 * question about the caret, and the caret belongs to the pane.
 */

export type MatchStorage =
  | { readonly kind: "sparse"; readonly starts: Float64Array }
  | { readonly kind: "bitmap"; readonly bitmap: MatchBitmap }
  | { readonly kind: "counted" };

/** The ceiling on the index itself: 32 MB, which a bitmap reaches at 256 MB. */
export const MAX_INDEX_BYTES = 32 << 20;

export interface MatchStep {
  readonly index: number;
  readonly range: { readonly start: number; readonly end: number };
  /** True when the step came round the end of the file. */
  readonly wrapped: boolean;
}

export class MatchSet {
  readonly pattern: SearchPattern;
  readonly folding: CaseFolding;
  /** The size of the file the scan covered — also the bitmap's bit count. */
  readonly extent: number;
  /**
   * Exact at any count, and the only number the find bar shows. `> 1000` is not
   * a diagnosis: 1001 and 3,000,000 call for different actions.
   */
  readonly total: number;
  readonly storage: MatchStorage;
  /**
   * How much of the file the scan has covered, half-open: every match below it
   * is in here, and nothing above it is known yet.
   *
   * A set is published while it is still being built, because the index is not
   * what shows a user their match — a scan from the caret does that in about a
   * millisecond. So the greys arrive in file order as the scan advances, and
   * the things that need the *whole* file — the total, the wrap, an ordinal —
   * wait for {@link isComplete}.
   */
  readonly indexedUpTo: number;

  constructor(
    pattern: SearchPattern,
    folding: CaseFolding,
    extent: number,
    total: number,
    storage: MatchStorage,
    indexedUpTo: number
  ) {
    this.pattern = pattern;
    this.folding = folding;
    this.extent = extent;
    this.total = total;
    this.storage = storage;
    this.indexedUpTo = Math.min(indexedUpTo, extent);
  }

  /** From starts already in hand — tests, and a worker's reply. */
  static of(
    pattern: SearchPattern,
    folding: CaseFolding,
    extent: number,
    starts: readonly number[],
    indexedUpTo?: number
  ): MatchSet {
    const builder = new MatchSetBuilder(pattern, folding, extent);
    builder.add(starts);
    return builder.snapshot(indexedUpTo ?? extent);
  }

  /** Whether the scan reached the end. Only then is `total` the whole answer. */
  get isComplete(): boolean {
    return this.indexedUpTo >= this.extent;
  }

  get patternLength(): number {
    return Math.max(this.pattern.bytes.length, 1);
  }

  get isEmpty(): boolean {
    return this.total === 0;
  }

  /** Whether the matches can be pointed at — false only for a counted set. */
  get isHighlightable(): boolean {
    return this.storage.kind !== "counted" && this.total > 0;
  }

  /**
   * Whether the results panel should list them. Past the limit a list of four
   * thousand rows impersonates a tool, so the panel states the count instead.
   */
  get isListable(): boolean {
    return this.total > 0 && this.total <= DEFAULT_MAX_RESULTS;
  }

  /**
   * The matches overlapping `[start, end)`, in file order.
   *
   * A match starting *before* the range can still reach into it, so the lookup
   * begins `patternLength - 1` earlier — which is what makes a match straddling
   * the top of a drawn row range highlighted rather than half-drawn.
   */
  matchesIntersecting(start: number, end: number): { start: number; end: number }[] {
    if (end <= start || this.total === 0) return [];
    const length = this.patternLength;
    const from = Math.max(0, start - (length - 1));
    const result: { start: number; end: number }[] = [];

    if (this.storage.kind === "counted") return [];
    if (this.storage.kind === "sparse") {
      const starts = this.storage.starts;
      for (let i = firstIndexAtOrAfter(starts, this.total, from); i < this.total; i++) {
        const at = starts[i] ?? 0;
        if (at >= end) break;
        result.push({ start: at, end: at + length });
      }
      return result;
    }

    let at = this.storage.bitmap.firstSetAtOrAfter(from);
    while (at !== undefined && at < end) {
      result.push({ start: at, end: at + length });
      at = at + 1 < this.extent ? this.storage.bitmap.firstSetAtOrAfter(at + 1) : undefined;
    }
    return result;
  }

  /**
   * One step through the set: the next match from `offset`, wrapping at the
   * ends, and whether it had to wrap.
   *
   * Both directions and the wrap belong here rather than to a caller. A step
   * past the last match is the first match again — the *set* is what knows that
   * is what happened, and a view working it out from a nothing would work it
   * out twice, once per direction.
   */
  step(direction: "forward" | "backward", offset: number): MatchStep | undefined {
    if (!this.isHighlightable) return undefined;
    const found = direction === "forward" ? this.indexAtOrAfter(offset) : this.indexBefore(offset);
    const target = found ?? (direction === "forward" ? 0 : this.total - 1);
    const range = this.rangeAt(target);
    if (range === undefined) return undefined;
    return { index: target, range, wrapped: found === undefined };
  }

  /**
   * Replaces the matches starting in `[start, end)` with `starts`, which the
   * caller found by rescanning that range.
   *
   * For an overwrite — where no byte moves — this is the whole update: only
   * matches touching the edited bytes can appear or vanish, so the caller
   * widens the edited range by `patternLength - 1` either side and rescans that
   * much.
   *
   * Returns `undefined` when the set cannot be updated in place, which is the
   * caller's signal to rescan the file instead.
   */
  splice(starts: readonly number[], start: number, end: number): MatchSet | undefined {
    if (this.storage.kind === "counted") return undefined;

    if (this.storage.kind === "sparse") {
      const existing = this.storage.starts;
      const first = firstIndexAtOrAfter(existing, this.total, start);
      const last = firstIndexAtOrAfter(existing, this.total, end);
      const kept = [
        ...Array.from(existing.subarray(0, first)),
        ...starts,
        ...Array.from(existing.subarray(last, this.total)),
      ];
      return new MatchSet(
        this.pattern,
        this.folding,
        this.extent,
        kept.length,
        { kind: "sparse", starts: Float64Array.from(kept) },
        this.indexedUpTo
      );
    }

    const bitmap = this.storage.bitmap;
    bitmap.clearIn(start, end);
    for (const at of starts) bitmap.set(at);
    bitmap.sealRanks();
    return new MatchSet(
      this.pattern,
      this.folding,
      this.extent,
      bitmap.total,
      { kind: "bitmap", bitmap },
      this.indexedUpTo
    );
  }

  /** The `index`-th match's start. */
  startAt(index: number): number | undefined {
    if (index < 0 || index >= this.total) return undefined;
    if (this.storage.kind === "counted") return undefined;
    if (this.storage.kind === "sparse") return this.storage.starts[index];
    return this.storage.bitmap.select(index);
  }

  rangeAt(index: number): { start: number; end: number } | undefined {
    const start = this.startAt(index);
    return start === undefined ? undefined : { start, end: start + this.patternLength };
  }

  /** The ordinal of the match starting exactly at `offset` — the "3" in "3 of 128". */
  indexStartingAt(offset: number): number | undefined {
    if (this.storage.kind === "counted") return undefined;
    if (this.storage.kind === "sparse") {
      const i = firstIndexAtOrAfter(this.storage.starts, this.total, offset);
      return i < this.total && this.storage.starts[i] === offset ? i : undefined;
    }
    if (!this.storage.bitmap.contains(offset)) return undefined;
    return this.storage.bitmap.countBefore(offset);
  }

  /** The first match at or after `offset` — where Find Next lands. */
  indexAtOrAfter(offset: number): number | undefined {
    if (this.storage.kind === "counted") return undefined;
    if (this.storage.kind === "sparse") {
      const i = firstIndexAtOrAfter(this.storage.starts, this.total, offset);
      return i < this.total ? i : undefined;
    }
    const start = this.storage.bitmap.firstSetAtOrAfter(offset);
    return start === undefined ? undefined : this.storage.bitmap.countBefore(start);
  }

  /** The last match strictly before `offset` — where Find Previous lands. */
  indexBefore(offset: number): number | undefined {
    if (this.storage.kind === "counted") return undefined;
    if (this.storage.kind === "sparse") {
      const i = firstIndexAtOrAfter(this.storage.starts, this.total, offset);
      return i > 0 ? i - 1 : undefined;
    }
    const start = this.storage.bitmap.lastSetBefore(offset);
    return start === undefined ? undefined : this.storage.bitmap.countBefore(start);
  }
}

/** The first index whose value is at least `value`, in a sorted prefix. */
function firstIndexAtOrAfter(starts: Float64Array, count: number, value: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((starts[mid] ?? 0) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * A bit per byte offset, set where a match starts, with a block rank table so
 * "which match is this" stays a lookup rather than a walk.
 *
 * This is what makes an uncapped highlight affordable: a pattern occurring at a
 * third of a file's offsets costs the same as one occurring once. The rank
 * table adds four bytes per 4096 bits — a tenth of a per cent.
 */
export class MatchBitmap {
  static readonly bitsPerBlock = 4096;
  static readonly wordsPerBlock = MatchBitmap.bitsPerBlock / 32;

  readonly bitCount: number;
  /**
   * 32-bit words, not 64. JavaScript's bitwise operators are defined on 32-bit
   * integers, so a 64-bit word would mean `bigint` arithmetic in the innermost
   * loop of the whole feature.
   */
  private readonly words: Uint32Array;
  /** Set bits before each block. Empty until {@link sealRanks}. */
  private ranks: Int32Array = new Int32Array(0);
  private count = 0;

  constructor(bitCount: number) {
    this.bitCount = bitCount;
    this.words = new Uint32Array(Math.ceil(bitCount / 32));
  }

  /**
   * The raw words, for sending a bitmap across a worker boundary.
   *
   * Rebuilding one from a list of four million starts on the other side would
   * cost more than finding them did, so the representation travels as it is.
   */
  get rawWords(): Uint32Array {
    return this.words;
  }

  /** A bitmap over words that came from elsewhere — the other end of that trip. */
  static fromWords(bitCount: number, words: Uint32Array): MatchBitmap {
    const bitmap = new MatchBitmap(bitCount);
    bitmap.words.set(words.subarray(0, bitmap.words.length));
    bitmap.sealRanks();
    return bitmap;
  }

  /** What a bitmap over `bitCount` offsets costs, rank table included. */
  static byteCost(bitCount: number): number {
    const words = Math.ceil(bitCount / 32);
    const blocks = Math.ceil(words / MatchBitmap.wordsPerBlock);
    return words * 4 + blocks * 4;
  }

  get total(): number {
    return this.count;
  }

  set(offset: number): void {
    if (offset < 0 || offset >= this.bitCount) return;
    const word = offset >>> 5;
    const bit = 1 << (offset & 31);
    if (((this.words[word] ?? 0) & bit) !== 0) return;
    this.words[word] = (this.words[word] ?? 0) | bit;
    this.count++;
  }

  contains(offset: number): boolean {
    if (offset < 0 || offset >= this.bitCount) return false;
    return (((this.words[offset >>> 5] ?? 0) >>> (offset & 31)) & 1) === 1;
  }

  /** Clears every bit in `[start, end)` — the first half of splicing. */
  clearIn(start: number, end: number): void {
    for (let offset = Math.max(0, start); offset < Math.min(end, this.bitCount); offset++) {
      const word = offset >>> 5;
      const bit = 1 << (offset & 31);
      if (((this.words[word] ?? 0) & bit) !== 0) {
        this.words[word] = (this.words[word] ?? 0) & ~bit;
        this.count--;
      }
    }
  }

  /** Builds the rank table: one pass over the words. */
  sealRanks(): void {
    const blocks = Math.max(1, Math.ceil(this.words.length / MatchBitmap.wordsPerBlock));
    const ranks = new Int32Array(blocks);
    let running = 0;
    for (let block = 0; block < blocks; block++) {
      ranks[block] = running;
      const start = block * MatchBitmap.wordsPerBlock;
      const end = Math.min(start + MatchBitmap.wordsPerBlock, this.words.length);
      for (let word = start; word < end; word++) running += popcount(this.words[word] ?? 0);
    }
    this.ranks = ranks;
    this.count = running;
  }

  /** How many matches start before `offset` — the ordinal lookup. */
  countBefore(offset: number): number {
    const limit = Math.min(offset, this.bitCount);
    if (limit <= 0) return 0;

    const lastWord = (limit - 1) >>> 5;
    const block = Math.floor(lastWord / MatchBitmap.wordsPerBlock);
    let count = this.ranks[block] ?? 0;
    for (let word = block * MatchBitmap.wordsPerBlock; word < lastWord; word++) {
      count += popcount(this.words[word] ?? 0);
    }
    const bitsInLast = limit - lastWord * 32;
    if (bitsInLast > 0) {
      const mask = bitsInLast >= 32 ? 0xffffffff : (1 << bitsInLast) - 1;
      count += popcount((this.words[lastWord] ?? 0) & mask);
    }
    return count;
  }

  firstSetAtOrAfter(offset: number): number | undefined {
    if (offset >= this.bitCount) return undefined;
    let word = Math.max(0, offset) >>> 5;
    let current = (this.words[word] ?? 0) & (0xffffffff << (Math.max(0, offset) & 31));
    for (;;) {
      if (current !== 0) {
        const bit = word * 32 + trailingZeros(current);
        return bit < this.bitCount ? bit : undefined;
      }
      word++;
      if (word >= this.words.length) return undefined;
      current = this.words[word] ?? 0;
    }
  }

  lastSetBefore(offset: number): number | undefined {
    const limit = Math.min(offset, this.bitCount);
    if (limit <= 0) return undefined;

    let word = (limit - 1) >>> 5;
    const bitsInLast = limit - word * 32;
    const mask = bitsInLast >= 32 ? 0xffffffff : (1 << bitsInLast) - 1;
    let current = (this.words[word] ?? 0) & mask;
    for (;;) {
      if (current !== 0) return word * 32 + (31 - leadingZeros(current));
      if (word === 0) return undefined;
      word--;
      current = this.words[word] ?? 0;
    }
  }

  /** The `index`-th set bit: the rank table narrows it to one block. */
  select(index: number): number | undefined {
    if (index < 0 || index >= this.count) return undefined;

    let low = 0;
    let high = this.ranks.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.ranks[mid] ?? 0) <= index) low = mid;
      else high = mid - 1;
    }

    let remaining = index - (this.ranks[low] ?? 0);
    let word = low * MatchBitmap.wordsPerBlock;
    while (word < this.words.length) {
      const bits = popcount(this.words[word] ?? 0);
      if (remaining < bits) break;
      remaining -= bits;
      word++;
    }
    if (word >= this.words.length) return undefined;

    let value = this.words[word] ?? 0;
    for (let i = 0; i < remaining; i++) value &= value - 1;
    return word * 32 + trailingZeros(value);
  }
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const trailingZeros = (value: number): number => 31 - Math.clz32(value & -value);
const leadingZeros = (value: number): number => Math.clz32(value);

/**
 * Accumulates a set from a scan, changing representation as the density demands
 * and giving up the positions — never the count — when even a bitmap would not
 * fit.
 *
 * Fed in batches: a scan delivers a window's matches at once, because a million
 * separate hand-overs cost more than finding them did.
 */
export class MatchSetBuilder {
  private readonly pattern: SearchPattern;
  private readonly folding: CaseFolding;
  private readonly extent: number;
  private readonly maxIndexBytes: number;
  /** The count at which a sparse list costs more than the bitmap would. */
  private readonly sparseLimit: number;

  private sparse: number[] = [];
  private bitmap: MatchBitmap | undefined;
  private counted = false;
  private count = 0;

  constructor(
    pattern: SearchPattern,
    folding: CaseFolding,
    extent: number,
    maxIndexBytes = MAX_INDEX_BYTES
  ) {
    this.pattern = pattern;
    this.folding = folding;
    this.extent = extent;
    this.maxIndexBytes = maxIndexBytes;
    this.sparseLimit = Math.max(Math.floor(extent / 64), 1);
  }

  add(starts: readonly number[]): void {
    if (starts.length === 0) return;
    this.count += starts.length;

    if (this.counted) return;
    if (this.bitmap !== undefined) {
      for (const start of starts) this.bitmap.set(start);
      return;
    }
    if (this.sparse.length + starts.length <= this.sparseLimit) {
      this.sparse.push(...starts);
      return;
    }

    // Past what a bitmap would cost. Convert if it fits the ceiling; otherwise
    // the positions go and the count carries on alone.
    if (MatchBitmap.byteCost(this.extent) > this.maxIndexBytes) {
      this.counted = true;
      this.sparse = [];
      return;
    }
    const bitmap = new MatchBitmap(this.extent);
    for (const start of this.sparse) bitmap.set(start);
    for (const start of starts) bitmap.set(start);
    this.sparse = [];
    this.bitmap = bitmap;
  }

  finish(): MatchSet {
    return this.snapshot(this.extent);
  }

  /**
   * The set as it stands, covering the file up to `indexedUpTo` — what a
   * still-running scan publishes so the dump can grey what is known.
   */
  snapshot(indexedUpTo: number): MatchSet {
    let storage: MatchStorage;
    if (this.counted) {
      storage = { kind: "counted" };
    } else if (this.bitmap !== undefined) {
      this.bitmap.sealRanks();
      storage = { kind: "bitmap", bitmap: this.bitmap };
    } else {
      storage = { kind: "sparse", starts: Float64Array.from(this.sparse) };
    }
    return new MatchSet(
      this.pattern,
      this.folding,
      this.extent,
      this.count,
      storage,
      Math.min(indexedUpTo, this.extent)
    );
  }
}
