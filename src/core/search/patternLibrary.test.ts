import { describe, expect, it } from "vitest";
import {
  decodePatternLibrary,
  encodePatternLibrary,
  type PatternLibrary,
} from "@/core/search/patternLibrary";
import type { SearchEncoding } from "@/core/search/searchPattern";
import {
  entriesSayTheSame,
  type SearchPatternEntry,
  searchPatternEntry,
} from "@/core/search/searchPatternEntry";
import {
  mintId,
  orderedEntries,
  SORT_KEY_STEP,
  SYNC_FORMAT,
  sortKeyBetween,
  syncedCollection,
  withOrder,
} from "@/core/sync/syncedCollection";

/**
 * The library as a document — what is written to a file, and what another
 * machine's build (the web edition's or the Mac app's) has to be able to read.
 */
const entry = (name: string, pattern: string, encoding: SearchEncoding = "hex") =>
  searchPatternEntry({ name, pattern, encoding });

describe("the library file", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testALibraryRoundTrips
  it("round-trips", () => {
    let library: PatternLibrary = withOrder(syncedCollection<SearchPatternEntry>(), [
      entry("ME FPT", "$FPT", "ascii"),
      entry("Capsule", "5A A5"),
    ]);
    library = {
      ...library,
      tombstones: [{ id: mintId(), deletedAt: Date.now() + 0.4, device: "8B2C" }],
      vector: { "8B2C": 3 },
    };

    const read = decodePatternLibrary(encodePatternLibrary(library));

    expect(orderedEntries(read).map((kept) => kept.name)).toEqual(["ME FPT", "Capsule"]);
    expect(read.entries.map((kept) => kept.id)).toEqual(library.entries.map((kept) => kept.id));
    expect(read.entries.map((kept) => kept.sortKey)).toEqual(
      library.entries.map((kept) => kept.sortKey)
    );
    read.entries.forEach((kept, index) => {
      const original = library.entries[index];
      if (original === undefined) throw new Error("an entry went missing");
      expect(entriesSayTheSame(kept, original)).toBe(true);
      // Kept to the millisecond — enough to order two edits, and legible.
      expect(Math.abs(kept.modifiedAt - original.modifiedAt)).toBeLessThan(1);
    });
    expect(read.tombstones.map((note) => note.id)).toEqual(library.tombstones.map((n) => n.id));
    expect(read.tombstones.map((note) => note.device)).toEqual(["8B2C"]);
    expect(
      Math.abs((read.tombstones[0]?.deletedAt ?? 0) - (library.tombstones[0]?.deletedAt ?? 0))
    ).toBeLessThan(1);
    expect(read.vector).toEqual(library.vector);
    expect(read.format).toBe(library.format);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testTheFileIsLegible
  it("is legible", () => {
    const text = encodePatternLibrary(
      withOrder(syncedCollection<SearchPatternEntry>(), [entry("ME FPT", "$FPT", "ascii")])
    );

    expect(text).toContain("\n");
    expect(text).toContain('"name" : "ME FPT"');
    expect(text.indexOf('"caseSensitive"')).toBeLessThan(text.indexOf('"encoding"'));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testAFileFromAnEarlierBuildReads
  it("reads a file from a build that had none of the syncing yet", () => {
    const library = decodePatternLibrary(
      '{ "entries": [ { "name": "ME FPT", "pattern": "$FPT", "encoding": "ascii" } ] }'
    );

    expect(library.entries).toHaveLength(1);
    expect(library.entries[0]?.name).toBe("ME FPT");
    expect(library.entries[0]?.sortKey).toBe(0);
    expect(library.entries[0]?.device).toBe("");
    expect(library.format).toBe(SYNC_FORMAT);
    expect(library.tombstones).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testAFileFromALaterBuildKeepsWhatThisBuildUnderstands
  it("keeps what this build understands of a file from a later one", () => {
    const library = decodePatternLibrary(`{ "format": 99, "somethingNew": true,
      "entries": [ { "id": "6B29FC40-CA47-1067-B31D-00DD010662DA",
                     "name": "ME FPT", "pattern": "$FPT", "encoding": "ascii",
                     "caseSensitive": false, "sortKey": 2048,
                     "modifiedAt": "2026-09-05T10:14:22Z", "device": "8B2C",
                     "colour": "red" } ] }`);

    expect(library.format).toBe(99);
    expect(library.entries).toHaveLength(1);
    expect(library.entries[0]?.id).toBe("6B29FC40-CA47-1067-B31D-00DD010662DA");
    expect(library.entries[0]?.sortKey).toBe(2048);
    expect(library.entries[0]?.device).toBe("8B2C");
    expect(library.entries[0]?.modifiedAt).toBe(Date.parse("2026-09-05T10:14:22Z"));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testGarbageThrows
  it("throws for text that is not a library at all", () => {
    expect(() => decodePatternLibrary("not json")).toThrow();
    expect(() => decodePatternLibrary('{ "entries": [ { "name": "no pattern" } ] }')).toThrow();
  });

  it("writes identities and times as the Mac app writes them", () => {
    const text = encodePatternLibrary(
      withOrder(syncedCollection<SearchPatternEntry>(), [entry("ME FPT", "$FPT")])
    );
    const written = JSON.parse(text) as { entries: { id: string; modifiedAt: string }[] };
    const first = written.entries[0];
    expect(first?.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(first?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("the library's order", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testOrderTravelsWithTheEntries
  it("travels with the entries", () => {
    const library = withOrder(syncedCollection<SearchPatternEntry>(), [
      entry("first", "11"),
      entry("second", "22"),
      entry("third", "33"),
    ]);

    expect(orderedEntries(library).map((kept) => kept.name)).toEqual(["first", "second", "third"]);
    expect(library.entries.map((kept) => kept.sortKey)).toEqual([1024, 2048, 3072]);

    const shuffled = { ...library, entries: [...library.entries].reverse() };
    expect(orderedEntries(shuffled).map((kept) => kept.name)).toEqual(["first", "second", "third"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testUnplacedEntriesKeepTheOrderTheyArrivedIn
  it("keeps unplaced entries in the order they arrived in", () => {
    const library = syncedCollection({
      entries: [entry("first", "11"), entry("second", "22"), entry("third", "33")],
    });

    expect(orderedEntries(library).map((kept) => kept.name)).toEqual(["first", "second", "third"]);
    expect(orderedEntries(library)).toEqual(orderedEntries(library));
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/PatternLibraryTests.swift#PatternLibraryTests.testAKeyBetweenTwoOthersNeedsNoRenumbering
  it("finds a key between two others without renumbering", () => {
    const between = sortKeyBetween(1024, 2048);
    expect(between).toBeGreaterThan(1024);
    expect(between).toBeLessThan(2048);

    expect(sortKeyBetween(3072, undefined)).toBeGreaterThan(3072);
    expect(sortKeyBetween(undefined, 1024)).toBeLessThan(1024);
    expect(sortKeyBetween(undefined, undefined)).toBe(SORT_KEY_STEP);
  });
});
