import { describe, expect, it } from "vitest";
import {
  asciiPattern,
  lastPatternMatch,
  type MaskedPattern,
  MaskedPatternError,
  maskedMatches,
  maskedPattern,
  maskedPatternHasHoles,
  maskedPatternHexText,
  parseHexPattern,
  scanPatterns,
  utf16LEPattern,
} from "@/core/search/maskedSearch";
import type { ByteRange } from "@/core/search/searchEngine";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { SeededRandom } from "@/core/testing/support";

/** Ported from `MaskedSearchTests.swift`. */

const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

const run = async (
  patterns: MaskedPattern[],
  bytes: number[] | Uint8Array,
  options: { range?: ByteRange; overlapping?: boolean; chunk?: number } = {}
): Promise<number[]> => {
  const found: number[] = [];
  await maskedMatches(
    patterns,
    new MemoryBackedStorage(Uint8Array.from(bytes)),
    (match) => {
      found.push(match.start);
      return true;
    },
    {
      ...(options.range ? { range: options.range } : {}),
      overlapping: options.overlapping ?? false,
      ...(options.chunk ? { chunkSize: options.chunk } : {}),
    }
  );
  return found;
};

const ascii = (s: string, ignoreCase = false): MaskedPattern =>
  maskedPattern(text(s), { folding: { kind: ignoreCase ? "asciiBytes" : "exact" } });

describe("MaskedSearchTests", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testHolesMatchAnyByte
  it("holes match any byte", async () => {
    const pattern = parseHexPattern("24 ?? 4D 49");
    expect(pattern.isWild).toEqual([false, true, false, false]);
    const bytes = [0, 0x24, 0x44, 0x4d, 0x49, 0, 0x24, 0x99, 0x4d, 0x49, 0x24, 0x44, 0x4d];
    expect(await run([pattern], bytes)).toEqual([1, 6]);
    expect(parseHexPattern("24??4D").isWild).toEqual([false, true, false]);
    expect(() => parseHexPattern("?? ??")).toThrow(MaskedPatternError);
    expect(() => parseHexPattern("ABC")).toThrow(MaskedPatternError);
    expect(() => parseHexPattern("4G")).toThrow(MaskedPatternError);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testOverlappingMatchesAreCountedOnlyWhenAskedFor
  it("overlapping matches are counted only when asked for", async () => {
    const bytes = new Array(6).fill(0xff);
    const pattern = parseHexPattern("FF FF");
    expect(await run([pattern], bytes)).toEqual([0, 2, 4]);
    expect(await run([pattern], bytes, { overlapping: true })).toEqual([0, 1, 2, 3, 4]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testAMatchAcrossTheChunkBoundaryIsFoundOnce
  it("a match across the chunk boundary is found once", async () => {
    const bytes = new Array(64).fill(0);
    for (const at of [14, 30, 48]) bytes.splice(at, 4, ...text("ABCD"));
    for (const chunk of [4, 7, 16, 1 << 20]) {
      expect(await run([ascii("ABCD")], bytes, { chunk })).toEqual([14, 30, 48]);
      expect(await run([ascii("ABCD")], bytes, { overlapping: true, chunk })).toEqual([14, 30, 48]);
    }
    const runs = new Array(40).fill(0xaa);
    const found = await run([maskedPattern([0xaa, 0xaa, 0xaa])], runs, {
      overlapping: true,
      chunk: 5,
    });
    expect(found.length).toBe(38);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testNothingFoundIsAnEmptyListAndARangeNarrowsTheSearch
  it("nothing found is an empty list and a range narrows the search", async () => {
    const bytes = text("one two one two");
    expect(await run([ascii("three")], bytes)).toEqual([]);
    expect(await run([ascii("one")], bytes, { range: { start: 1, end: 15 } })).toEqual([8]);
    expect(await run([ascii("one")], bytes, { range: { start: 8, end: 10 } })).toEqual([]);
    expect(await run([ascii("a much longer pattern than the file")], bytes)).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testCaseIsFoldedOnlyWhereTheEncodingHasLetters
  it("case is folded only where the encoding has letters", async () => {
    const bytes = text("Acer ACER acer");
    expect(await run([ascii("acer")], bytes)).toEqual([10]);
    expect(await run([ascii("acer", true)], bytes)).toEqual([0, 5, 10]);
    expect(await run([parseHexPattern("61 63")], bytes)).toEqual([10]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testUTF16IsFoundAtOddAddressesAndFoldedByUnits
  it("UTF-16 is found at odd addresses and folded by units", async () => {
    const acer = [0x41, 0, 0x63, 0, 0x65, 0, 0x72, 0];
    const bytes = [0x99, ...acer, 0x61, 0x41, 0x63, 0];
    const folding = { kind: "utf16", littleEndian: true } as const;
    const pattern = maskedPattern([0x61, 0, 0x63, 0, 0x65, 0, 0x72, 0], { folding });
    expect(await run([pattern], bytes)).toEqual([1]);
    const short = maskedPattern([0x61, 0, 0x63, 0], { folding });
    expect(await run([short], bytes)).toEqual([1]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testSeveralPatternsComeBackInOrderOfWhereTheyStart
  it("several patterns come back in order of where they start", async () => {
    const wide = [0x41, 0, 0x63, 0, 0x65, 0, 0x72, 0];
    const bytes = [...text("xAcer"), ...wide];
    const found: [number, number][] = [];
    await maskedMatches(
      [ascii("Acer"), maskedPattern(wide)],
      new MemoryBackedStorage(Uint8Array.from(bytes)),
      (match, pattern) => {
        found.push([match.start, pattern]);
        return true;
      },
      { chunkSize: 3 }
    );
    expect(found.map((f) => f[0])).toEqual([1, 5]);
    expect(found.map((f) => f[1])).toEqual([0, 1]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testAPatternLeadingWithZeroIsFoundEverywhereItIs
  it("a pattern that starts with 0x00 is found everywhere it is", async () => {
    const bytes = new Array<number>(64).fill(0);
    const address = [0x00, 0x80, 0x66, 0xff];
    for (const at of [0, 14, 60]) bytes.splice(at, 4, ...address);
    for (const chunk of [5, 16, 1 << 20]) {
      expect(await run([maskedPattern(address)], bytes, { chunk }), `chunk ${chunk}`).toEqual([
        0, 14, 60,
      ]);
    }
    expect(await run([parseHexPattern("00 ?? 66")], bytes)).toEqual([0, 14, 60]);
    expect(await run([maskedPattern([0, 0, 0])], [0, 0, 0, 0], { overlapping: true })).toEqual([
      0, 1,
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testVisitStopsTheScan
  it("visit stops the scan", async () => {
    let seen = 0;
    await maskedMatches([maskedPattern([0])], new MemoryBackedStorage(new Uint8Array(100)), () => {
      seen += 1;
      return seen < 3;
    });
    expect(seen).toBe(3);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testAWholeDumpIsSearchedInWellUnderASecond
  it("a whole dump is searched in well under a second", async () => {
    const bytes = new Uint8Array(16 << 20).fill(0xff);
    bytes.set([0x24, 0x44, 0x4d, 0x49], 0x6cf000);
    const began = Date.now();
    const found = await run([parseHexPattern("24 44 4D 49")], bytes);
    expect(found).toEqual([0x6cf000]);
    expect(Date.now() - began).toBeLessThan(1000);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MaskedSearchTests.swift#MaskedSearchTests.testAPatternThatMatchesEverywhereIsStillCountedQuickly
  it("a pattern that matches everywhere is still counted quickly", async () => {
    const bytes = new Uint8Array(4 << 20).fill(0xff);
    let count = 0;
    const began = Date.now();
    await maskedMatches([parseHexPattern("FF FF")], new MemoryBackedStorage(bytes), () => {
      count += 1;
      return true;
    });
    // Matches overlap by default, as in the find bar: one per byte but the last.
    expect(count).toBe((4 << 20) - 1);
    expect(Date.now() - began).toBeLessThan(5000);
  });
});

/**
 * The scan over bytes the caller reads: holes, case, and a match across the edge of a window.
 *
 * @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests
 */
describe("PatternScanTests", () => {
  const starts = (
    patterns: readonly MaskedPattern[],
    bytes: readonly number[],
    overlapping = false
  ): number[] => {
    const held = Uint8Array.from(bytes);
    const found: number[] = [];
    scanPatterns(
      patterns,
      held.length,
      (offset, length) => held.slice(offset, offset + length),
      (range) => {
        found.push(range.start);
        return true;
      },
      { overlapping, chunkSize: 4 }
    );
    return found;
  };

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testAHoleMatchesAnyByteAndAMatchAcrossAWindowIsFoundOnce
  it("a hole matches any byte, and a match across a window is found once", () => {
    const bytes = [0, 0, 0x24, 0x99, 0x4d, 0x49, 0, 0x24, 0x00, 0x4d, 0x49];
    expect(starts([parseHexPattern("24 ?? 4D 49")], bytes)).toEqual([2, 7]);
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testTextIsFoundInEitherCaseInASCIIAndInUTF16
  it("finds text in either case, in ASCII and in UTF-16", () => {
    const bytes = [
      ...Array.from("xx Setup ", (c) => c.charCodeAt(0)),
      0x53,
      0,
      0x45,
      0,
      0x54,
      0,
      0x55,
      0,
      0x50,
      0,
    ];
    expect(starts([asciiPattern("SETUP", true)], bytes)).toEqual([3]);
    expect(starts([utf16LEPattern("setup", true)], bytes)).toEqual([9]);
    expect(starts([asciiPattern("SETUP", false)], bytes)).toEqual([]);
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testOverlappingMatchesAreCountedOnlyWhenAsked
  it("counts overlapping matches only when asked", () => {
    const bytes = [0x41, 0x41, 0x41, 0x41];
    const pattern = asciiPattern("AA", false);
    expect(starts([pattern], bytes)).toEqual([0, 2]);
    expect(starts([pattern], bytes, true)).toEqual([0, 1, 2]);
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testAPatternThatIsNotOneIsRefused
  it("refuses a pattern that is not one", () => {
    expect(() => parseHexPattern("?? ??")).toThrow();
    expect(() => parseHexPattern("4G")).toThrow();
    expect(() => asciiPattern("Привет", false)).toThrow();
    expect(() => asciiPattern("", false)).toThrow();
  });

  // MARK: - Reading hex

  const refusal = (text: string): string | undefined => {
    try {
      parseHexPattern(text);
      return undefined;
    } catch (error) {
      return error instanceof MaskedPatternError ? error.reason : "other";
    }
  };

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testHexIsReadInPairsAcrossTheWholeText
  it("reads hex in pairs across the whole text", () => {
    for (const text of [
      "DEADBEEF",
      "DE AD BE EF",
      "0xDE 0xAD 0xBE 0xEF",
      "D EADBEEF",
      "de ad be ef",
    ]) {
      const pattern = parseHexPattern(text);
      expect([...pattern.bytes], text).toEqual([0xde, 0xad, 0xbe, 0xef]);
      expect(maskedPatternHasHoles(pattern), text).toBe(false);
    }
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testAHoleIsAWholeByteWhereverItIsWritten
  it("reads a hole as a whole byte wherever it is written", () => {
    for (const text of ["24 ?? 4D", "24??4D", "0x24 ?? 0x4D", "2 4?? 4D"]) {
      const pattern = parseHexPattern(text);
      expect(pattern.isWild, text).toEqual([false, true, false]);
      expect(maskedPatternHexText(pattern), text).toBe("24 ?? 4D");
    }
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testHalfAByteCannotBeMasked
  it("cannot mask half a byte", () => {
    for (const text of ["2?", "?4", "24 ?", "24 ? 4D", "24 2? 4D"]) {
      expect(refusal(text), text).toBe("partialByteMask");
    }
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testHolesAloneAndNonsenseAreRefusedAsSuch
  it("refuses holes alone and nonsense, each as such", () => {
    expect(refusal("?? ??")).toBe("holesOnly");
    expect(refusal("4G")).toBe("invalidHexPattern");
    expect(refusal("ABC")).toBe("invalidHexPattern");
    expect(refusal("0x")).toBe("invalidHexPattern");
    expect(refusal("   ")).toBe("invalidHexPattern");
  });

  // MARK: - How far a scan has got

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testEachWindowSaysHowFarTheScanHasGot
  it("says after each window how far the scan has got", () => {
    const bytes = new Uint8Array(10);
    const marks: number[] = [];
    const fractions: number[] = [];
    scanPatterns(
      [parseHexPattern("01")],
      10,
      (offset, length) => bytes.slice(offset, offset + length),
      () => true,
      {
        chunkSize: 4,
        onProgress: (fraction) => fractions.push(fraction),
        windowFinished: (upTo) => marks.push(upTo),
      }
    );
    expect(marks).toEqual([4, 8, 10]);
    expect(fractions).toEqual([0.4, 0.8, 1.0]);
  });

  // MARK: - Find Previous

  const last = (
    pattern: MaskedPattern,
    bytes: readonly number[],
    before: number,
    chunk = 4
  ): number | undefined => {
    const held = Uint8Array.from(bytes);
    return lastPatternMatch(
      pattern,
      held.length,
      before,
      (offset, length) => held.slice(offset, offset + length),
      { chunkSize: chunk }
    )?.start;
  };

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testFindPreviousIsTheLastMatchStartingBeforeTheAnchor
  it("finds as Find Previous the last match starting before the anchor", () => {
    const bytes = [0, 0x24, 0x11, 0x4d, 0, 0, 0, 0, 0, 0x24, 0x22, 0x4d, 0];
    const pattern = parseHexPattern("24 ?? 4D");
    expect(last(pattern, bytes, 13)).toBe(9);
    // A match starting at the anchor is not before it.
    expect(last(pattern, bytes, 9)).toBe(1);
    // One starting before it and running past it is.
    expect(last(pattern, bytes, 10)).toBe(9);
    expect(last(pattern, bytes, 1)).toBeUndefined();
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testFindPreviousStepsBackThroughARunOneByteAtATime
  it("steps Find Previous back through a run one byte at a time", () => {
    const bytes = new Array<number>(9).fill(0xff);
    const pattern = parseHexPattern("FF FF");
    let anchor = 9;
    const found: number[] = [];
    for (;;) {
      const start = last(pattern, bytes, anchor, 3);
      if (start === undefined) break;
      found.push(start);
      anchor = start;
    }
    // Every overlapping match, none skipped across a window.
    expect(found).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });

  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testFindPreviousFindsAMatchAcrossTheEdgeOfTwoWindows
  it("finds as Find Previous a match across the edge of two windows", () => {
    const bytes = new Array<number>(20).fill(0);
    bytes.splice(7, 4, 0x24, 0x44, 0x4d, 0x49);
    expect(last(parseHexPattern("24 44 4D 49"), bytes, 20, 4)).toBe(7);
    expect(last(parseHexPattern("24 44 4D 49"), bytes, 8, 4)).toBe(7);
  });

  // Looking through a window from its end back finds what every forward match up to the anchor
  // would have ended on — for holes, letters in either case, and a match across windows alike.
  // @upstream Packages/BytePattern/Tests/BytePatternTests/PatternScanTests.swift#PatternScanTests.testFindPreviousAgreesWithTheLastOfTheForwardMatches
  it("agrees in Find Previous with the last of the forward matches", () => {
    const random = new SeededRandom(0x5ca1ab1e);
    const alphabet = [0x00, 0xff, 0x41, 0x61, 0x42];
    const patterns = [
      parseHexPattern("FF FF"),
      parseHexPattern("41 ?? 41"),
      asciiPattern("aB", true),
      parseHexPattern("00 ?? ?? FF"),
    ];
    for (let round = 0; round < 200; round++) {
      const bytes = Array.from(
        { length: random.int(0, 41) },
        () => alphabet[random.int(0, alphabet.length)] ?? 0
      );
      const chunk = random.int(1, 10);
      const anchor = random.int(0, bytes.length + 1);
      for (const pattern of patterns) {
        const held = Uint8Array.from(bytes);
        const forward: number[] = [];
        scanPatterns(
          [pattern],
          held.length,
          (offset, length) => held.slice(offset, offset + length),
          (range) => {
            forward.push(range.start);
            return true;
          },
          { chunkSize: chunk, overlapping: true }
        );
        expect(
          last(pattern, bytes, anchor, chunk),
          `${maskedPatternHexText(pattern)} in ${bytes} before ${anchor}, windows of ${chunk}`
        ).toBe(forward.filter((start) => start < anchor).at(-1));
      }
    }
  });
});
