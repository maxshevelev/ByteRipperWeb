import { describe, expect, it } from "vitest";
import {
  decodeFavoritesDocument,
  encodeFavoritesDocument,
  encodePatternLibrary,
  PATTERN_LIBRARY_RULES,
  type PatternLibrary,
} from "@/core/search/patternLibrary";
import { searchPatternEntry } from "@/core/search/searchPatternEntry";
import { documentsEqual, syncDocument } from "@/core/sync/syncDocument";
import { orderedEntries, syncedCollection, withOrder } from "@/core/sync/syncedCollection";
import type { VersionVector } from "@/core/sync/versionVector";

/**
 * What this machine keeps: its own library, and the state it last agreed with
 * each of the other machines' files.
 */
const library = (names: string[], vector: VersionVector = {}): PatternLibrary => ({
  ...withOrder(
    syncedCollection(),
    names.map((name) => searchPatternEntry({ name, pattern: "AA", encoding: "hex" }))
  ),
  vector,
});

describe("the favourites document", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/FavoritesDocumentTests.swift#FavoritesDocumentTests.testBasesSurviveARoundTrip
  it("keeps one base per machine through a round trip", () => {
    const document = syncDocument(library(["mine"]), {
      "ByteRipper Patterns (3F7A9C21B0E4).json": library(["theirs"], { mini: 2 }),
    });

    const read = decodeFavoritesDocument(encodeFavoritesDocument(document));

    expect(documentsEqual(read, document, PATTERN_LIBRARY_RULES)).toBe(true);
    expect(Object.keys(read.bases)).toHaveLength(1);
    const base = read.bases["ByteRipper Patterns (3F7A9C21B0E4).json"];
    expect(base === undefined ? [] : orderedEntries(base).map((kept) => kept.name)).toEqual([
      "theirs",
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/FavoritesDocumentTests.swift#FavoritesDocumentTests.testABareLibraryIsReadAsTheTruth
  it("reads a bare library as the truth, with nothing agreed", () => {
    const read = decodeFavoritesDocument(encodePatternLibrary(library(["mine"])));

    expect(orderedEntries(read.local).map((kept) => kept.name)).toEqual(["mine"]);
    expect(read.bases).toEqual({});
  });
});
