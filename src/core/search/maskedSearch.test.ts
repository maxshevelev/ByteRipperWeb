import { describe, expect, it } from "vitest";
import {
  type MaskedPattern,
  MaskedPatternError,
  maskedMatches,
  maskedPattern,
  parseHexPattern,
} from "@/core/search/maskedSearch";
import type { ByteRange } from "@/core/search/searchEngine";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";

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
      ...(options.overlapping ? { overlapping: true } : {}),
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
    expect(count).toBe(2 << 20);
    expect(Date.now() - began).toBeLessThan(5000);
  });
});
