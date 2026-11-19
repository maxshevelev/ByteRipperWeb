import { describe, expect, it } from "vitest";
import type { SearchDirection } from "@/core/find/findContent";
import { ByteFindContent, type ByteQuery } from "@/core/search/byteFindContent";
import { EXACT, parsePattern, patternHasHoles, patternHexText } from "@/core/search/searchPattern";
import { attemptEncoding, attemptsFor, looksLikeHexBytes } from "@/core/search/smartSearch";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";

/**
 * The dump's search (#33): holes in a hex pattern, and matches that always overlap — counted,
 * stepped forward and back, and indexed the same way.
 *
 * @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests
 */

const parsed = (text: string, encoding: "hex" | "ascii", allowingHoles = false) => {
  const result = parsePattern(text, encoding, allowingHoles);
  if (!result.ok) throw new Error(`${text} does not parse: ${result.reason}`);
  return result.pattern;
};

const query = (hex: string): ByteQuery => ({ pattern: parsed(hex, "hex", true), folding: EXACT });

const content = (bytes: readonly number[], chunk = 4) =>
  new ByteFindContent(new MemoryBackedStorage(Uint8Array.from(bytes)), { chunkSize: chunk });

async function starts(search: ByteQuery, bytes: readonly number[], chunk = 4): Promise<number[]> {
  const found: number[] = [];
  let covered = 0;
  for await (const batch of content(bytes, chunk).matchStarts(
    search,
    () => false,
    () => {}
  )) {
    // What is known only grows.
    expect(batch.scannedUpTo).toBeGreaterThanOrEqual(covered);
    // A batch holds only starts below what it says is known.
    expect(Array.from(batch.starts).every((start) => start < batch.scannedUpTo)).toBe(true);
    covered = batch.scannedUpTo;
    found.push(...Array.from(batch.starts));
  }
  // The scan says it reached the end.
  expect(covered).toBe(bytes.length);
  return found;
}

async function step(
  search: ByteQuery,
  bytes: readonly number[],
  from: number,
  direction: SearchDirection,
  chunk = 4
): Promise<number | undefined> {
  const found = await content(bytes, chunk).firstMatch(
    search,
    from,
    direction,
    () => false,
    () => {}
  );
  return found?.start;
}

describe("ByteFindContentTests", () => {
  // MARK: - Overlapping, always

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testARunOfFFHoldsOneMatchOfFFFFLessThanItsLength
  it("holds in a run of FF one match of FF FF fewer than its length", async () => {
    const bytes = [0x00, ...new Array<number>(9).fill(0xff), 0x00];
    // Nine 0xFF are eight matches of FF FF, across the edges of windows too.
    expect(await starts(query("FF FF"), bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testFindNextAndPreviousWalkARunOneByteAtATime
  it("walks a run one byte at a time with Find Next and Find Previous", async () => {
    const bytes = [0x00, ...new Array<number>(5).fill(0xff), 0x00];
    const pattern = query("FF FF");
    // Find Next lands on a match starting at the anchor.
    expect(await step(pattern, bytes, 2, "forward")).toBe(2);
    // One byte on from the match at 2 is the match at 3, not the one at 4.
    expect(await step(pattern, bytes, 3, "forward")).toBe(3);
    // Find Previous is the last match starting before the anchor.
    expect(await step(pattern, bytes, 3, "backward")).toBe(2);
    // A run of five has its last match at 4.
    expect(await step(pattern, bytes, 5, "forward")).toBeUndefined();
    expect(await step(pattern, bytes, 1, "backward")).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testAPatternThatDoesNotOverlapItselfFindsWhatItAlwaysFound
  it("finds what it always found for a pattern that does not overlap itself", async () => {
    const bytes = new Array<number>(40).fill(0);
    for (const at of [3, 17, 30]) bytes.splice(at, 4, 0x24, 0x44, 0x4d, 0x49);
    const pattern: ByteQuery = { pattern: parsed("$DMI", "ascii"), folding: EXACT };
    expect(await starts(pattern, bytes)).toEqual([3, 17, 30]);
    expect(await step(pattern, bytes, 4, "forward")).toBe(17);
    expect(await step(pattern, bytes, 17, "backward")).toBe(3);
  });

  // MARK: - Holes

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testAHoleMatchesAnyByte
  it("matches any byte at a hole", async () => {
    const bytes = [0, 0x24, 0x44, 0x4d, 0x49, 0, 0x24, 0x00, 0x4d, 0x49, 0x24, 0x44, 0x4e, 0x49];
    const pattern = query("24 ?? 4D 49");
    expect(await starts(pattern, bytes)).toEqual([1, 6]);
    expect(await step(pattern, bytes, 2, "forward")).toBe(6);
    expect(await step(pattern, bytes, 14, "backward")).toBe(6);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testAMaskThatOverlapsItselfCountsEveryPlace
  it("counts every place of a mask that overlaps itself", async () => {
    expect(await starts(query("24 ?? 24"), [0x24, 0x24, 0x24, 0x24])).toEqual([0, 1]);
  });

  // MARK: - Reading the field

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testAHoleIsKeptOnlyWhereTheCallerSearchesWithOne
  it("keeps a hole only where the caller searches with one", () => {
    const masked = parsed("24 ?? 4D", "hex", true);
    expect(masked.isWild).toEqual([false, true, false]);
    // The form a search shows back.
    expect(patternHexText(masked)).toBe("24 ?? 4D");
    // A fill has to write every byte it names.
    expect(parsePattern("24 ?? 4D", "hex")).toEqual({ ok: false, reason: "invalidHexPattern" });
    expect(patternHasHoles(parsed("24 4D", "hex"))).toBe(false);
    // Half a byte cannot be masked.
    expect(parsePattern("24 2? 4D", "hex", true)).toEqual({ ok: false, reason: "partialByteMask" });
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/ByteFindContentTests.swift#ByteFindContentTests.testSmartSearchReadsAHexPatternWithHolesAsBytesFirst
  it("has Smart Search read a hex pattern with holes as bytes first", () => {
    expect(looksLikeHexBytes("24 ?? 4D 49")).toBe(true);
    expect(looksLikeHexBytes("24??4D49")).toBe(true);
    // A pair of its own is a byte.
    expect(looksLikeHexBytes("BE ??")).toBe(true);
    for (const text of ["be??", "FACE??", "??4D", "24 ?", "2?4D", "24?? 4D49"]) {
      // `??` at a run's edge, or not a pair, is text.
      expect(looksLikeHexBytes(text), text).toBe(false);
    }
    const attempts = attemptsFor("24 ?? 4D 49", false);
    const first = attempts[0];
    expect(first === undefined ? undefined : attemptEncoding(first)).toBe("hex");
    expect(first?.pattern.isWild).toEqual([false, true, false, false]);
    // As text, `??` is two question marks.
    expect(attempts.slice(1).every((attempt) => !patternHasHoles(attempt.pattern))).toBe(true);
  });
});
