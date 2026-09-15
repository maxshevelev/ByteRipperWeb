import { describe, expect, it } from "vitest";
import type { SearchEncoding } from "@/core/search/searchPattern";
import {
  entriesSayTheSame,
  entryFolding,
  isSameSearch,
  isUsableEntry,
  searchPatternEntry,
} from "@/core/search/searchPatternEntry";

/**
 * What a kept search is made of. The entry carries the bookkeeping a shared
 * library needs — an id, a place in the order, a time and a machine — and none
 * of it may change what the app does with it.
 */
const entry = (
  name = "",
  pattern = "DE AD",
  encoding: SearchEncoding = "hex",
  caseSensitive = false
) => searchPatternEntry({ name, pattern, encoding, caseSensitive });

describe("a kept search", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchPatternEntryTests.swift#SearchPatternEntryTests.testEveryEntryHasItsOwnId
  it("has an id of its own, and keeps it through a rename", () => {
    const one = entry("ME FPT", "$FPT", "ascii");
    const two = entry("ME FPT", "$FPT", "ascii");
    expect(one.id).not.toBe(two.id);

    const renamed = { ...one, name: "Intel ME FPT" };
    expect(renamed.id).toBe(one.id);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchPatternEntryTests.swift#SearchPatternEntryTests.testEqualityIsAboutWhatTheEntrySaysNotWhichRecordItIs
  it("is equal to another that says the same, whichever record it is", () => {
    const one = { ...entry("ME FPT", "$FPT", "ascii"), sortKey: 1 };
    const two = {
      ...entry("ME FPT", "$FPT", "ascii"),
      sortKey: 99,
      modifiedAt: one.modifiedAt + 3_600_000,
      device: "another-mac",
    };
    expect(entriesSayTheSame(one, two)).toBe(true);

    expect(entriesSayTheSame(one, { ...two, name: "Intel ME FPT" })).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchPatternEntryTests.swift#SearchPatternEntryTests.testSameSearchIgnoresTheName
  it("is the same search whatever it is called", () => {
    expect(isSameSearch(entry("one", "$FPT", "ascii"), entry("other", "$FPT", "ascii"))).toBe(true);
    expect(isSameSearch(entry("one", "$FPT", "ascii"), entry("one", "$FPT", "utf8"))).toBe(false);
    expect(isSameSearch(entry("one", "$FPT", "ascii"), entry("one", "$FPT", "ascii", true))).toBe(
      false
    );
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchPatternEntryTests.swift#SearchPatternEntryTests.testUsabilityAndFoldingComeFromTheEncoding
  it("takes its usability and its folding from the encoding", () => {
    expect(isUsableEntry(entry("", "DE AD", "hex"))).toBe(true);
    expect(isUsableEntry(entry("", "DE A", "hex"))).toBe(false);
    expect(isUsableEntry(entry("", "", "ascii"))).toBe(false);

    expect(entryFolding(entry("", "41", "hex", true))).toEqual({ kind: "exact" });
    expect(entryFolding(entry("", "root", "ascii"))).toEqual({ kind: "asciiBytes" });
  });
});
