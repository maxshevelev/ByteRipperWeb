import type { CaseFolding } from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * Finding a byte sequence in a storage.
 *
 * Ported from `SearchEngine.swift`. Search reads the *current* storage —
 * unsaved edits included — so a result is always about what is on screen. The
 * scan is chunked with an overlap so a match crossing a boundary is still
 * found, and it takes a cancellation check and a progress report, so a large
 * file is searched without holding anything up.
 */

export const DEFAULT_SEARCH_CHUNK_SIZE = 1024 * 1024;
/** Past this many, a results list stops being a tool and starts being a wall. */
export const DEFAULT_MAX_RESULTS = 1000;

export class SearchCancelled extends Error {
  constructor() {
    super("The search was cancelled.");
    this.name = "SearchCancelled";
  }
}

/** An ASCII letter, folded to lower case; everything else left alone. */
export function foldByte(byte: number): number {
  const lower = byte | 0x20;
  return lower >= 0x61 && lower <= 0x7a ? lower : byte;
}

/**
 * Folds a window in place, under `folding`.
 *
 * In place because the window is the scan's own buffer and nothing else holds
 * it. `exact` has nothing to do, and `utf16` is not a position-independent map
 * at all — a code unit is two bytes counted from the *string's* start, and a
 * string can begin at any offset — so nothing is folded ahead of the search
 * there; candidates are compared one at a time instead.
 */
export function foldInPlace(bytes: Uint8Array, folding: CaseFolding): void {
  if (folding.kind !== "asciiBytes") return;
  for (let i = 0; i < bytes.length; i++) bytes[i] = foldByte(bytes[i] ?? 0);
}

/**
 * Whether two UTF-16 code units are equal, ignoring case.
 *
 * A unit is folded only when it encodes an ASCII letter — when the byte that is
 * *not* the letter is zero. So `A` (`41 00` little-endian) equals `a` (`61 00`),
 * while `U+6100` (`00 61`) equals nothing but itself: the byte that would be
 * the letter is the zero one, and its own high byte is `0x61`, which is data
 * and not a letter.
 */
function unitsEqualIgnoringCase(
  aLow: number,
  aHigh: number,
  bLow: number,
  bHigh: number,
  littleEndian: boolean
): boolean {
  const [aLetter, aOther] = littleEndian ? [aLow, aHigh] : [aHigh, aLow];
  const [bLetter, bOther] = littleEndian ? [bLow, bHigh] : [bHigh, bLow];
  if (aOther !== bOther) return false;
  return aOther === 0 ? foldByte(aLetter) === foldByte(bLetter) : aLetter === bLetter;
}

/**
 * Whether `pattern` matches `data` at `at`, comparing UTF-16 code units taken
 * from `at` itself — which is what makes the match independent of where the
 * string sits in the file. No two-byte grid, no parity.
 */
function utf16MatchesAt(
  pattern: Uint8Array,
  data: Uint8Array,
  at: number,
  littleEndian: boolean
): boolean {
  let p = 0;
  let d = at;
  while (p < pattern.length) {
    // A trailing odd byte cannot be half a code unit: compare it exactly.
    if (p + 1 >= pattern.length || d + 1 >= data.length) return pattern[p] === data[d];
    if (
      !unitsEqualIgnoringCase(
        pattern[p] ?? 0,
        pattern[p + 1] ?? 0,
        data[d] ?? 0,
        data[d + 1] ?? 0,
        littleEndian
      )
    ) {
      return false;
    }
    p += 2;
    d += 2;
  }
  return true;
}

/**
 * The first occurrence of `needle` in `haystack` at or after `from`, or -1.
 *
 * Boyer–Moore–Horspool, with the native `indexOf` used to skip to each
 * candidate first byte. Swift gets this from `Data.range(of:)`; JavaScript has
 * only a single-byte `indexOf` on a typed array, which is exactly the
 * accelerator Horspool wants.
 */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const n = needle.length;
  if (n === 0) return -1;
  if (n === 1) return haystack.indexOf(needle[0] ?? 0, from);
  if (haystack.length < n) return -1;

  // How far the search may jump on a mismatch, by the byte that mismatched.
  const skip = new Uint8Array(256).fill(Math.min(n, 255));
  for (let i = 0; i < n - 1; i++) skip[needle[i] ?? 0] = Math.min(n - 1 - i, 255);

  const first = needle[0] ?? 0;
  const last = n - 1;
  let at = Math.max(0, from);
  const limit = haystack.length - n;

  while (at <= limit) {
    // The native scan for the first byte is far faster than stepping here.
    at = haystack.indexOf(first, at);
    if (at === -1 || at > limit) return -1;

    let i = last;
    while (i > 0 && haystack[at + i] === needle[i]) i--;
    if (i === 0) return at;

    at += skip[haystack[at + last] ?? 0] ?? 1;
  }
  return -1;
}

/** The first match at or after `from` in a window, or -1. */
export function firstMatchIn(
  pattern: Uint8Array,
  data: Uint8Array,
  from: number,
  folding: CaseFolding
): number {
  if (folding.kind !== "utf16") return indexOfBytes(data, pattern, from);
  if (pattern.length === 0 || data.length < pattern.length) return -1;

  // Prefiltered on the pattern's first code unit, so the walk costs one or two
  // byte comparisons an offset rather than a full compare.
  const littleEndian = folding.littleEndian;
  const last = data.length - pattern.length;
  for (let at = Math.max(0, from); at <= last; at++) {
    if (
      !unitsEqualIgnoringCase(
        pattern[0] ?? 0,
        pattern[1] ?? 0,
        data[at] ?? 0,
        data[at + 1] ?? 0,
        littleEndian
      )
    ) {
      continue;
    }
    if (utf16MatchesAt(pattern, data, at, littleEndian)) return at;
  }
  return -1;
}

/** The last match in a window, for the backward scan. */
export function lastMatchIn(pattern: Uint8Array, data: Uint8Array, folding: CaseFolding): number {
  if (pattern.length === 0 || data.length < pattern.length) return -1;

  if (folding.kind !== "utf16") {
    // Horspool has no backwards form worth the code; walking candidates from
    // the end is bounded by the window, which is a chunk.
    for (let at = data.length - pattern.length; at >= 0; at--) {
      let i = 0;
      while (i < pattern.length && data[at + i] === pattern[i]) i++;
      if (i === pattern.length) return at;
    }
    return -1;
  }

  const littleEndian = folding.littleEndian;
  for (let at = data.length - pattern.length; at >= 0; at--) {
    if (utf16MatchesAt(pattern, data, at, littleEndian)) return at;
  }
  return -1;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ScanOptions {
  readonly chunkSize?: number;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (fraction: number) => void;
}

/**
 * The first match at or after `from`, or the last one ending at or before it.
 *
 * This is what shows a user their match: a scan from the caret finds one in
 * about a millisecond, while indexing every occurrence of a common byte takes
 * seconds. The index streams in behind it.
 */
export async function findOne(
  pattern: Uint8Array,
  storage: ByteStorage,
  options: {
    readonly from?: number;
    readonly direction?: "forward" | "backward";
    readonly folding: CaseFolding;
  } & ScanOptions
): Promise<ByteRange | undefined> {
  const size = storage.size;
  const length = pattern.length;
  if (length === 0 || size < length) return undefined;

  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  const folding = options.folding;
  const from = Math.min(Math.max(options.from ?? 0, 0), size);
  const backward = options.direction === "backward";
  // A window overlaps the next by `length - 1`, so a match across the boundary
  // is still whole in one of them.
  const windowLength = chunkSize + length - 1;

  if (!backward) {
    const limit = size - length + 1;
    for (let cursor = Math.min(from, limit); cursor < limit; cursor += chunkSize) {
      if (options.shouldCancel?.() === true) throw new SearchCancelled();
      const window = await readFolded(
        storage,
        cursor,
        Math.min(windowLength, size - cursor),
        folding
      );
      const at = firstMatchIn(pattern, window, 0, folding);
      if (at !== -1) return { start: cursor + at, end: cursor + at + length };
      options.onProgress?.(Math.min((cursor - from) / Math.max(1, size - from), 1));
    }
    return undefined;
  }

  // Backward: windows walk down from `from`, each overlapping the one above it.
  for (let end = from; end > 0; end -= chunkSize) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const cursor = Math.max(0, end - chunkSize - (length - 1));
    const window = await readFolded(storage, cursor, end - cursor, folding);
    const at = lastMatchIn(pattern, window, folding);
    if (at !== -1) return { start: cursor + at, end: cursor + at + length };
  }
  return undefined;
}

/**
 * Every occurrence, in file order, delivered in batches.
 *
 * Batched because a scan of a common pattern finds millions, and handing them
 * over one at a time costs more than finding them. `onWindow` says how much of
 * the file is covered so far, which is what lets a partial index be shown while
 * the rest is still being found.
 */
export async function scanAll(
  pattern: Uint8Array,
  storage: ByteStorage,
  options: {
    readonly folding: CaseFolding;
    readonly onMatches: (starts: number[]) => void;
    readonly onWindow?: (indexedUpTo: number) => void;
    /** Stops the scan early — the match cap. */
    readonly shouldStop?: () => boolean;
  } & ScanOptions
): Promise<void> {
  const size = storage.size;
  const length = pattern.length;
  if (length === 0 || size < length) {
    options.onProgress?.(1);
    return;
  }

  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  const folding = options.folding;
  const windowLength = chunkSize + length - 1;

  /**
   * The first offset at which the next match may start, carried across windows
   * so matches never overlap and one found in a window's overlap is not
   * reported twice.
   */
  let nextSearchStart = 0;
  let stoppedEarly = false;

  for (let cursor = 0; cursor < size; cursor += chunkSize) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    if (options.shouldStop?.() === true) {
      stoppedEarly = true;
      break;
    }

    const windowSize = Math.min(windowLength, size - cursor);
    const window = await readFolded(storage, cursor, windowSize, folding);
    if (window.length === 0) break;

    const found: number[] = [];
    // Only a match *starting* in the fresh part counts here; one starting in
    // the overlap is found again by the next window.
    let at = nextSearchStart > cursor ? nextSearchStart - cursor : 0;
    while (at < chunkSize && at < window.length) {
      if (options.shouldStop?.() === true) {
        stoppedEarly = true;
        break;
      }
      const index = firstMatchIn(pattern, window, at, folding);
      if (index === -1 || index >= chunkSize) break;
      found.push(cursor + index);
      nextSearchStart = cursor + index + length;
      at = index + length;
    }

    if (found.length > 0) options.onMatches(found);
    options.onProgress?.(Math.min((cursor + windowSize) / size, 1));
    // Every start below the new cursor has been looked for, so this is how much
    // of the file an index built from here covers.
    options.onWindow?.(Math.min(cursor + chunkSize, size));
    if (stoppedEarly) break;
  }

  // A scan stopped by the cap covered only part of the file, so it must not
  // report itself finished.
  if (!stoppedEarly) options.onProgress?.(1);
}

/** Reads a window and folds it, since the buffer is ours to fold. */
async function readFolded(
  storage: ByteStorage,
  at: number,
  length: number,
  folding: CaseFolding
): Promise<Uint8Array> {
  const bytes = await storage.read(at, length);
  foldInPlace(bytes, folding);
  return bytes;
}

/** The pattern, folded the same way the data will be. */
export function foldedPattern(pattern: Uint8Array, folding: CaseFolding): Uint8Array {
  const copy = pattern.slice();
  foldInPlace(copy, folding);
  return copy;
}
