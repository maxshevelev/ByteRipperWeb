import {
  type ByteRange,
  DEFAULT_SEARCH_CHUNK_SIZE,
  type ScanOptions,
  SearchCancelled,
  SearchPatternEmpty,
} from "@/core/search/searchEngine";
import type { CaseFolding } from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * Search with holes in the pattern and matches that overlap.
 *
 * Ported from `MaskedSearch.swift`: what an agent's `find_bytes` asks of the
 * find bar's engine.
 */

/**
 * A hex pattern that cannot be read. The message is just the reason; a caller
 * words the sentence around it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchEngine.swift#SearchError.invalidHexPattern
 */
export class MaskedPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaskedPatternError";
  }
}

/**
 * A pattern with holes in it: bytes, some of which match anything — the
 * `24 ?? 4D 49` of a hex search — compared by an encoding's case rules.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern
 */
export interface MaskedPattern {
  /** The bytes to match; where `isWild` is true, the byte here is ignored. */
  readonly bytes: Uint8Array;
  readonly isWild: readonly boolean[];
  readonly folding: CaseFolding;
}

/**
 * A pattern of these bytes, with holes where `isWild` says so (none by default).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern.init
 */
export function maskedPattern(
  bytes: Uint8Array | readonly number[],
  options: { readonly isWild?: readonly boolean[]; readonly folding?: CaseFolding } = {}
): MaskedPattern {
  const copy = Uint8Array.from(bytes);
  return {
    bytes: copy,
    isWild: options.isWild ?? Array.from({ length: copy.length }, () => false),
    folding: options.folding ?? { kind: "exact" },
  };
}

/**
 * The pattern's length in bytes.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern.count
 */
export const maskedPatternCount = (pattern: MaskedPattern): number => pattern.bytes.length;

/**
 * Hex text with `??` for any byte: pairs of digits, spaces and `0x` prefixes as
 * the find bar takes them, and `??` — on its own or between pairs, `24??4D` as
 * well — for a byte that matches anything. A pattern of holes alone matches
 * everywhere and is refused. Throws `MaskedPatternError`.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern.hex
 */
export function parseHexPattern(text: string): MaskedPattern {
  const bytes: number[] = [];
  const wild: boolean[] = [];
  for (const token of text.split(/\s+/)) {
    if (token === "") continue;
    const rest = /^0x/i.test(token) ? token.slice(2) : token;
    if (rest === "" || rest.length % 2 !== 0) {
      throw new MaskedPatternError("not a whole number of hex bytes");
    }
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2);
      if (pair === "??") {
        bytes.push(0);
        wild.push(true);
      } else if (/^[0-9a-fA-F]{2}$/.test(pair)) {
        bytes.push(Number.parseInt(pair, 16));
        wild.push(false);
      } else {
        throw new MaskedPatternError(`"${pair}" is not a hex byte`);
      }
    }
  }
  if (bytes.length === 0) throw new MaskedPatternError("the pattern is empty");
  if (!wild.includes(false)) {
    throw new MaskedPatternError("a pattern of holes alone matches everywhere");
  }
  return { bytes: Uint8Array.from(bytes), isWild: wild, folding: { kind: "exact" } };
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern.hex */
export const MaskedPattern = { hex: parseHexPattern };

const isASCIILetter = (byte: number): boolean => {
  const lower = byte | 0x20;
  return lower >= 0x61 && lower <= 0x7a;
};

/**
 * Whether a UTF-16 unit's letter byte sits at `index` of the pattern: the
 * low byte of its unit, counting units from the pattern's start.
 */
const isLetterByteAt = (index: number, littleEndian: boolean): boolean =>
  littleEndian ? index % 2 === 0 : index % 2 === 1;

/**
 * The anchor byte's other case where the folding lets it have one, or the
 * byte itself.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#SearchEngine.alternativeCase
 */
function alternativeCase(byte: number, index: number, pattern: MaskedPattern): number {
  if (!isASCIILetter(byte)) return byte;
  const folding = pattern.folding;
  if (folding.kind === "exact") return byte;
  if (folding.kind === "asciiBytes") return byte ^ 0x20;
  const littleEndian = folding.littleEndian;
  const partner = littleEndian ? index + 1 : index - 1;
  if (
    !isLetterByteAt(index, littleEndian) ||
    partner < 0 ||
    partner >= pattern.bytes.length ||
    pattern.isWild[partner] === true ||
    pattern.bytes[partner] !== 0
  ) {
    return byte;
  }
  return byte ^ 0x20;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#SearchEngine.matchesAt */
function matchesAt(start: number, pattern: MaskedPattern, buffer: Uint8Array): boolean {
  const folding = pattern.folding;
  for (let index = 0; index < pattern.bytes.length; index++) {
    if (pattern.isWild[index] === true) continue;
    const want = pattern.bytes[index] ?? 0;
    const have = buffer[start + index] ?? 0;
    if (want === have) continue;
    if (!isASCIILetter(want) || (want ^ 0x20) !== have) return false;
    if (folding.kind === "exact") return false;
    if (folding.kind === "asciiBytes") continue;
    // The unit is a letter only when its other byte, in the data, is zero.
    const littleEndian = folding.littleEndian;
    const partner = start + (littleEndian ? index + 1 : index - 1);
    if (!isLetterByteAt(index, littleEndian) || partner < 0 || partner >= buffer.length) {
      return false;
    }
    if (buffer[partner] !== 0) return false;
  }
  return true;
}

/**
 * The first place at or after `from`, starting below `below`, where `pattern`
 * matches whole inside `window`; -1 when there is none.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#SearchEngine.firstMatch
 */
export function firstMaskedMatch(
  pattern: MaskedPattern,
  window: Uint8Array,
  from: number,
  below: number
): number {
  const count = pattern.bytes.length;
  const lastStart = Math.min(below - 1, window.length - count);
  if (from > lastStart) return -1;
  // Anchored on the first byte that is not a hole: found fast, and only there
  // is the rest compared.
  const anchor = pattern.isWild.indexOf(false);
  if (anchor === -1) return -1;
  const first = pattern.bytes[anchor] ?? 0;
  const alternative = alternativeCase(first, anchor, pattern);
  const end = lastStart + anchor;
  let start = from;
  while (start <= lastStart) {
    let at = start + anchor;
    if (alternative === first) {
      at = window.indexOf(first, at);
      if (at === -1 || at > end) return -1;
    } else {
      while (at <= end && window[at] !== first && window[at] !== alternative) at++;
      if (at > end) return -1;
    }
    const candidate = at - anchor;
    if (matchesAt(candidate, pattern, window)) return candidate;
    start = candidate + 1;
  }
  return -1;
}

/**
 * Every match of any of `patterns` in `range` of `storage` (half-open absolute
 * offsets), in order of where it starts, handed to `visit` with the pattern's
 * index — `visit` returns false to stop.
 *
 * What `scanAll` does, and the two things it does not: a pattern may have holes
 * (`MaskedPattern`), and with `overlapping` a match is looked for again one byte
 * after the last one's start rather than after its end, so `AA` in `AAAA` is
 * three matches. Each window is read once, a chunk and the longest pattern's
 * length less one, so a match across the boundary is found once and only once.
 *
 * Two patterns matching at one place are both reported, the lower index first.
 * A pattern longer than the range finds nothing. Throws `SearchPatternEmpty`
 * for no pattern or an empty one, and `SearchCancelled` when `shouldCancel`
 * says so between windows.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#SearchEngine.matches
 * @upstream-differs asynchronous because a storage read is; reports a ByteRange and takes the shared ScanOptions
 */
export async function maskedMatches(
  patterns: readonly MaskedPattern[],
  storage: ByteStorage,
  visit: (match: ByteRange, pattern: number) => boolean,
  options: {
    readonly range?: ByteRange;
    readonly overlapping?: boolean;
  } & ScanOptions = {}
): Promise<void> {
  if (patterns.length === 0 || patterns.some((p) => p.bytes.length === 0)) {
    throw new SearchPatternEmpty();
  }
  const overlapping = options.overlapping ?? false;
  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  const lowerBound = Math.min(Math.max(options.range?.start ?? 0, 0), storage.size);
  const upperBound = Math.min(
    Math.max(options.range?.end ?? storage.size, lowerBound),
    storage.size
  );
  const counts = patterns.map((p) => p.bytes.length);
  const longest = Math.max(...counts);
  const shortest = Math.min(...counts);
  if (shortest > upperBound - lowerBound) return;

  // Where each pattern may next start, so the non-overlapping rule holds across
  // windows; the rule is per pattern, as each is its own search.
  const nextStart = patterns.map(() => lowerBound);
  let cursor = lowerBound;
  while (cursor < upperBound) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const fresh = Math.min(chunkSize, upperBound - cursor);
    const length = Math.min(fresh + longest - 1, upperBound - cursor);
    const window = await storage.read(cursor, length);
    if (window.length === 0) break;

    const found: { start: number; pattern: number }[] = [];
    for (const [index, pattern] of patterns.entries()) {
      const count = pattern.bytes.length;
      const step = overlapping ? 1 : count;
      let from = Math.max(0, (nextStart[index] ?? 0) - cursor);
      while (from < fresh) {
        const at = firstMaskedMatch(pattern, window, from, fresh);
        if (at === -1) break;
        if (patterns.length === 1) {
          // Straight to `visit`: a pattern that matches everywhere visits
          // millions, and gathering them first is most of the cost.
          const start = cursor + at;
          if (!visit({ start, end: start + count }, 0)) return;
        } else {
          found.push({ start: at, pattern: index });
        }
        nextStart[index] = cursor + at + step;
        from = at + step;
      }
    }
    found.sort((a, b) => a.start - b.start || a.pattern - b.pattern);
    for (const match of found) {
      const start = cursor + match.start;
      const count = counts[match.pattern] ?? 0;
      if (!visit({ start, end: start + count }, match.pattern)) return;
    }
    cursor += fresh;
    options.onProgress?.((cursor - lowerBound) / (upperBound - lowerBound));
    const turn = options.pause?.();
    if (turn !== undefined) await turn;
  }
}
