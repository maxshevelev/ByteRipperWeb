import { describe, expect, it } from "vitest";
import type { MatchBatch, SearchDirection } from "@/core/find/findContent";
import { ByteFindContent, byteMatchSetBuilder } from "@/core/search/byteFindContent";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_RESULTS,
  SearchCancelled,
  SearchPatternEmpty,
} from "@/core/search/searchEngine";
import {
  type CaseFolding,
  foldingFor,
  parsePattern,
  patternHexText,
  type SearchEncoding,
  searchPattern,
} from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray, SeededRandom } from "@/core/testing/support";

/**
 * The dump's search, run the way the find bar runs it: `ByteFindContent` over `PatternScan` (#33).
 * Find Next and Find Previous are its `firstMatch`, Find All and the highlight its `matchStarts`.
 * Holes and the overlap of a run are `ByteFindContentTests`; this is everything else a search
 * owes — parsing, edges, windows, unsaved content, cancellation, progress, and the case rules of
 * each encoding.
 *
 * Ported from `SearchEngineTests.swift`.
 */

const EXACT_FOLD: CaseFolding = { kind: "exact" };

const storage = (bytes: readonly number[] | Uint8Array) =>
  new MemoryBackedStorage(Uint8Array.from(bytes));

const asStorage = (where: readonly number[] | ByteStorage): ByteStorage =>
  Array.isArray(where) ? storage(where) : (where as ByteStorage);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const query = (pattern: readonly number[], folding: CaseFolding = EXACT_FOLD) => ({
  pattern: searchPattern(pattern, "hex"),
  folding,
});

const rangeText = (range: { start: number; end: number } | undefined) =>
  range === undefined ? undefined : `${range.start}-${range.end}`;

/** Find Next (`forward`) or Find Previous (`backward`) from `from`. */
async function find(
  pattern: readonly number[],
  where: readonly number[] | ByteStorage,
  options: {
    from?: number;
    direction?: SearchDirection;
    folding?: CaseFolding;
    chunkSize?: number;
    shouldCancel?: () => boolean;
    progress?: (fraction: number) => void;
  } = {}
): Promise<string | undefined> {
  const found = await new ByteFindContent(asStorage(where), {
    chunkSize: options.chunkSize ?? 7,
  }).firstMatch(
    query(pattern, options.folding),
    options.from ?? 0,
    options.direction ?? "forward",
    options.shouldCancel ?? (() => false),
    options.progress ?? (() => {})
  );
  return rangeText(found);
}

/** Every match start, as the index that greys the dump and fills Find All gets them. */
async function findAll(
  pattern: readonly number[],
  where: readonly number[] | ByteStorage,
  options: { folding?: CaseFolding; chunkSize?: number } = {}
): Promise<number[]> {
  const content = new ByteFindContent(asStorage(where), { chunkSize: options.chunkSize ?? 7 });
  const found: number[] = [];
  for await (const batch of content.matchStarts(
    query(pattern, options.folding),
    () => false,
    () => {}
  )) {
    found.push(...Array.from(batch.starts));
  }
  return found;
}

/** Every batch `matchStarts` delivers. */
async function batchesOf(
  content: ByteFindContent,
  pattern: readonly number[],
  shouldCancel: () => boolean = () => false,
  progress: (fraction: number) => void = () => {}
): Promise<MatchBatch[]> {
  const batches: MatchBatch[] = [];
  for await (const batch of content.matchStarts(query(pattern), shouldCancel, progress)) {
    batches.push({ starts: Array.from(batch.starts), scannedUpTo: batch.scannedUpTo });
  }
  return batches;
}

/** The bytes a pattern resolves to; the tests below only use patterns that parse. */
function bytesOf(text: string, encoding: SearchEncoding): number[] {
  const result = parsePattern(text, encoding);
  if (!result.ok) throw new Error(`${text} does not parse as ${encoding}: ${result.reason}`);
  return asArray(result.pattern.bytes);
}

/** An overlay over `base`, with `bytes` written at `at` — the unsaved content. */
async function edited(base: number[], at: number, bytes: number[]): Promise<EditOverlayStorage> {
  const overlay = new EditOverlayStorage(storage(base));
  await overlay.overwrite(at, new Uint8Array(bytes));
  return overlay;
}

describe("SearchEngineTests", () => {
  const parsed = (text: string, encoding: SearchEncoding) => {
    const result = parsePattern(text, encoding);
    return result.ok ? asArray(result.pattern.bytes) : result.reason;
  };

  // MARK: - Pattern parsing

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseHexVariants
  it("accepts every hex spelling", () => {
    expect(parsed("DEADBEEF", "hex")).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(parsed("DE AD BE EF", "hex")).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(parsed("0xDE 0xAD", "hex")).toEqual([0xde, 0xad]);
    expect(parsed("deadbeef", "hex")).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(parsed("ff", "hex")).toEqual([0xff]);
    expect(parsed("00", "hex")).toEqual([0x00]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseHexInvalid
  it("refuses malformed hex rather than guessing", () => {
    for (const text of ["", "  ", "0x", "0X", "DEADBEE", "XYZ", "12G", "0x1G", "DE 0x", "abcde"]) {
      expect(parsed(text, "hex"), text).toBe("invalidHexPattern");
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseAsciiAndUtf8
  it("encodes ASCII and UTF-8", () => {
    expect(parsed("Hello", "ascii")).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    // ASCII is the narrower claim, so a character outside it is a refusal rather than a silent
    // coercion into something the file does not contain.
    expect(parsed("é", "ascii")).toBe("undecodableText");
    expect(parsed("Hello", "utf8")).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(parsed("é", "utf8")).toEqual([0xc3, 0xa9]);
    expect(parsed("", "utf8")).toBe("emptyPattern");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseUtf16
  it("encodes UTF-16 in either byte order", () => {
    expect(parsed("A", "utf16LE")).toEqual([0x41, 0x00]);
    expect(parsed("A", "utf16BE")).toEqual([0x00, 0x41]);
    expect(parsed("é", "utf16LE")).toEqual([0xe9, 0x00]);
    expect(parsed("é", "utf16BE")).toEqual([0x00, 0xe9]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testEmptyPatternThrows
  it("refuses a search for nothing rather than answering it", async () => {
    for (const direction of ["forward", "backward"] as const) {
      await expect(
        find([], [1, 2, 3], { from: direction === "forward" ? 0 : 3, direction }),
        direction
      ).rejects.toBeInstanceOf(SearchPatternEmpty);
    }
  });

  // MARK: - Find

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAtStartMiddleEnd
  it("finds a match at the start, the middle and the end", async () => {
    const bytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0xde, 0xad];
    expect(await find([0xde, 0xad], bytes, { from: 0 })).toBe("0-2");
    expect(await find([0xde, 0xad], bytes, { from: 1 })).toBe("5-7");
    expect(await find([0xde, 0xad], bytes, { from: 5 })).toBe("5-7");
    expect(await find([0xde, 0xad], bytes, { from: 6 })).toBeUndefined();
    expect(await find([0xbe, 0xef], bytes, { from: 0 })).toBe("2-4");
  });

  // The edges of a search: nothing to find, nothing that could fit, a one-byte pattern (the
  // shortest window there is), and a match ending exactly at EOF.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindEdges
  it("handles the edges", async () => {
    const cases: [string, number[], number[], number, SearchDirection, string | undefined][] = [
      ["no match, forward", [0xaa, 0xbb], [0x00, 0x01, 0x02], 0, "forward", undefined],
      ["no match, backward from EOF", [0xaa, 0xbb], [0x00, 0x01, 0x02], 3, "backward", undefined],
      ["no match for a single byte", [0x05], [0x00, 0x01, 0x02], 0, "forward", undefined],
      ["a pattern longer than the file", [0, 1, 2, 3], [0x00, 0x01], 0, "forward", undefined],
      ["longer than the file, backward", [0, 1, 2, 3], [0x00, 0x01], 2, "backward", undefined],
      ["a single byte at the start", [0xaa], [0xaa, 0x00, 0xaa, 0x00], 0, "forward", "0-1"],
      ["a single byte past the first", [0xaa], [0xaa, 0x00, 0xaa, 0x00], 1, "forward", "2-3"],
      ["a match ending at EOF", [0xaa, 0xbb], [0x00, 0x01, 0xaa, 0xbb], 0, "forward", "2-4"],
      ["the last byte of the file", [0xbb], [0x00, 0x01, 0xaa, 0xbb], 0, "forward", "3-4"],
    ];
    for (const [name, pattern, bytes, from, direction, expected] of cases) {
      expect(await find(pattern, bytes, { from, direction }), name).toBe(expected);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindBackward
  it("goes backward", async () => {
    const bytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0xde, 0xad];
    const back = (pattern: number[], on: number[], from: number) =>
      find(pattern, on, { from, direction: "backward" });
    expect(await back([0xde, 0xad], bytes, 7)).toBe("5-7");
    expect(await back([0xde, 0xad], bytes, 5)).toBe("0-2");
    expect(await back([0xde, 0xad], bytes, 4)).toBe("0-2");
    // A caret at 0 has nothing before it, so there is no previous match.
    expect(await back([0xde, 0xad], bytes, 0)).toBeUndefined();

    // A one-byte pattern: the shortest window, where the overlap arithmetic that walks backward
    // has nothing to spare.
    const single = [0xaa, 0x00, 0xaa, 0x00];
    expect(await back([0xaa], single, 4)).toBe("2-3");
    expect(await back([0xaa], single, 1)).toBe("0-1");
    expect(await back([0xaa], single, 0)).toBeUndefined();
  });

  // [AA] at index 4 starts exactly at the caret; it must not be returned, or Find Previous from
  // a caret sitting on a match would re-find that same match instead of moving backward.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindBackwardExcludesMatchStartingAtCaret
  it("excludes, going backward, a match that starts at the caret", async () => {
    expect(
      await find([0xaa], [0xaa, 0x00, 0xaa, 0x00, 0xaa], { from: 4, direction: "backward" })
    ).toBe("2-3");
  });

  // Changed with #33: Find Previous is the last match *starting* before the caret, so one that
  // starts before it and runs past it counts (the old scan wanted the match to end at or before
  // the caret, and found 0-2).
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindBackwardIncludesAMatchRunningPastTheCaret
  it("includes, going backward, a match that runs past the caret", async () => {
    const bytes = [0xde, 0xad, 0xbe, 0xef, 0x00, 0xde, 0xad];
    expect(await find([0xde, 0xad], bytes, { from: 6, direction: "backward" })).toBe("5-7");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAcrossChunkBoundary
  it("finds a match across a chunk boundary", async () => {
    // Chunk size 3; the pattern straddles offsets 2..<5 (boundary at 3).
    const bytes = [0x00, 0x01, 0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x00];
    expect(await find([0xaa, 0xbb, 0xcc], bytes, { chunkSize: 3 })).toBe("2-5");
    expect(
      await find([0xaa, 0xbb, 0xcc], bytes, { from: 8, direction: "backward", chunkSize: 3 })
    ).toBe("2-5");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindUsesCurrentUnsavedContent
  it("reads the unsaved content", async () => {
    const overlay = await edited([0xaa, 0x00, 0x00, 0x00], 1, [0xbb]);
    expect(await find([0xbb], overlay)).toBe("1-2");
    expect(await find([0x00, 0x00], overlay)).toBe("2-4");
    expect(await find([0x00, 0x00], overlay, { from: 3 })).toBeUndefined();
    expect(await find([0xaa], overlay)).toBe("0-1");
    expect(await find([0xbb], overlay, { from: 4, direction: "backward" })).toBe("1-2");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCancellationThrows
  it("throws when cancelled, either way", async () => {
    const zeros = new Array<number>(32).fill(0);
    for (const direction of ["forward", "backward"] as const) {
      await expect(
        find([0xaa], zeros, {
          from: direction === "forward" ? 0 : 32,
          direction,
          chunkSize: 4,
          shouldCancel: () => true,
        }),
        direction
      ).rejects.toBeInstanceOf(SearchCancelled);
    }
  });

  // MARK: - Case-insensitive find (§11)

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveAscii
  it("folds ASCII letters", async () => {
    const bytes = ascii("Hi there");
    const folding: CaseFolding = { kind: "asciiBytes" };
    expect(await find(ascii("HI"), bytes, { folding })).toBe("0-2");
    expect(await find(ascii("hi"), bytes, { folding })).toBe("0-2");
    expect(await find(ascii("THE"), bytes, { folding })).toBe("3-6");
    // Case-sensitive is exact: uppercase "HI" does not match "Hi".
    expect(await find(ascii("HI"), bytes)).toBeUndefined();
    expect(await find(ascii("Hi"), bytes)).toBe("0-2");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveUtf8
  it("folds only the ASCII part of UTF-8", async () => {
    // "Café" is C a f é. The ASCII C folds to c, but É (C3 89) never folds to é (C3 A9) — a
    // byte-wise fold has no business with a two-byte character.
    const bytes = bytesOf("Café", "utf8");
    const folding: CaseFolding = { kind: "asciiBytes" };
    expect(await find(bytesOf("café", "utf8"), bytes, { folding })).toBe("0-5");
    // Case-sensitive: only the exact bytes match.
    expect(await find(bytesOf("Café", "utf8"), bytes)).toBe("0-5");
    expect(await find(bytesOf("café", "utf8"), bytes)).toBeUndefined();
    expect(await find(bytesOf("CAFÉ", "utf8"), bytes, { folding })).toBeUndefined();
    expect(await find(bytesOf("CAFÉ", "utf8"), bytes)).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveUtf16
  it("folds UTF-16 letters", async () => {
    const bytes = bytesOf("Hi there", "utf16LE");
    const pattern = bytesOf("HI", "utf16LE");
    // "HI" UTF-16LE = 48 00 49 00; folds 'I' against the 'i' in "Hi".
    expect(await find(pattern, bytes, { folding: { kind: "utf16", littleEndian: true } })).toBe(
      "0-4"
    );
    expect(await find(pattern, bytes)).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveBackward
  it("folds going backward", async () => {
    const bytes = ascii("ab AB ab");
    const folding: CaseFolding = { kind: "asciiBytes" };
    // The last case-insensitive "ab" is at 6-8; a case-sensitive search from 5 finds the exact
    // "ab" at 0-2, the "AB" at 3-5 being only reachable case-insensitively.
    expect(await find(ascii("AB"), bytes, { from: 8, direction: "backward", folding })).toBe("6-8");
    expect(await find(ascii("ab"), bytes, { from: 5, direction: "backward" })).toBe("0-2");
    // Case-insensitive backward from the last "ab" lands on "AB".
    expect(await find(ascii("ab"), bytes, { from: 6, direction: "backward", folding })).toBe("3-5");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveAcrossChunkBoundary
  it("folds across a chunk boundary", async () => {
    // Chunk size 3; "AbC" straddles offsets 2..<5 and is matched by lowercase "abc".
    const bytes = new Array<number>(8).fill(0);
    bytes.splice(2, 3, ...ascii("AbC"));
    const folding: CaseFolding = { kind: "asciiBytes" };
    expect(await find(ascii("abc"), bytes, { folding, chunkSize: 3 })).toBe("2-5");
    expect(
      await find(ascii("abc"), bytes, { from: 8, direction: "backward", folding, chunkSize: 3 })
    ).toBe("2-5");
  });

  // Case sensitivity lives in the byte domain: folding only rewrites ASCII letters, so an exact
  // search treats 0x41 'A' and 0x61 'a' as different bytes. The Find bar keeps this for hex.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindExactSearchDistinguishesRawBytes
  it("keeps raw bytes distinct when the search is exact", async () => {
    expect(await find([0x41, 0x62, 0x63], [0x41, 0x62, 0x63])).toBe("0-3");
    expect(await find([0x61, 0x62, 0x63], [0x41, 0x62, 0x63])).toBeUndefined();
  });

  // MARK: - Find All (§11)

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllFindsEveryOccurrence
  // @upstream ByteRipperTests/FindFlowTests.swift#FindFlowTests.testASearchKeepsEveryOccurrenceItFound
  it("finds every occurrence", async () => {
    const bytes = [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad];
    expect(await findAll([0xde, 0xad], bytes)).toEqual([0, 4, 7]);
    expect(await findAll([0xbe], bytes)).toEqual([2, 6]);
  });

  // The same edges for Find All, whose answer is a list rather than one range: every byte
  // matching, nothing matching, nothing that could fit, and a match ending exactly at EOF.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllEdges
  it("handles the edges of every match", async () => {
    expect(await findAll([0xaa], [0xaa, 0xaa, 0xaa])).toEqual([0, 1, 2]);
    expect(await findAll([0xaa, 0xbb], [0x00, 0x01, 0x02])).toEqual([]);
    expect(await findAll([0x00, 0x01, 0x02, 0x03], [0x00, 0x01])).toEqual([]);
    expect(await findAll([0xaa, 0xbb], [0x00, 0x01, 0xaa, 0xbb])).toEqual([2]);
  });

  // Changed with #33: matches overlap, so "AAAAAA" holds "AAA" at every start from 0 to 3 — the
  // old scan resumed past each match's end and reported only 0 and 3.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllReportsOverlappingMatches
  it("reports matches that overlap", async () => {
    expect(await findAll(ascii("AAA"), ascii("AAAAAA"))).toEqual([0, 1, 2, 3]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossChunkBoundary
  it("finds every match across a chunk boundary", async () => {
    const bytes = [0x00, 0x01, 0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x00];
    expect(await findAll([0xaa, 0xbb, 0xcc], bytes, { chunkSize: 3 })).toEqual([2]);
  });

  // Matches spanning several chunk boundaries, some ending exactly at a boundary — the overlap
  // must neither drop nor double-count a match.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossMultipleChunkBoundaries
  it("finds every match across several chunk boundaries", async () => {
    const bytes = [0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb];
    expect(await findAll([0xaa, 0xbb], bytes, { chunkSize: 3 })).toEqual([0, 2, 4, 6]);
  });

  // A match starting exactly at a chunk boundary is found once, by the window that owns the
  // fresh portion the boundary opens — never twice.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllMatchAtChunkBoundaryIsCountedOnce
  it("counts a match on a chunk boundary exactly once", async () => {
    expect(
      await findAll([0xaa, 0xbb], [0x00, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0x00], { chunkSize: 4 })
    ).toEqual([4]);
    const bytes = new Array<number>(20).fill(0);
    bytes[6] = 0xaa;
    bytes[7] = 0xbb;
    for (const chunkSize of [1, 2, 3, 7, 8, 19, 20, 64]) {
      expect(await findAll([0xaa, 0xbb], bytes, { chunkSize }), `chunk ${chunkSize}`).toEqual([6]);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllCaseInsensitive
  it("folds while finding every match", async () => {
    const bytes = ascii("Hi hi HI");
    expect(await findAll(ascii("hi"), bytes, { folding: { kind: "asciiBytes" } })).toEqual([
      0, 3, 6,
    ]);
    // Case-sensitive finds only the exact lowercase pair.
    expect(await findAll(ascii("hi"), bytes)).toEqual([3]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossChunkBoundaryCaseInsensitive
  it("folds every match across a chunk boundary", async () => {
    const bytes = new Array<number>(8).fill(0);
    bytes.splice(2, 3, ...ascii("AbC"));
    expect(
      await findAll(ascii("abc"), bytes, { folding: { kind: "asciiBytes" }, chunkSize: 3 })
    ).toEqual([2]);
  });

  // After the edit the file is AA AA AA 00: every single-byte match at 0, 1 and 2 is reported.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllUsesCurrentUnsavedContent
  it("reads the unsaved content for every match", async () => {
    const overlay = await edited([0xaa, 0x00, 0xaa, 0x00], 1, [0xaa]);
    expect(await findAll([0xaa], overlay)).toEqual([0, 1, 2]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllReportsProgress
  it("reports progress reaching one", async () => {
    const reported: number[] = [];
    const batches = await batchesOf(
      new ByteFindContent(storage(new Uint8Array(16)), { chunkSize: 4 }),
      [0xff],
      () => false,
      (fraction) => reported.push(fraction)
    );
    expect(batches.flatMap((batch) => Array.from(batch.starts))).toEqual([]);
    expect(Math.max(...reported)).toBeLessThanOrEqual(1);
    expect(reported.at(-1)).toBe(1);
  });

  // MARK: - matchStarts (the highlighting scan)

  // The highlighting scan and Find Next agree on every match — the greys, the results panel and
  // the step must not disagree about what a match is. Walking Find Next one byte past each start
  // visits exactly the starts the scan reports, and Find Previous walks them back.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsAgreesWithFindNextAndPrevious
  it("agrees with Find Next and Find Previous", async () => {
    const bytes = storage([0xaa, 0xaa, 0xaa, 0xaa, 0x00, 0xde, 0xaa, 0xaa, 0xbe, 0xaa]);
    const streamed = await findAll([0xaa, 0xaa], bytes, { chunkSize: 3 });
    const content = new ByteFindContent(bytes, { chunkSize: 3 });
    const step = (from: number, direction: SearchDirection) =>
      content.firstMatch(
        query([0xaa, 0xaa]),
        from,
        direction,
        () => false,
        () => {}
      );

    const forward: number[] = [];
    for (let anchor = 0; ; ) {
      const match = await step(anchor, "forward");
      if (match === undefined) break;
      forward.push(match.start);
      anchor = match.start + 1;
    }
    const backward: number[] = [];
    for (let anchor = bytes.size; ; ) {
      const match = await step(anchor, "backward");
      if (match === undefined) break;
      backward.push(match.start);
      anchor = match.start;
    }
    expect(streamed).toEqual([0, 1, 2, 6]);
    expect(forward).toEqual(streamed);
    expect(backward).toEqual([...streamed].reverse());
  });

  // A batch is a delivery cost, not a limit: the batches partition the matches in order — a
  // window at a time, and within a window `DEFAULT_BATCH_SIZE` at a time, the last one short.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsBatchesInOrder
  it("delivers its batches in order", async () => {
    const small = await batchesOf(
      new ByteFindContent(storage(new Uint8Array(10).fill(0xaa)), { chunkSize: 4 }),
      [0xaa]
    );
    expect(small.map((batch) => Array.from(batch.starts))).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);

    const count = 2 * DEFAULT_BATCH_SIZE + 3;
    const large = await batchesOf(
      new ByteFindContent(storage(new Uint8Array(count).fill(0xaa))),
      [0xaa]
    );
    // One window, cut into batches.
    expect(large.map((batch) => batch.starts.length)).toEqual([
      DEFAULT_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      3,
    ]);
    // Mid-window, what is known is every start up to the batch's last.
    expect(large.map((batch) => batch.scannedUpTo)).toEqual([
      DEFAULT_BATCH_SIZE,
      2 * DEFAULT_BATCH_SIZE,
      count,
    ]);
    // In order, none lost, none twice.
    expect(large.flatMap((batch) => Array.from(batch.starts))).toEqual(
      Array.from({ length: count }, (_, index) => index)
    );
  });

  // The scan is uncapped: the count it feeds is the Find bar's diagnosis of the pattern, and the
  // results limit is a limit on listing, not on counting.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsIsNotCappedByTheResultsLimit
  it("is not capped by the results limit", async () => {
    const count = DEFAULT_MAX_RESULTS + 500;
    expect(
      await findAll([0xaa], storage(new Uint8Array(count).fill(0xaa)), { chunkSize: 1024 })
    ).toHaveLength(count);
  });

  // End to end: the scan fills a match set whose picture is exactly the navigation's own list of
  // matches.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsFillsAMatchSet
  it("fills a match set", async () => {
    const bytes = new Uint8Array(4096);
    const placed = [0, 17, 1000, 2048, 4092];
    for (const offset of placed) bytes[offset] = 0xff;
    const pattern = searchPattern([0xff], "hex");
    const builder = byteMatchSetBuilder(pattern, EXACT_FOLD, bytes.length);
    for (const batch of await batchesOf(new ByteFindContent(storage(bytes)), [0xff])) {
      builder.add(batch.starts);
    }
    const set = builder.finish();
    expect(set.total).toBe(placed.length);
    expect(set.matchesIntersecting(0, bytes.length)).toEqual(
      placed.map((start) => ({ start, end: start + 1 }))
    );
    // The ordinal the Find bar shows.
    expect(set.indexAtOrAfter(18)).toBe(2);
  });

  // Each instalment says how far the scan has got, and that is what makes a half-built index
  // usable: every match below the offset is in hand, so the dump can grey that stretch while the
  // rest is still being scanned (§11).
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsReportsHowFarItHasScanned
  it("says how far it has scanned, so a partial index knows what it covers", async () => {
    // Four windows of four bytes, a match in the first and the last.
    const bytes = new Uint8Array(16);
    bytes[1] = 0xff;
    bytes[14] = 0xff;
    const batches = await batchesOf(new ByteFindContent(storage(bytes), { chunkSize: 4 }), [0xff]);
    expect(batches.flatMap((batch) => Array.from(batch.starts))).toEqual([1, 14]);
    // A window at a time, including the windows with nothing in them — and the last one covers
    // the file.
    expect(batches.map((batch) => batch.scannedUpTo)).toEqual([4, 8, 12, 16]);
  });

  // A set built from part of a scan says so, and the greys read it: what has been covered is
  // exact, and the total is only "so far".
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testAPartialSetKnowsItIsPartial
  it("builds a partial set that knows it is partial", async () => {
    const bytes = new Uint8Array(16).fill(0xaa);
    const builder = byteMatchSetBuilder(searchPattern([0xaa], "hex"), EXACT_FOLD, bytes.length);
    let partial: ReturnType<typeof builder.snapshot> | undefined;
    for (const batch of await batchesOf(
      new ByteFindContent(storage(bytes), { chunkSize: 4 }),
      [0xaa]
    )) {
      builder.add(batch.starts);
      partial ??= builder.snapshot(batch.scannedUpTo);
    }
    if (partial === undefined) throw new Error("the scan delivered nothing");
    // Four of sixteen bytes is not the file.
    expect(partial.isComplete).toBe(false);
    expect(partial.indexedUpTo).toBe(4);
    // The matches in what was covered, exact — a snapshot is not an estimate.
    expect(partial.total).toBe(4);
    expect(partial.matchesIntersecting(0, 4)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ]);
    // With the index still answering.
    expect(partial.indexAtOrAfter(2)).toBe(2);

    const whole = builder.finish();
    expect(whole.isComplete).toBe(true);
    expect(whole.indexedUpTo).toBe(16);
    expect(whole.total).toBe(16);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsEmptyPatternThrows
  it("refuses a scan for nothing", async () => {
    await expect(findAll([], [1, 2, 3])).rejects.toBeInstanceOf(SearchPatternEmpty);
  });

  // A pattern longer than the file finishes with nothing rather than failing: an unfinished
  // pattern in the field is not an error. Changed with #33: the scan still says it covered the
  // file — one empty batch — where the old scan delivered no batch at all.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsPatternLongerThanTheFileYieldsNothing
  it("delivers nothing for a pattern longer than the file", async () => {
    const batches = await batchesOf(new ByteFindContent(storage([1, 2])), [1, 2, 3, 4]);
    expect(batches.flatMap((batch) => Array.from(batch.starts))).toEqual([]);
    // And the index knows the file holds none.
    expect(batches.at(-1)?.scannedUpTo).toBe(2);
  });

  // A cancelled scan ends normally, delivering whatever complete batches it had: a superseded
  // search must not throw at the app.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStopsMidScanOnShouldCancel
  it("stops mid-scan when told to, without failing", async () => {
    let checks = 0;
    const batches = await batchesOf(
      new ByteFindContent(storage(new Uint8Array(32).fill(0xaa)), { chunkSize: 4 }),
      [0xaa],
      () => ++checks > 1
    );
    // The first chunk's matches arrive, the rest of the file is never scanned.
    expect(batches.flatMap((batch) => Array.from(batch.starts))).toEqual([0, 1, 2, 3]);
  });

  // MARK: - Progress contract (0...1)

  // Windows overlap by `patternLength - 1`, so summing their lengths overshoots the file: the old
  // forward scan once reported up to 1.36.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testForwardProgressNeverExceedsOne
  it("never reports forward progress past one", async () => {
    const reported: number[] = [];
    await find(new Array<number>(5).fill(0xff), new Array<number>(100).fill(0), {
      chunkSize: 10,
      progress: (fraction) => reported.push(fraction),
    });
    // A multi-chunk scan reports progress.
    expect(reported.length).toBeGreaterThan(0);
    expect(Math.max(...reported)).toBeLessThanOrEqual(1);
    expect(Math.min(...reported)).toBeGreaterThanOrEqual(0);
    // A completed scan ends at 100 %.
    expect(reported.at(-1)).toBe(1);
  });

  // A backward search covers [0, caret), so its progress must be measured over that span.
  // Measured against the whole file it opened at 91 % for a caret at 10 % and crawled to 100 %.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testBackwardProgressMeasuresTheSearchedSpan
  it("measures backward progress over the span it searches", async () => {
    const reported: number[] = [];
    await find([0xff], new Array<number>(1000).fill(0), {
      from: 100,
      direction: "backward",
      chunkSize: 10,
      progress: (fraction) => reported.push(fraction),
    });
    expect(reported.length).toBeGreaterThan(0);
    // A scan that has just begun must not report near-completion.
    expect(reported[0] ?? 1).toBeLessThan(0.2);
    expect(Math.max(...reported)).toBeLessThanOrEqual(1);
    // And it still ends at 100 %.
    expect(reported.at(-1)).toBe(1);
  });

  // MARK: - Folding is chosen by the encoding (§11)

  // The byte-wise fold is exactly that — bytes, wherever they sit. It models case for a
  // single-byte ASCII-compatible encoding and for nothing else, which is why the rule is asked for
  // by encoding instead of as a bare flag.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testTheByteWiseFoldIsByteLevel
  it("folds byte by byte, and nothing more, when asked to fold bytes", async () => {
    const data = [0x41, 0x00]; // UTF-16BE U+4100
    // A UTF-16BE pattern for U+6100 is 61 00 — a different character.
    const pattern = bytesOf("愀", "utf16BE");
    expect(pattern).toEqual([0x61, 0x00]);
    // Exact matching keeps the two characters apart.
    expect(await find(pattern, data)).toBeUndefined();
    // The byte-wise fold cannot tell a code unit's high byte from a letter.
    expect(await find(pattern, data, { folding: { kind: "asciiBytes" } })).toBeDefined();
  });

  // Hex is bytes, and bytes have no case: the rule for hex is exact whatever the user asked for.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testTheRuleForHexIsAlwaysExact
  it("is always exact for hex", () => {
    expect(foldingFor("hex", false)).toEqual({ kind: "exact" });
    expect(foldingFor("hex", true)).toEqual({ kind: "exact" });
    expect(foldingFor("ascii", false)).toEqual({ kind: "asciiBytes" });
    expect(foldingFor("utf8", false)).toEqual({ kind: "asciiBytes" });
    expect(foldingFor("utf16LE", false)).toEqual({ kind: "utf16", littleEndian: true });
    expect(foldingFor("utf16BE", false)).toEqual({ kind: "utf16", littleEndian: false });
    expect(foldingFor("utf16LE", true)).toEqual({ kind: "exact" });
  });

  // UTF-16 is text, so a case-insensitive search has to work there — it just cannot be done a
  // byte at a time. Folding a code unit, and only when its other byte is zero, finds `a` for a
  // pattern of `A` and leaves U+6100 alone.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingMatchesLettersAndNothingElse
  it("folds UTF-16 letters and nothing else", async () => {
    const text = bytesOf("Setup", "utf16LE");
    const lower = bytesOf("setup", "utf16LE");
    const folding: CaseFolding = { kind: "utf16", littleEndian: true };
    // Exact matching is case-sensitive, as ever.
    expect(await find(lower, text)).toBeUndefined();
    // And the code-unit fold finds it.
    expect(await find(lower, text, { folding })).toBe(`0-${lower.length}`);
    // U+6100 (00 61 LE) must not match U+4100 (00 41 LE): neither code unit encodes an ASCII
    // letter, since the byte that would be the letter is the zero one.
    expect(
      await find(bytesOf("愀", "utf16LE"), bytesOf("䄀", "utf16LE"), { folding })
    ).toBeUndefined();
  });

  // The same, big-endian: the letter is the second byte of the pair.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16BigEndianFoldingMatchesLetters
  it("folds big-endian UTF-16 letters", async () => {
    const text = bytesOf("BIOS", "utf16BE");
    const lower = bytesOf("bios", "utf16BE");
    expect(await find(lower, text, { folding: { kind: "utf16", littleEndian: false } })).toBe(
      `0-${lower.length}`
    );
    // The wrong byte order folds the wrong byte, so nothing matches.
    expect(
      await find(lower, text, { folding: { kind: "utf16", littleEndian: true } })
    ).toBeUndefined();
  });

  // A code unit is two bytes counted from the string's own start, not from any grid in the file
  // — so a UTF-16 string is found wherever it sits, at an even offset or an odd one.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingFindsStringsAtAnyOffsetEvenOrOdd
  it("finds a UTF-16 string at any offset, even or odd", async () => {
    const word = bytesOf("Setup", "utf16LE");
    const pattern = bytesOf("setup", "utf16LE");
    const folding: CaseFolding = { kind: "utf16", littleEndian: true };
    for (let padding = 0; padding <= 3; padding++) {
      const data = [...new Array<number>(padding).fill(0xff), ...word];
      const expected = `${padding}-${padding + word.length}`;
      expect(await find(pattern, data, { folding }), `forward, at ${padding}`).toBe(expected);
      expect(
        await find(pattern, data, { folding, from: padding + word.length, direction: "backward" }),
        `backward, at ${padding}`
      ).toBe(expected);
      expect(await findAll(pattern, data, { folding }), `Find All, at ${padding}`).toEqual([
        padding,
      ]);
    }
  });

  // The same for big-endian, where the letter is the second byte of the pair.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16BigEndianFoldingFindsStringsAtAnyOffset
  it("finds a big-endian UTF-16 string at any offset", async () => {
    const word = bytesOf("BIOS", "utf16BE");
    const pattern = bytesOf("bios", "utf16BE");
    for (let padding = 0; padding <= 3; padding++) {
      const data = [...new Array<number>(padding).fill(0xff), ...word];
      expect(
        await find(pattern, data, { folding: { kind: "utf16", littleEndian: false } }),
        `at offset ${padding}`
      ).toBe(`${padding}-${padding + word.length}`);
    }
  });

  // A match crossing a window boundary is still found: the candidate walk uses the same
  // overlapped windows as every other search.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingFindsAMatchAcrossAWindowBoundary
  it("finds a folded UTF-16 match across a window boundary", async () => {
    const word = bytesOf("Setup", "utf16LE");
    const pattern = bytesOf("setup", "utf16LE");
    // The string straddles the boundary of a 16-byte chunk.
    const padding = 13;
    const data = [...new Array<number>(padding).fill(0xff), ...word];
    const folding: CaseFolding = { kind: "utf16", littleEndian: true };
    const expected = `${padding}-${padding + word.length}`;
    expect(await find(pattern, data, { folding, chunkSize: 16 })).toBe(expected);
    expect(
      await find(pattern, data, {
        folding,
        from: data.length,
        direction: "backward",
        chunkSize: 16,
      })
    ).toBe(expected);
    expect(await findAll(pattern, data, { folding, chunkSize: 16 })).toEqual([padding]);
  });

  // Find All folds the same way, so a case-insensitive UTF-16 sweep reports every occurrence
  // whatever its case.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingInFindAll
  it("folds UTF-16 in Find All", async () => {
    const data = bytesOf("EfiEFIefi", "utf16LE");
    const pattern = bytesOf("efi", "utf16LE");
    // All three, one per spelling.
    expect(
      await findAll(pattern, data, { folding: { kind: "utf16", littleEndian: true } })
    ).toEqual([0, 6, 12]);
  });

  it("agrees with a naive overlapping scan over random data", async () => {
    for (let round = 0; round < 25; round++) {
      const random = new SeededRandom(0x5ea4c40 + round);
      const bytes = Array.from(random.bytes(random.int(1, 400)), (b) => b % 4);
      const pattern = Array.from(random.bytes(random.int(1, 4)), (b) => b % 4);

      // The obvious answer, every start, as the oracle.
      const expected: number[] = [];
      for (let at = 0; at + pattern.length <= bytes.length; at++) {
        let i = 0;
        while (i < pattern.length && bytes[at + i] === pattern[i]) i++;
        if (i === pattern.length) expected.push(at);
      }
      expect(
        await findAll(pattern, bytes, { chunkSize: random.int(1, 40) }),
        `round ${round}`
      ).toEqual(expected);
    }
  });

  // The main thread's scans hand the event loop a turn between windows; the answer must not
  // depend on how many turns it took.
  it("waits out every pause it is given and still finds everything", async () => {
    const bytes = new Uint8Array(40);
    bytes.set([0xab, 0xcd], 3);
    bytes.set([0xab, 0xcd], 31);
    let pauses = 0;
    const content = new ByteFindContent(storage(bytes), {
      chunkSize: 8,
      pause: () => () => {
        pauses++;
        return Promise.resolve();
      },
    });
    const found: number[] = [];
    for await (const batch of content.matchStarts(
      query([0xab, 0xcd]),
      () => false,
      () => {}
    )) {
      found.push(...Array.from(batch.starts));
    }
    const first = await content.firstMatch(
      query([0xab, 0xcd]),
      10,
      "forward",
      () => false,
      () => {}
    );
    expect(found).toEqual([3, 31]);
    expect(first).toEqual({ start: 31, end: 33 });
    expect(pauses).toBeGreaterThan(5);
  });
});

/** §11: the one form a hex pattern is shown back in — the form a dump prints. */
describe("HexPatternTextTests", () => {
  const hexTextOf = (text: string, encoding: SearchEncoding) => {
    const result = parsePattern(text, encoding);
    return result.ok ? patternHexText(result.pattern) : result.reason;
  };

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testTheBytesComeBackAsUppercasePairs
  it("shows the bytes back as uppercase pairs", () => {
    expect(hexTextOf("deadbeef", "hex")).toBe("DE AD BE EF");
  });

  // Every form the parser accepts leads to the same text, because the text is derived from the
  // bytes rather than from what was typed.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testEveryAcceptedFormLeadsToTheSameText
  it("is the same text for every form the parser accepts", () => {
    for (const typed of ["DEADBEEF", "de ad be ef", "DE AD BE EF", "0xDE 0xAD 0xBE 0xEF"]) {
      expect(hexTextOf(typed, "hex"), `typed as ${typed}`).toBe("DE AD BE EF");
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testASingleByteHasNoSeparator
  it("has no separator for a single byte", () => {
    expect(hexTextOf("0xff", "hex")).toBe("FF");
  });

  // A text pattern's bytes can be written this way too — the property is about the bytes — but
  // nothing shows them so: the field holds the string the user is looking for, not its encoding.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testTextBytesCanAlsoBeWrittenOut
  it("can be written for a text pattern's bytes too", () => {
    expect(hexTextOf("AB", "ascii")).toBe("41 42");
  });
});
