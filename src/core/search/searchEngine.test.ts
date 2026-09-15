import { describe, expect, it } from "vitest";
import { MatchSetBuilder } from "@/core/search/matchSet";
import {
  DEFAULT_MAX_RESULTS,
  findOne,
  foldedPattern,
  indexOfBytes,
  SearchCancelled,
  SearchPatternEmpty,
  scanAll,
} from "@/core/search/searchEngine";
import {
  type CaseFolding,
  foldingFor,
  parsePattern,
  patternHexText,
  type SearchEncoding,
} from "@/core/search/searchPattern";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray, SeededRandom } from "@/core/testing/support";

/** Ported from `SearchEngineTests.swift`. */

const storage = (bytes: number[] | Uint8Array) =>
  new MemoryBackedStorage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const utf16le = (text: string) => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    out.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8);
  }
  return out;
};

/** A search with folding applied to both sides, as the engine's callers do. */
async function find(
  pattern: number[],
  bytes: number[],
  options: {
    from?: number;
    direction?: "forward" | "backward";
    folding?: CaseFolding;
    chunkSize?: number;
  } = {}
) {
  const folding = options.folding ?? { kind: "exact" };
  const found = await findOne(foldedPattern(new Uint8Array(pattern), folding), storage(bytes), {
    folding,
    ...(options.from === undefined ? {} : { from: options.from }),
    ...(options.direction === undefined ? {} : { direction: options.direction }),
    ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
  });
  return found === undefined ? undefined : `${found.start}-${found.end}`;
}

describe("parsing a pattern", () => {
  const parsed = (text: string, encoding: SearchEncoding) => {
    const result = parsePattern(text, encoding);
    return result.ok ? asArray(result.pattern.bytes) : result.reason;
  };

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseHexVariants
  it("accepts every hex spelling", () => {
    for (const text of ["DEADBEEF", "de ad be ef", "DE AD BE EF", "0xDE 0xAD 0xBE 0xEF"]) {
      expect(parsed(text, "hex"), text).toEqual([0xde, 0xad, 0xbe, 0xef]);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseHexInvalid
  it("refuses malformed hex rather than guessing", () => {
    expect(parsed("DEAD BEE", "hex")).toBe("invalidHexPattern");
    expect(parsed("ZZ", "hex")).toBe("invalidHexPattern");
    expect(parsed("", "hex")).toBe("emptyPattern");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseAsciiAndUtf8
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testParseUtf16
  it("encodes text in each encoding", () => {
    expect(parsed("Hi", "ascii")).toEqual([0x48, 0x69]);
    expect(parsed("Café", "utf8")).toEqual([0x43, 0x61, 0x66, 0xc3, 0xa9]);
    expect(parsed("Hi", "utf16LE")).toEqual([0x48, 0x00, 0x69, 0x00]);
    expect(parsed("Hi", "utf16BE")).toEqual([0x00, 0x48, 0x00, 0x69]);
  });

  it("refuses a character ASCII cannot hold", () => {
    // ASCII is the narrower claim, so this is a refusal rather than a silent
    // coercion into something the file does not contain.
    expect(parsed("Café", "ascii")).toBe("undecodableText");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testTheBytesComeBackAsUppercasePairs
  it("shows the bytes back the way a dump prints them", () => {
    const result = parsePattern("deadbeef", "hex");
    expect(result.ok && patternHexText(result.pattern)).toBe("DE AD BE EF");
  });
});

describe("finding one match", () => {
  const haystack = [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad];

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAtStartMiddleEnd
  it("finds it at the start, the middle and the end", async () => {
    expect(await find([0xde, 0xad], haystack)).toBe("0-2");
    expect(await find([0xde, 0xad], haystack, { from: 1 })).toBe("4-6");
    expect(await find([0xde, 0xad], haystack, { from: 5 })).toBe("7-9");
    expect(await find([0xde, 0xad], haystack, { from: 8 })).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindEdges
  it("handles the edges", async () => {
    expect(await find([0x01], [])).toBeUndefined();
    expect(await find([1, 2, 3, 4], [1, 2, 3])).toBeUndefined(); // longer than the file
    expect(await find([3], [1, 2, 3])).toBe("2-3"); // the very last byte
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindBackward
  it("goes backwards, from the end", async () => {
    expect(await find([0xde, 0xad], haystack, { from: 9, direction: "backward" })).toBe("7-9");
    expect(await find([0xde, 0xad], haystack, { from: 7, direction: "backward" })).toBe("4-6");
    expect(await find([0xde, 0xad], haystack, { from: 4, direction: "backward" })).toBe("0-2");
    expect(await find([0xde, 0xad], haystack, { from: 1, direction: "backward" })).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAcrossChunkBoundary
  it("finds a match across a chunk boundary", async () => {
    const bytes = new Array(8).fill(0);
    bytes[3] = 0xaa;
    bytes[4] = 0xbb;
    expect(await find([0xaa, 0xbb], bytes, { chunkSize: 3 })).toBe("3-5");
    expect(await find([0xaa, 0xbb], bytes, { from: 8, direction: "backward", chunkSize: 3 })).toBe(
      "3-5"
    );
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCancellationThrows
  it("throws when cancelled", async () => {
    let checks = 0;
    await expect(
      findOne(new Uint8Array([0xff]), storage(new Uint8Array(64)), {
        folding: { kind: "exact" },
        chunkSize: 4,
        shouldCancel: () => ++checks > 1,
      })
    ).rejects.toBeInstanceOf(SearchCancelled);
  });
});

describe("case folding", () => {
  const ci = (encoding: SearchEncoding, caseSensitive = false) =>
    foldingFor(encoding, caseSensitive);

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveAscii
  it("folds ASCII letters", async () => {
    const bytes = ascii("Hi there");
    expect(await find(ascii("HI"), bytes, { folding: ci("ascii") })).toBe("0-2");
    expect(await find(ascii("hi"), bytes, { folding: ci("ascii") })).toBe("0-2");
    expect(await find(ascii("THE"), bytes, { folding: ci("ascii") })).toBe("3-6");
    // Case-sensitive is exact.
    expect(await find(ascii("HI"), bytes, { folding: ci("ascii", true) })).toBeUndefined();
    expect(await find(ascii("Hi"), bytes, { folding: ci("ascii", true) })).toBe("0-2");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveUtf8
  it("folds only the ASCII part of UTF-8", async () => {
    // "Café" is C a f é. The ASCII C folds to c, but É (C3 89) never folds to
    // é (C3 A9) — a byte-wise fold has no business with a two-byte character.
    const bytes = [0x43, 0x61, 0x66, 0xc3, 0xa9];
    expect(await find([0x63, 0x61, 0x66, 0xc3, 0xa9], bytes, { folding: ci("utf8") })).toBe("0-5");
    expect(
      await find([0x43, 0x41, 0x46, 0xc3, 0x89], bytes, { folding: ci("utf8") })
    ).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveUtf16
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingMatchesLettersAndNothingElse
  it("folds UTF-16 by code unit, not by byte", async () => {
    const bytes = utf16le("Hi there");
    expect(await find(utf16le("HI"), bytes, { folding: ci("utf16LE") })).toBe("0-4");
    expect(await find(utf16le("HI"), bytes, { folding: ci("utf16LE", true) })).toBeUndefined();
  });

  it("does not fold the high byte of a non-ASCII code unit", async () => {
    // The reason UTF-16 needs its own rule: a byte-wise fold would read the
    // high byte of U+6100 (`00 61` LE) as the letter `a` and match U+4100,
    // which is a different character entirely.
    const file = [0x00, 0x61]; // U+6100, little-endian
    const pattern = [0x00, 0x41]; // U+4100
    expect(await find(pattern, file, { folding: ci("utf16LE") })).toBeUndefined();
    // While the real letters still fold.
    expect(await find([0x41, 0x00], [0x61, 0x00], { folding: ci("utf16LE") })).toBe("0-2");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveBackward
  it("folds going backwards", async () => {
    const bytes = ascii("ab AB ab");
    expect(
      await find(ascii("AB"), bytes, { from: 8, direction: "backward", folding: ci("ascii") })
    ).toBe("6-8");
    expect(
      await find(ascii("ab"), bytes, {
        from: 5,
        direction: "backward",
        folding: ci("ascii", true),
      })
    ).toBe("0-2");
    // Case-insensitive backward from inside must skip the exact one and land
    // on the uppercase one before it.
    expect(
      await find(ascii("ab"), bytes, { from: 6, direction: "backward", folding: ci("ascii") })
    ).toBe("3-5");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindCaseInsensitiveAcrossChunkBoundary
  it("folds across a chunk boundary", async () => {
    const bytes = new Array(8).fill(0);
    bytes.splice(2, 3, ...ascii("AbC"));
    expect(await find(ascii("abc"), bytes, { folding: ci("ascii"), chunkSize: 3 })).toBe("2-5");
    expect(
      await find(ascii("abc"), bytes, {
        from: 8,
        direction: "backward",
        folding: ci("ascii"),
        chunkSize: 3,
      })
    ).toBe("2-5");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindExactSearchDistinguishesRawBytes
  it("keeps raw bytes distinct when the search is exact", async () => {
    // Case sensitivity lives in the byte domain: an exact search treats 0x41
    // and 0x61 as the different bytes they are.
    expect(await find([0x41, 0x62, 0x63], [0x41, 0x62, 0x63])).toBe("0-3");
    expect(await find([0x61, 0x62, 0x63], [0x41, 0x62, 0x63])).toBeUndefined();
  });
});

describe("scanning for every match", () => {
  const all = async (
    pattern: number[],
    bytes: number[],
    options: { chunkSize?: number; folding?: CaseFolding } = {}
  ) => {
    const folding = options.folding ?? { kind: "exact" };
    const starts: number[] = [];
    await scanAll(foldedPattern(new Uint8Array(pattern), folding), storage(bytes), {
      folding,
      chunkSize: options.chunkSize ?? 7,
      onMatches: (found) => starts.push(...found),
    });
    return starts;
  };

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllFindsEveryOccurrence
  // @upstream ByteRipperTests/FindFlowTests.swift#FindFlowTests.testASearchKeepsEveryOccurrenceItFound
  it("finds every occurrence", async () => {
    expect(await all([0xde, 0xad], [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad])).toEqual(
      [0, 4, 7]
    );
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllNonOverlapping
  it("does not overlap them", async () => {
    // `aaa` in `aaaaa` is two matches, not three.
    expect(await all(ascii("aaa"), ascii("aaaaa"))).toEqual([0]);
    expect(await all(ascii("aa"), ascii("aaaa"))).toEqual([0, 2]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllMatchAtChunkBoundaryIsCountedOnce
  it("counts a match on a chunk boundary exactly once", async () => {
    const bytes = new Array(20).fill(0);
    bytes[6] = 0xaa;
    bytes[7] = 0xbb;
    for (const chunkSize of [1, 2, 3, 7, 8, 19, 20, 64]) {
      expect(await all([0xaa, 0xbb], bytes, { chunkSize }), `chunk ${chunkSize}`).toEqual([6]);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossChunkBoundary
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossMultipleChunkBoundaries
  it("finds them across several boundaries", async () => {
    const bytes: number[] = [];
    for (let i = 0; i < 10; i++) bytes.push(0xaa, 0xbb, 0x00, 0x00);
    expect(await all([0xaa, 0xbb], bytes, { chunkSize: 3 })).toEqual([
      0, 4, 8, 12, 16, 20, 24, 28, 32, 36,
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllCaseInsensitive
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllAcrossChunkBoundaryCaseInsensitive
  it("folds while scanning", async () => {
    expect(
      await all(ascii("ab"), ascii("ab AB Ab aB"), { folding: foldingFor("ascii", false) })
    ).toEqual([0, 3, 6, 9]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllReportsProgress
  it("reports progress reaching one", async () => {
    let last = -1;
    await scanAll(new Uint8Array([0xff]), storage(new Uint8Array(64).fill(0xff)), {
      folding: { kind: "exact" },
      chunkSize: 7,
      onMatches: () => {},
      onProgress: (value) => (last = Math.max(last, value)),
    });
    expect(last).toBe(1);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamReportsHowFarItHasScanned
  it("says how far it has scanned, so a partial index knows what it covers", async () => {
    const windows: number[] = [];
    await scanAll(new Uint8Array([0xaa]), storage(new Uint8Array(20)), {
      folding: { kind: "exact" },
      chunkSize: 7,
      onMatches: () => {},
      onWindow: (upTo) => windows.push(upTo),
    });
    expect(windows).toEqual([7, 14, 20]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllCancellationThrows
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamStopsMidScanOnShouldCancel
  it("stops early when told to, without claiming to have finished", async () => {
    let batches = 0;
    let progress = 0;
    await scanAll(new Uint8Array([0xff]), storage(new Uint8Array(64).fill(0xff)), {
      folding: { kind: "exact" },
      chunkSize: 8,
      onMatches: () => batches++,
      onProgress: (value) => (progress = value),
      shouldStop: () => batches >= 2,
    });
    expect(progress).toBeLessThan(1);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamFillsAMatchSet
  it("fills a match set", async () => {
    const result = parsePattern("AA", "hex");
    if (!result.ok) throw new Error("the pattern should parse");

    const bytes = new Uint8Array(500);
    for (let i = 0; i < 500; i += 25) bytes[i] = 0xaa;
    const builder = new MatchSetBuilder(result.pattern, { kind: "exact" }, bytes.length);
    await scanAll(result.pattern.bytes, storage(bytes), {
      folding: { kind: "exact" },
      chunkSize: 64,
      onMatches: (starts) => builder.add(starts),
    });

    const set = builder.finish();
    expect(set.total).toBe(20);
    expect(set.startAt(0)).toBe(0);
    expect(set.startAt(19)).toBe(475);
  });

  it("agrees with a naive scan over random data", async () => {
    for (let round = 0; round < 25; round++) {
      const random = new SeededRandom(0x5ea4c40 + round);
      const bytes = Array.from(random.bytes(random.int(1, 400)), (b) => b % 4);
      const pattern = Array.from(random.bytes(random.int(1, 4)), (b) => b % 4);

      // The obvious answer, non-overlapping, as the oracle.
      const expected: number[] = [];
      for (let at = 0; at + pattern.length <= bytes.length; ) {
        let i = 0;
        while (i < pattern.length && bytes[at + i] === pattern[i]) i++;
        if (i === pattern.length) {
          expected.push(at);
          at += pattern.length;
        } else at++;
      }

      expect(await all(pattern, bytes, { chunkSize: random.int(1, 40) }), `round ${round}`).toEqual(
        expected
      );
    }
  });
});

describe("the byte search itself", () => {
  it("finds a needle at every alignment", () => {
    const haystack = new Uint8Array(64).map((_, i) => i % 7);
    for (const needle of [[0], [1, 2], [3, 4, 5], [0, 1, 2, 3, 4, 5, 6]]) {
      const expected = (() => {
        for (let at = 0; at + needle.length <= haystack.length; at++) {
          let i = 0;
          while (i < needle.length && haystack[at + i] === needle[i]) i++;
          if (i === needle.length) return at;
        }
        return -1;
      })();
      expect(indexOfBytes(haystack, new Uint8Array(needle)), needle.join(",")).toBe(expected);
    }
  });

  it("answers the edges", () => {
    const haystack = new Uint8Array([1, 2, 3]);
    expect(indexOfBytes(haystack, new Uint8Array(0))).toBe(-1);
    expect(indexOfBytes(haystack, new Uint8Array([1, 2, 3, 4]))).toBe(-1);
    expect(indexOfBytes(haystack, new Uint8Array([3]))).toBe(2);
    expect(indexOfBytes(haystack, new Uint8Array([1]), 1)).toBe(-1);
  });
});

// MARK: - The rest of upstream's SearchEngineTests

const EXACT_FOLD: CaseFolding = { kind: "exact" };

/** The bytes a pattern resolves to; the tests below only use patterns that parse. */
function bytesOf(text: string, encoding: SearchEncoding): number[] {
  const result = parsePattern(text, encoding);
  if (!result.ok) throw new Error(`${text} does not parse as ${encoding}: ${result.reason}`);
  return asArray(result.pattern.bytes);
}

/** Every match start `scanAll` delivers, over any storage. */
async function everyStart(
  pattern: number[],
  where: number[] | ByteStorage,
  options: { folding?: CaseFolding; chunkSize?: number } = {}
): Promise<number[]> {
  const folding = options.folding ?? EXACT_FOLD;
  const starts: number[] = [];
  await scanAll(
    foldedPattern(new Uint8Array(pattern), folding),
    Array.isArray(where) ? storage(where) : where,
    {
      folding,
      ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
      onMatches: (found) => starts.push(...found),
    }
  );
  return starts;
}

/** An overlay over `base`, with `bytes` written at `at` — the unsaved content. */
async function edited(base: number[], at: number, bytes: number[]): Promise<EditOverlayStorage> {
  const overlay = new EditOverlayStorage(storage(base));
  await overlay.overwrite(at, new Uint8Array(bytes));
  return overlay;
}

const rangeText = (range: { start: number; end: number } | undefined) =>
  range === undefined ? undefined : `${range.start}-${range.end}`;

describe("a search for nothing", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testEmptyPatternThrows
  it("is refused rather than answered", async () => {
    await expect(
      findOne(new Uint8Array(0), storage([1, 2, 3]), { folding: EXACT_FOLD })
    ).rejects.toBeInstanceOf(SearchPatternEmpty);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllEmptyPatternThrows
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamEmptyPatternThrows
  it("is refused by the scan for every match too", async () => {
    await expect(
      scanAll(new Uint8Array(0), storage([1, 2, 3]), { folding: EXACT_FOLD, onMatches: () => {} })
    ).rejects.toBeInstanceOf(SearchPatternEmpty);
  });
});

describe("finding one match, and what it reads", () => {
  // [AA] at index 4 starts exactly at the caret; it must not be returned, or
  // Find Previous from a caret sitting on a match would re-find that same match
  // instead of moving backward.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindBackwardExcludesMatchStartingAtCaret
  it("excludes, going backward, a match that starts at the caret", async () => {
    expect(
      await find([0xaa], [0xaa, 0x00, 0xaa, 0x00, 0xaa], {
        from: 4,
        direction: "backward",
        chunkSize: 7,
      })
    ).toBe("2-3");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindUsesCurrentUnsavedContent
  it("reads the unsaved content", async () => {
    const overlay = await edited([0xaa, 0x00, 0x00, 0x00], 1, [0xbb]);
    const one = async (pattern: number[], from = 0) =>
      rangeText(await findOne(new Uint8Array(pattern), overlay, { folding: EXACT_FOLD, from }));

    expect(await one([0xbb])).toBe("1-2");
    expect(await one([0x00, 0x00])).toBe("2-4");
    expect(await one([0x00, 0x00], 3)).toBeUndefined();
    expect(await one([0xaa])).toBe("0-1");
  });

  // Windows overlap by `patternLength - 1`, so summing their lengths overshoots
  // the file: the forward scan used to report up to 1.36.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testForwardProgressNeverExceedsOne
  it("never reports forward progress past one", async () => {
    const reported: number[] = [];
    await findOne(new Uint8Array(5).fill(0xff), storage(new Uint8Array(100)), {
      folding: EXACT_FOLD,
      chunkSize: 10,
      onProgress: (value) => reported.push(value),
    });
    // A multi-chunk scan reports progress.
    expect(reported.length).toBeGreaterThan(0);
    expect(Math.max(...reported)).toBeLessThanOrEqual(1);
    expect(Math.min(...reported)).toBeGreaterThanOrEqual(0);
    // A completed scan ends at 100 %.
    expect(reported.at(-1)).toBe(1);
  });

  // A backward search covers [0, caret), so its progress must be measured over
  // that span. Measured against the whole file it opened at 91 % for a caret at
  // 10 % and crawled to 100 %.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testBackwardProgressMeasuresTheSearchedSpan
  it("measures backward progress over the span it searches", async () => {
    const reported: number[] = [];
    await findOne(new Uint8Array([0xff]), storage(new Uint8Array(1000)), {
      folding: EXACT_FOLD,
      from: 100,
      direction: "backward",
      chunkSize: 10,
      onProgress: (value) => reported.push(value),
    });
    expect(reported.length).toBeGreaterThan(0);
    // A scan that has just begun must not report near-completion.
    expect(reported[0] ?? 1).toBeLessThan(0.2);
    expect(Math.max(...reported)).toBeLessThanOrEqual(1);
    // And it still ends at 100 %.
    expect(reported.at(-1)).toBe(1);
  });
});

describe("every match, as upstream's findAll and match-starts stream", () => {
  // The same edges for the scan, whose answer is a list rather than one range:
  // every byte matching, nothing matching, nothing that could fit, and a match
  // ending exactly at EOF.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllEdges
  it("handles the edges", async () => {
    expect(await everyStart([0xaa], [0xaa, 0xaa, 0xaa])).toEqual([0, 1, 2]);
    expect(await everyStart([0xaa, 0xbb], [0x00, 0x01, 0x02])).toEqual([]);
    expect(await everyStart([0x00, 0x01, 0x02, 0x03], [0x00, 0x01])).toEqual([]);
    expect(await everyStart([0xaa, 0xbb], [0x00, 0x01, 0xaa, 0xbb])).toEqual([2]);
  });

  // After the edit the file is AA AA AA 00: every single-byte match at 0, 1 and
  // 2 is reported, adjacent and never overlapping.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testFindAllUsesCurrentUnsavedContent
  it("reads the unsaved content", async () => {
    const overlay = await edited([0xaa, 0x00, 0xaa, 0x00], 1, [0xaa]);
    expect(await everyStart([0xaa], overlay)).toEqual([0, 1, 2]);
  });

  // The highlighting scan delivers starts in file order, and the same matches a
  // sequence of Find Next searches lands on — the greys, the results panel and
  // Find Next must not disagree about what a match is.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamAgreesWithFindAll
  it("agrees with one match found after another", async () => {
    const bytes = [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad];
    const stepped: number[] = [];
    for (let from = 0; ; ) {
      const found = await findOne(new Uint8Array([0xde, 0xad]), storage(bytes), {
        folding: EXACT_FOLD,
        from,
      });
      if (found === undefined) break;
      stepped.push(found.start);
      from = found.end;
    }
    expect(await everyStart([0xde, 0xad], bytes)).toEqual(stepped);
  });

  // A batch is a delivery cost, not a limit: the batches partition the matches in
  // order, and the last one is short.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamBatchesInOrder
  it("delivers its batches in order", async () => {
    const batches: number[][] = [];
    await scanAll(new Uint8Array([0xaa]), storage(new Uint8Array(10).fill(0xaa)), {
      folding: EXACT_FOLD,
      chunkSize: 4,
      onMatches: (starts) => batches.push(starts),
    });
    expect(batches).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });

  // The count this scan feeds is the Find bar's diagnosis of the pattern, and the
  // results limit is a limit on listing, not on counting.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamIsNotCappedByTheResultsLimit
  it("is not capped by the results limit", async () => {
    const count = DEFAULT_MAX_RESULTS + 500;
    expect(await everyStart([0xaa], storage(new Uint8Array(count).fill(0xaa)))).toHaveLength(count);
  });

  // A pattern longer than the file finishes with nothing rather than failing: an
  // unfinished pattern in the field is not an error.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testMatchStartsStreamPatternLongerThanTheFileYieldsNothing
  it("delivers nothing for a pattern longer than the file", async () => {
    let batches = 0;
    await scanAll(new Uint8Array([1, 2, 3, 4]), storage([1, 2]), {
      folding: EXACT_FOLD,
      onMatches: () => batches++,
    });
    expect(batches).toBe(0);
  });
});

describe("the folding rules", () => {
  // The byte-wise fold is exactly that — bytes, wherever they sit. It models case
  // for a single-byte ASCII-compatible encoding and for nothing else, which is
  // why the rule is asked for by encoding instead of as a bare flag.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testTheByteWiseFoldIsByteLevel
  it("folds byte by byte, and nothing more, when asked to fold bytes", async () => {
    const data = [0x41, 0x00]; // UTF-16BE U+4100
    // A UTF-16BE pattern for U+6100 is 61 00 — a different character.
    const pattern = bytesOf("\u6100", "utf16BE");
    expect(pattern).toEqual([0x61, 0x00]);

    // Exact matching keeps the two characters apart.
    expect(await find(pattern, data, { folding: EXACT_FOLD })).toBeUndefined();
    // The byte-wise fold cannot tell a code unit's high byte from a letter.
    expect(await find(pattern, data, { folding: { kind: "asciiBytes" } })).toBeDefined();
  });

  // Hex is bytes, and bytes have no case: the rule for hex is exact whatever the
  // user asked for.
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

  // A code unit is two bytes counted from the string's own start, not from any
  // grid in the file — so a UTF-16 string is found wherever it sits, at an even
  // offset or an odd one.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingFindsStringsAtAnyOffsetEvenOrOdd
  it("finds a UTF-16 string at any offset, even or odd", async () => {
    const word = bytesOf("Setup", "utf16LE");
    const pattern = bytesOf("setup", "utf16LE");
    const folding: CaseFolding = { kind: "utf16", littleEndian: true };
    for (let padding = 0; padding <= 3; padding++) {
      const data = [...new Array<number>(padding).fill(0xff), ...word];
      const expected = `${padding}-${padding + word.length}`;
      expect(await find(pattern, data, { folding }), `forward, at offset ${padding}`).toBe(
        expected
      );
      expect(
        await find(pattern, data, { folding, from: padding + word.length, direction: "backward" }),
        `backward, at offset ${padding}`
      ).toBe(expected);
      expect(
        await everyStart(pattern, data, { folding }),
        `Search All, at offset ${padding}`
      ).toEqual([padding]);
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

  // A match crossing a window boundary is still found: the candidate walk uses
  // the same overlapped windows as the folded path.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingFindsAMatchAcrossAWindowBoundary
  it("finds a folded UTF-16 match across a window boundary", async () => {
    const word = bytesOf("Setup", "utf16LE");
    const pattern = bytesOf("setup", "utf16LE");
    // The string straddles the boundary of a 16-byte chunk.
    const padding = 13;
    const data = [...new Array<number>(padding).fill(0xff), ...word];
    const folding: CaseFolding = { kind: "utf16", littleEndian: true };
    expect(await find(pattern, data, { folding, chunkSize: 16 })).toBe(
      `${padding}-${padding + word.length}`
    );
    expect(await everyStart(pattern, data, { folding, chunkSize: 16 })).toEqual([padding]);
  });

  // Search All folds the same way, so a case-insensitive UTF-16 sweep reports
  // every occurrence whatever its case.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testUTF16FoldingInSearchAll
  it("folds UTF-16 in the scan for every match", async () => {
    const data = bytesOf("EfiEFIefi", "utf16LE");
    const pattern = bytesOf("efi", "utf16LE");
    // All three, one per spelling.
    expect(
      await everyStart(pattern, data, { folding: { kind: "utf16", littleEndian: true } })
    ).toEqual([0, 6, 12]);
  });
});

describe("a pattern's bytes written back as hex", () => {
  const hexTextOf = (text: string, encoding: SearchEncoding) => {
    const result = parsePattern(text, encoding);
    return result.ok ? patternHexText(result.pattern) : result.reason;
  };

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testASingleByteHasNoSeparator
  it("has no separator for a single byte", () => {
    expect(hexTextOf("0xff", "hex")).toBe("FF");
  });

  // Every form the parser accepts leads to the same text, because the text is
  // derived from the bytes rather than from what was typed.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testEveryAcceptedFormLeadsToTheSameText
  it("is the same text for every form the parser accepts", () => {
    for (const typed of ["DEADBEEF", "de ad be ef", "DE AD BE EF", "0xDE 0xAD 0xBE 0xEF"]) {
      expect(hexTextOf(typed, "hex"), `typed as ${typed}`).toBe("DE AD BE EF");
    }
  });

  // A text pattern's bytes can be written this way too — the property is about
  // the bytes — but nothing shows them so: the field holds the string the user
  // is looking for, not its encoding.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#HexPatternTextTests.testTextBytesCanAlsoBeWrittenOut
  it("can be written for a text pattern's bytes too", () => {
    expect(hexTextOf("AB", "ascii")).toBe("41 42");
  });
});

describe("a scan that shares its thread", () => {
  // The main thread's scans hand the event loop a turn between windows; the
  // answer must not depend on how many turns it took.
  it("waits out every pause it is given and still finds everything", async () => {
    const bytes = new Uint8Array(40);
    bytes.set([0xab, 0xcd], 3);
    bytes.set([0xab, 0xcd], 31);
    let pauses = 0;
    const pause = () => {
      pauses++;
      return Promise.resolve();
    };
    const found: number[] = [];

    await scanAll(new Uint8Array([0xab, 0xcd]), storage(bytes), {
      folding: foldingFor("hex", true),
      chunkSize: 8,
      pause,
      onMatches: (starts) => found.push(...starts),
    });
    const first = await findOne(new Uint8Array([0xab, 0xcd]), storage(bytes), {
      from: 10,
      folding: foldingFor("hex", true),
      chunkSize: 8,
      pause,
    });

    expect(found).toEqual([3, 31]);
    expect(first).toEqual({ start: 31, end: 33 });
    expect(pauses).toBeGreaterThan(5);
  });
});
