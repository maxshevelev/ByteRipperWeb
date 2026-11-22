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
 * Ported from `MaskedPattern.swift`, `PatternScan.swift` and `MaskedSearch.swift`: the one scan
 * the find bar, the agent's `find_bytes` and the UEFI Structure's search all run, so the three
 * cannot disagree about what a match is (#33).
 */

/**
 * A hex pattern that cannot be read, and why: not hex at all, half a byte masked, or holes alone.
 * The message is just the reason; a caller words the sentence around it.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError.invalidHexPattern
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError.invalidGuidPattern
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError.partialByteMask
 * @upstream Packages/BytePattern/Sources/BytePattern/CaseFolding.swift#SearchError.holesOnly
 */
export class MaskedPatternError extends Error {
  readonly reason: MaskedPatternFailure;

  constructor(message: string, reason: MaskedPatternFailure = "invalidHexPattern") {
    super(message);
    this.name = "MaskedPatternError";
    this.reason = reason;
  }
}

/**
 * Why a hex or GUID pattern was refused: the cases of `SearchError` a hex or a GUID reading can
 * raise.
 */
export type MaskedPatternFailure =
  | "invalidHexPattern"
  | "invalidGuidPattern"
  | "partialByteMask"
  | "holesOnly";

/**
 * A pattern with holes in it: bytes, some of which match anything — the
 * `24 ?? 4D 49` of a hex search — compared by an encoding's case rules.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern
 */
export interface MaskedPattern {
  /**
   * The bytes to match; where `isWild` is true, the byte here is ignored.
   *
   * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.bytes
   */
  readonly bytes: Uint8Array;
  /** @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.isWild */
  readonly isWild: readonly boolean[];
  /** @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.folding */
  readonly folding: CaseFolding;
}

/**
 * A pattern of these bytes, with holes where `isWild` says so (none by default).
 *
 * A hole per byte: a shorter or longer mask is a caller's mistake, caught here rather than as a
 * read past the end inside a scan.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.init
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#MaskedPattern.init
 */
export function maskedPattern(
  bytes: Uint8Array | readonly number[],
  options: { readonly isWild?: readonly boolean[]; readonly folding?: CaseFolding } = {}
): MaskedPattern {
  const copy = Uint8Array.from(bytes);
  if (options.isWild !== undefined && options.isWild.length !== copy.length) {
    throw new RangeError("isWild must have one entry per byte");
  }
  return {
    bytes: copy,
    isWild: options.isWild ?? Array.from({ length: copy.length }, () => false),
    folding: options.folding ?? { kind: "exact" },
  };
}

/**
 * The pattern's length in bytes.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.count
 */
export const maskedPatternCount = (pattern: MaskedPattern): number => pattern.bytes.length;

/**
 * Whether any byte of the pattern is a hole.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.hasHoles
 */
export const maskedPatternHasHoles = (pattern: { readonly isWild: readonly boolean[] }): boolean =>
  pattern.isWild.includes(true);

/**
 * The pattern as a hex dump writes it: uppercase pairs, one space between them, `??` for a hole —
 * the one form a search shows back.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.hexText
 */
export const maskedPatternHexText = (pattern: {
  readonly bytes: Uint8Array;
  readonly isWild: readonly boolean[];
}): string =>
  Array.from(pattern.bytes, (byte, index) =>
    pattern.isWild[index] === true ? "??" : byte.toString(16).toUpperCase().padStart(2, "0")
  ).join(" ");

/**
 * Hex text with `??` for any byte — the one reading of a hex search, the find bar's and the
 * agent's.
 *
 * Digits are read in pairs across the whole text: spaces between them, and a `0x` in front of a
 * group, are for the eye and change nothing, so `DEADBEEF`, `DE AD BE EF`, `0xDE 0xAD` and
 * `D EADBEEF` are the same four bytes. `??` in place of a pair is a byte that matches anything —
 * `24 ?? 4D 49`, `24??4D` as well.
 *
 * A hole is a whole byte. A `?` paired with a digit (`2?`) would mask half a byte, which the scan
 * does not do, and is refused as `partialByteMask` rather than read as something else; so is a
 * lone `?`. A pattern of holes alone matches everywhere and is refused as `holesOnly`. Throws
 * `MaskedPatternError`, whose `reason` says which.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.hex
 */
export function parseHexPattern(text: string): MaskedPattern {
  let symbols = "";
  for (const token of text.split(/\s+/)) {
    if (token === "") continue;
    const rest = /^0x/i.test(token) ? token.slice(2) : token;
    if (rest === "" || !/^[0-9a-fA-F?]+$/.test(rest)) {
      throw new MaskedPatternError("not a hex byte sequence");
    }
    symbols += rest;
  }
  // No digits at all is not a hex pattern, as the find bar has always said.
  if (symbols === "") throw new MaskedPatternError("not a hex byte sequence");
  if (symbols.length % 2 !== 0) {
    throw symbols.includes("?")
      ? new MaskedPatternError("half a byte cannot be masked", "partialByteMask")
      : new MaskedPatternError("not a whole number of hex bytes");
  }
  const bytes: number[] = [];
  const wild: boolean[] = [];
  for (let index = 0; index < symbols.length; index += 2) {
    const highHole = symbols[index] === "?";
    const lowHole = symbols[index + 1] === "?";
    if (highHole && lowHole) {
      bytes.push(0);
      wild.push(true);
    } else if (!highHole && !lowHole) {
      bytes.push(Number.parseInt(symbols.slice(index, index + 2), 16));
      wild.push(false);
    } else {
      throw new MaskedPatternError("half a byte cannot be masked", "partialByteMask");
    }
  }
  if (!wild.includes(false)) {
    throw new MaskedPatternError("a pattern of holes alone matches everywhere", "holesOnly");
  }
  return { bytes: Uint8Array.from(bytes), isWild: wild, folding: { kind: "exact" } };
}

/**
 * Whether `character` is 0–9, A–F or a–f — never the full-width ０–９, Ａ–Ｆ, ａ–ｆ, which upstream's
 * `Character.isHexDigit` also takes and its byte parse then refuses. A JavaScript class `[0-9a-f]`
 * is ASCII already; the check is kept by name so the two read alike.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.isASCIIHexDigit
 */
export const isASCIIHexDigit = (character: string): boolean => /^[0-9a-fA-F]$/.test(character);

/**
 * The bytes of `text` read as a GUID — `CDEA2BD3-FC25-4C1C-B97C-B31186064990`, any case, in braces
 * or not — as an EFI_GUID is in memory: the first three fields little-endian, the last eight bytes
 * as written. Nothing when it is not one.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.guidBytes
 */
export function guidBytes(text: string): Uint8Array | undefined {
  let body = text.replace(/^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu, "");
  if (body.startsWith("{") || body.endsWith("}")) {
    if (!body.startsWith("{") || !body.endsWith("}") || body.length < 2) return undefined;
    body = body.slice(1, -1);
  }
  const fields = body.split("-");
  const sizes = [8, 4, 4, 4, 12];
  if (fields.length !== sizes.length) return undefined;
  if (
    !fields.every(
      (field, index) => field.length === sizes[index] && Array.from(field).every(isASCIIHexDigit)
    )
  )
    return undefined;
  const pairs = (field: string): number[] =>
    Array.from({ length: field.length / 2 }, (_, at) =>
      Number.parseInt(field.slice(at * 2, at * 2 + 2), 16)
    );
  const [first = "", second = "", third = "", fourth = "", fifth = ""] = fields;
  return Uint8Array.from([
    ...pairs(first).reverse(),
    ...pairs(second).reverse(),
    ...pairs(third).reverse(),
    ...pairs(fourth),
    ...pairs(fifth),
  ]);
}

/**
 * A GUID as text, as the 16 bytes it is in memory (`guidBytes`). Anything else throws
 * `MaskedPatternError` with `invalidGuidPattern`: a GUID search asks for exactly one GUID.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.guid
 */
export function parseGuidPattern(text: string): MaskedPattern {
  const bytes = guidBytes(text);
  if (bytes === undefined) throw new MaskedPatternError("not a GUID", "invalidGuidPattern");
  return { bytes, isWild: Array.from(bytes, () => false), folding: { kind: "exact" } };
}

/**
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.hex
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.guid
 */
export const MaskedPattern = { hex: parseHexPattern, guid: parseGuidPattern };

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
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.alternativeCase
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

/** @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.matchesAt */
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
 * The byte a pattern is found by, and that byte's other case where the folding lets it have one
 * (the byte itself where it does not).
 *
 * Not a hole, so it is found fast and only there is the rest compared. Not 0x00 or 0xFF where the
 * pattern has another byte — a dump is full of both, and an anchor on them stops at almost every
 * byte: an address such as `00 80 66 FF` is found by its 0x80.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.Anchor
 */
export interface PatternAnchor {
  /** @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.Anchor.index */
  readonly index: number;
  /** @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.Anchor.byte */
  readonly byte: number;
  /** @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.Anchor.alternative */
  readonly alternative: number;
}

/**
 * The pattern's anchor, worked out once: a run of matches asks for the next one millions of
 * times. None for a pattern of holes alone, which is found nowhere.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.Anchor.init
 */
export function patternAnchor(pattern: MaskedPattern): PatternAnchor | undefined {
  let index = -1;
  for (let at = 0; at < pattern.bytes.length; at++) {
    if (pattern.isWild[at] === true) continue;
    const byte = pattern.bytes[at] ?? 0;
    if (byte !== 0x00 && byte !== 0xff) {
      index = at;
      break;
    }
  }
  if (index === -1) index = pattern.isWild.indexOf(false);
  if (index === -1) return undefined;
  const byte = pattern.bytes[index] ?? 0;
  return { index, byte, alternative: alternativeCase(byte, index, pattern) };
}

/**
 * The first place at or after `from`, starting below `below`, where `pattern`
 * matches whole inside `window`; -1 when there is none.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.firstMatch
 */
export function firstMaskedMatch(
  pattern: MaskedPattern,
  window: Uint8Array,
  from: number,
  below: number,
  anchor: PatternAnchor | undefined = patternAnchor(pattern)
): number {
  const lastStart = Math.min(below - 1, window.length - pattern.bytes.length);
  if (anchor === undefined || from > lastStart) return -1;
  const first = anchor.byte;
  const alternative = anchor.alternative;
  const end = lastStart + anchor.index;
  let start = from;
  while (start <= lastStart) {
    // The next place the anchor byte, or its other case, is.
    let at = start + anchor.index;
    if (alternative === first) {
      // One byte to look for: the native scan, which is what makes a search of a whole dump fast.
      at = window.indexOf(first, at);
      if (at === -1 || at > end) return -1;
    } else {
      while (at <= end && window[at] !== first && window[at] !== alternative) at++;
      if (at > end) return -1;
    }
    const candidate = at - anchor.index;
    if (matchesAt(candidate, pattern, window)) return candidate;
    start = candidate + 1;
  }
  return -1;
}

/**
 * The last place starting below `below` where `pattern` matches whole inside `window`: the window
 * looked through from its end back; -1 when there is none.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.lastMatch
 */
export function lastMaskedMatch(
  pattern: MaskedPattern,
  window: Uint8Array,
  below: number,
  anchor: PatternAnchor | undefined = patternAnchor(pattern)
): number {
  const lastStart = Math.min(below - 1, window.length - pattern.bytes.length);
  if (anchor === undefined || lastStart < 0) return -1;
  const first = anchor.byte;
  const alternative = anchor.alternative;
  let at = lastStart + anchor.index;
  while (at >= anchor.index) {
    if (alternative === first) {
      at = window.lastIndexOf(first, at);
      if (at < anchor.index) return -1;
    } else {
      const byte = window[at];
      if (byte !== first && byte !== alternative) {
        at--;
        continue;
      }
    }
    if (matchesAt(at - anchor.index, pattern, window)) return at - anchor.index;
    at--;
  }
  return -1;
}

/**
 * `text` as ASCII bytes, any case of a letter with `ignoringCase`. Throws `SearchPatternEmpty` for
 * no text, and `MaskedPatternError` for a text that is not ASCII.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.ascii
 */
export function asciiPattern(text: string, ignoringCase: boolean): MaskedPattern {
  if (text === "") throw new SearchPatternEmpty();
  const bytes = Array.from(text, (one) => one.codePointAt(0) ?? 0);
  if (bytes.some((one) => one > 0x7f)) throw new MaskedPatternError("not ASCII text");
  return maskedPattern(bytes, {
    folding: ignoringCase ? { kind: "asciiBytes" } : { kind: "exact" },
  });
}

/**
 * `text` as UTF-16LE code units — how firmware keeps a name such as a variable's or a menu's.
 * Throws `SearchPatternEmpty` for no text.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/MaskedPattern.swift#MaskedPattern.utf16LE
 */
export function utf16LEPattern(text: string, ignoringCase: boolean): MaskedPattern {
  if (text === "") throw new SearchPatternEmpty();
  const bytes: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    bytes.push(unit & 0xff, unit >> 8);
  }
  return maskedPattern(bytes, {
    folding: ignoringCase ? { kind: "utf16", littleEndian: true } : { kind: "exact" },
  });
}

/** What a scan for every match is told besides its patterns. */
export interface PatternScanOptions {
  readonly range?: ByteRange;
  /**
   * Whether a match is looked for again one byte after the last one's start rather than after
   * its end. True unless asked otherwise — the count the find bar gives (#33).
   */
  readonly overlapping?: boolean;
  /**
   * Told after each window how far the scan has got: every match starting below that offset has
   * been visited — what an index built while the scan runs needs to show what it already knows.
   */
  readonly windowFinished?: (scannedUpTo: number) => void;
}

/** One scan's bounds, its patterns' anchors and where each pattern may next start. */
interface ScanState {
  readonly patterns: readonly MaskedPattern[];
  readonly anchors: readonly (PatternAnchor | undefined)[];
  readonly counts: readonly number[];
  readonly longest: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly overlapping: boolean;
  /** Where each pattern may next start, so the non-overlapping rule holds across windows. */
  readonly nextStart: number[];
}

/** The scan's state, or undefined when no pattern can fit in the range. */
function beginScan(
  patterns: readonly MaskedPattern[],
  size: number,
  options: PatternScanOptions
): ScanState | { readonly upperBound: number } {
  if (patterns.length === 0 || patterns.some((p) => p.bytes.length === 0)) {
    throw new SearchPatternEmpty();
  }
  const lowerBound = Math.min(Math.max(options.range?.start ?? 0, 0), size);
  const upperBound = Math.min(Math.max(options.range?.end ?? size, lowerBound), size);
  const counts = patterns.map((p) => p.bytes.length);
  if (Math.min(...counts) > upperBound - lowerBound) return { upperBound };
  return {
    patterns,
    anchors: patterns.map((pattern) => patternAnchor(pattern)),
    counts,
    longest: Math.max(...counts),
    lowerBound,
    upperBound,
    overlapping: options.overlapping ?? true,
    nextStart: patterns.map(() => lowerBound),
  };
}

/**
 * Visits the matches starting in the fresh part of one window, in order of start; false when
 * `visit` said to stop.
 */
function scanWindow(
  scan: ScanState,
  window: Uint8Array,
  cursor: number,
  fresh: number,
  visit: (match: ByteRange, pattern: number) => boolean
): boolean {
  const { patterns, anchors, counts, nextStart, overlapping } = scan;
  // One pattern: its matches are in order as they are found, and go straight to `visit` — a
  // pattern that matches everywhere visits millions, and gathering them first is most of the cost.
  if (patterns.length === 1) {
    const pattern = patterns[0] as MaskedPattern;
    const count = counts[0] ?? 0;
    const step = overlapping ? 1 : count;
    let from = Math.max(0, (nextStart[0] ?? 0) - cursor);
    while (from < fresh) {
      const at = firstMaskedMatch(pattern, window, from, fresh, anchors[0]);
      if (at === -1) break;
      const start = cursor + at;
      if (!visit({ start, end: start + count }, 0)) return false;
      nextStart[0] = cursor + at + step;
      from = at + step;
    }
    return true;
  }
  // The window's matches, every pattern's, in order of start.
  const found: { start: number; pattern: number }[] = [];
  for (const [index, pattern] of patterns.entries()) {
    const step = overlapping ? 1 : (counts[index] ?? 0);
    let from = Math.max(0, (nextStart[index] ?? 0) - cursor);
    while (from < fresh) {
      const at = firstMaskedMatch(pattern, window, from, fresh, anchors[index]);
      if (at === -1) break;
      found.push({ start: at, pattern: index });
      nextStart[index] = cursor + at + step;
      from = at + step;
    }
  }
  found.sort((a, b) => a.start - b.start || a.pattern - b.pattern);
  for (const match of found) {
    const start = cursor + match.start;
    if (!visit({ start, end: start + (counts[match.pattern] ?? 0) }, match.pattern)) return false;
  }
  return true;
}

/** One window is done: every start below its end has been looked for. */
function windowDone(
  scan: { readonly lowerBound: number; readonly upperBound: number },
  upTo: number,
  options: PatternScanOptions & { readonly onProgress?: (fraction: number) => void }
): void {
  options.windowFinished?.(upTo);
  const span = scan.upperBound - scan.lowerBound;
  options.onProgress?.(span === 0 ? 1 : (upTo - scan.lowerBound) / span);
}

/**
 * Every match of any of `patterns` in `range` of `storage` (half-open absolute
 * offsets), in order of where it starts, handed to `visit` with the pattern's
 * index — `visit` returns false to stop.
 *
 * A pattern may have holes (`MaskedPattern`), and matches overlap unless `overlapping` is false:
 * a match is looked for again one byte after the last one's start rather than after its end, so
 * `AA` in `AAAA` is three matches. Each window is read once, a chunk and the longest pattern's
 * length less one, so a match across the boundary is found once and only once. After each window
 * `windowFinished` is told how far the scan has got, and `onProgress` the same as a fraction.
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
  options: PatternScanOptions & ScanOptions = {}
): Promise<void> {
  const scan = beginScan(patterns, storage.size, options);
  if (!("patterns" in scan)) {
    options.windowFinished?.(scan.upperBound);
    options.onProgress?.(1);
    return;
  }
  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  let cursor = scan.lowerBound;
  while (cursor < scan.upperBound) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const fresh = Math.min(chunkSize, scan.upperBound - cursor);
    const length = Math.min(fresh + scan.longest - 1, scan.upperBound - cursor);
    const window = await storage.read(cursor, length);
    if (window.length === 0) break;
    if (!scanWindow(scan, window, cursor, fresh, visit)) return;
    cursor += fresh;
    windowDone(scan, cursor, options);
    const turn = options.pause?.();
    if (turn !== undefined) await turn;
  }
  if (cursor < scan.upperBound) windowDone(scan, scan.upperBound, options);
}

/**
 * Every match of any of `patterns` in `range` of `size` bytes `read` gives, in order of where it
 * starts, handed to `visit` with the pattern's index — `visit` returns false to stop. The same scan
 * as `maskedMatches`, over bytes the caller reads for it at once: what a worker holding the
 * decompressed buffers scans them with.
 *
 * A pattern may have holes. Matches overlap by default: a match is looked for again one byte after
 * the last one's start rather than after its end, so `AA` in `AAAA` is three matches — the count
 * the find bar, the UEFI Structure's search and `find_bytes` all give (#33); `overlapping: false`
 * is two. Each window is read once, a chunk and the longest pattern's length less one, so a match
 * across the boundary is found once and only once. Two patterns matching at one place are both
 * reported, the lower index first. After each window, `windowFinished` is told how far the scan
 * has got and `progress` the same as a fraction of the range. Throws `SearchPatternEmpty` for no
 * pattern or an empty one, and `SearchCancelled` when `shouldCancel` says so between windows.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.matches
 */
export function scanPatterns(
  patterns: readonly MaskedPattern[],
  size: number,
  read: (offset: number, length: number) => Uint8Array,
  visit: (match: ByteRange, pattern: number) => boolean,
  options: PatternScanOptions & {
    readonly chunkSize?: number;
    readonly shouldCancel?: () => boolean;
    readonly onProgress?: (fraction: number) => void;
  } = {}
): void {
  const scan = beginScan(patterns, size, options);
  if (!("patterns" in scan)) {
    options.windowFinished?.(scan.upperBound);
    options.onProgress?.(1);
    return;
  }
  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  let cursor = scan.lowerBound;
  while (cursor < scan.upperBound) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const fresh = Math.min(chunkSize, scan.upperBound - cursor);
    const length = Math.min(fresh + scan.longest - 1, scan.upperBound - cursor);
    const window = read(cursor, length);
    if (window.length === 0) break;
    if (!scanWindow(scan, window, cursor, fresh, visit)) return;
    cursor += fresh;
    windowDone(scan, cursor, options);
  }
  if (cursor < scan.upperBound) windowDone(scan, scan.upperBound, options);
}

/** What a scan for the last match before a place is told besides its pattern. */
export interface LastMatchOptions {
  /** The lowest place a match may start. Default 0. */
  readonly lowerBound?: number;
  readonly chunkSize?: number;
  readonly shouldCancel?: () => boolean;
  /** The fraction of `[lowerBound, anchor)` looked at. */
  readonly onProgress?: (fraction: number) => void;
}

/** One backward scan's bounds; undefined when no match can start in them. */
function beginLastMatch(
  pattern: MaskedPattern,
  size: number,
  anchor: number,
  options: LastMatchOptions
): { readonly limit: number; readonly lowerBound: number; readonly count: number } | undefined {
  if (pattern.bytes.length === 0) throw new SearchPatternEmpty();
  const count = pattern.bytes.length;
  if (count > size) return undefined;
  // No match can start after `size - count`.
  const limit = Math.min(anchor, size - count + 1);
  const lowerBound = options.lowerBound ?? 0;
  if (limit <= lowerBound) {
    options.onProgress?.(1);
    return undefined;
  }
  return { limit, lowerBound, count };
}

/**
 * The last match of `pattern` that starts below `anchor` and at or above `lowerBound`, in `size`
 * bytes `read` gives: Find Previous.
 *
 * A match that starts below the anchor and runs past it counts. That is what makes Find Previous
 * step through matches that overlap — a run of `FF FF` is found one byte back at a time, as Find
 * Next finds it one byte on — where "the last match that *ends* before the anchor" would skip the
 * ones overlapping the match the reader stands on.
 *
 * Windows are read from the anchor back towards `lowerBound`, a chunk at a time with the
 * pattern's length less one more, so a match across the edge of two windows is found, and each is
 * looked through from its end back: the last match is the first one met, however many the window
 * holds before it.
 *
 * @upstream Packages/BytePattern/Sources/BytePattern/PatternScan.swift#PatternScan.lastMatch
 */
export function lastPatternMatch(
  pattern: MaskedPattern,
  size: number,
  anchor: number,
  read: (offset: number, length: number) => Uint8Array,
  options: LastMatchOptions = {}
): ByteRange | undefined {
  const bounds = beginLastMatch(pattern, size, anchor, options);
  if (bounds === undefined) return undefined;
  const { limit, lowerBound, count } = bounds;
  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  const found = patternAnchor(pattern);
  let startsEnd = limit;
  while (startsEnd > lowerBound) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const windowStart = Math.max(lowerBound, startsEnd - chunkSize);
    const fresh = startsEnd - windowStart;
    const window = read(windowStart, Math.min(fresh + count - 1, size - windowStart));
    const last = lastMaskedMatch(pattern, window, fresh, found);
    if (last !== -1) {
      options.onProgress?.(1);
      return { start: windowStart + last, end: windowStart + last + count };
    }
    startsEnd = windowStart;
    options.onProgress?.((limit - startsEnd) / (limit - lowerBound));
  }
  return undefined;
}

/**
 * The last match of `pattern` starting below `anchor` in `storage`: Find Previous
 * (`lastPatternMatch`, over a storage's reads).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/MaskedSearch.swift#SearchEngine.lastMatch
 * @upstream-differs asynchronous because a storage read is, with the shared ScanOptions' pause
 */
export async function maskedLastMatch(
  pattern: MaskedPattern,
  storage: ByteStorage,
  anchor: number,
  options: ScanOptions = {}
): Promise<ByteRange | undefined> {
  const size = storage.size;
  const bounds = beginLastMatch(pattern, size, anchor, options);
  if (bounds === undefined) return undefined;
  const { limit, lowerBound, count } = bounds;
  const chunkSize = options.chunkSize ?? DEFAULT_SEARCH_CHUNK_SIZE;
  const found = patternAnchor(pattern);
  let startsEnd = limit;
  while (startsEnd > lowerBound) {
    if (options.shouldCancel?.() === true) throw new SearchCancelled();
    const windowStart = Math.max(lowerBound, startsEnd - chunkSize);
    const fresh = startsEnd - windowStart;
    const window = await storage.read(windowStart, Math.min(fresh + count - 1, size - windowStart));
    const last = lastMaskedMatch(pattern, window, fresh, found);
    if (last !== -1) {
      options.onProgress?.(1);
      return { start: windowStart + last, end: windowStart + last + count };
    }
    startsEnd = windowStart;
    options.onProgress?.((limit - startsEnd) / (limit - lowerBound));
    const turn = options.pause?.();
    if (turn !== undefined) await turn;
  }
  return undefined;
}

/** A masked pattern as it crosses to a worker: plain arrays and the folding by name. */
export interface MaskedPatternWire {
  readonly bytes: readonly number[];
  readonly wild: readonly boolean[];
  readonly folding: "exact" | "asciiBytes" | "utf16le";
}

export function maskedToWire(pattern: MaskedPattern): MaskedPatternWire {
  const folding = pattern.folding;
  return {
    bytes: [...pattern.bytes],
    wild: [...pattern.isWild],
    folding:
      folding.kind === "utf16" ? "utf16le" : folding.kind === "asciiBytes" ? "asciiBytes" : "exact",
  };
}

export function maskedFromWire(wire: MaskedPatternWire): MaskedPattern {
  return maskedPattern(wire.bytes, {
    isWild: wire.wild,
    folding:
      wire.folding === "utf16le"
        ? { kind: "utf16", littleEndian: true }
        : wire.folding === "asciiBytes"
          ? { kind: "asciiBytes" }
          : { kind: "exact" },
  });
}
