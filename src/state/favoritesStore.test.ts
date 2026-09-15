import { beforeEach, describe, expect, it } from "vitest";
import {
  decodeFavoritesDocument,
  decodePatternLibrary,
  encodePatternLibrary,
} from "@/core/search/patternLibrary";
import { type SearchPatternEntry, searchPatternEntry } from "@/core/search/searchPatternEntry";
import { orderedEntries, syncedCollection } from "@/core/sync/syncedCollection";
import { isLibraryFile, libraryFileName } from "@/core/sync/syncFolderNaming";
import { incremented, writesBy } from "@/core/sync/versionVector";
import { type KeyValueStore, memoryKeyValueStore } from "@/platform/storage/keyValueStore";
import {
  abandonImport,
  addFavorite,
  answerImport,
  deviceLabelFor,
  deviceStamp,
  existingFavorite,
  exportFavorites,
  favoritesStore,
  importFavorites,
  replaceFavorites,
  restoreFavorites,
  setFavoritesStorage,
} from "@/state/favoritesStore";

// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testNoFileYetIsAnEmptyLibrary
// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testAKeptPatternIsStampedAndPlaced
// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testIdsSurviveALaunch
// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testRemovingAnEntryLeavesATombstone
// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testOnlyAChangedEntryIsRestamped
// @upstream ByteRipperTests/FavoritesFileTests.swift#FavoritesFileTests.testEveryWriteCountsAgainstThisMachine
// @upstream ByteRipperTests/FavoritePatternStoreTests.swift#FavoritePatternStoreTests.testTheSameSearchIsNotKeptTwice
// @upstream ByteRipperTests/FavoritePatternStoreTests.swift#FavoritePatternStoreTests.testTheSamePatternInAnotherEncodingIsAnotherEntry
// @upstream ByteRipperTests/FavoritePatternStoreTests.swift#FavoritePatternStoreTests.testTheOrderIsTheOrderItWasGiven

let storage: KeyValueStore;

beforeEach(async () => {
  storage = memoryKeyValueStore();
  setFavoritesStorage(storage);
  abandonImport();
  await restoreFavorites();
});

const state = () => favoritesStore.getSnapshot();
const names = () => state().favorites.map((kept) => kept.name);
const entry = (name: string, pattern: string, caseSensitive = false) =>
  searchPatternEntry({ name, pattern, encoding: "ascii", caseSensitive });

describe("keeping a pattern", () => {
  it("adds it at the end, stamped as this browser's", () => {
    expect(addFavorite(entry("ME FPT", "$FPT"), 1_000)).toBe(true);
    expect(addFavorite(entry("Capsule", "_FVH"), 2_000)).toBe(true);

    expect(names()).toEqual(["ME FPT", "Capsule"]);
    const [first, second] = state().favorites;
    expect((second?.sortKey ?? 0) > (first?.sortKey ?? 0)).toBe(true);
    expect(second?.modifiedAt).toBe(2_000);
    expect(second?.device).toBe(state().device.id);
  });

  it("counts every write against this browser", () => {
    addFavorite(entry("ME FPT", "$FPT"));
    addFavorite(entry("Capsule", "_FVH"));
    expect(writesBy(state().document.local.vector, state().device.id)).toBe(2);
  });

  it("refuses the same search under another name, and says which one it is", () => {
    addFavorite(entry("ME FPT", "$FPT"));

    expect(addFavorite(entry("Intel FPT", "$FPT"))).toBe(false);
    expect(names()).toEqual(["ME FPT"]);
    expect(
      existingFavorite({ pattern: "$FPT", encoding: "ascii", caseSensitive: false })?.name
    ).toBe("ME FPT");
    // A different case rule is a different search.
    expect(addFavorite(entry("FPT, exactly", "$FPT", true))).toBe(true);
  });
});

describe("replacing the list", () => {
  it("stamps what changed, and only that", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);
    addFavorite(entry("Capsule", "_FVH"), 1_000);
    const [fpt, capsule] = state().favorites;
    if (fpt === undefined || capsule === undefined) throw new Error("two favourites were kept");

    replaceFavorites([{ ...fpt, name: "Intel ME FPT" }, capsule], 5_000);

    const [renamed, untouched] = state().favorites;
    expect(renamed?.name).toBe("Intel ME FPT");
    expect(renamed?.modifiedAt).toBe(5_000);
    expect(untouched?.modifiedAt).toBe(1_000);
  });

  it("keeps the order given", () => {
    addFavorite(entry("first", "11"));
    addFavorite(entry("second", "22"));
    const [first, second] = state().favorites;
    if (first === undefined || second === undefined) throw new Error("two favourites were kept");

    replaceFavorites([second, first]);

    expect(names()).toEqual(["second", "first"]);
  });

  it("leaves a tombstone for what was removed, so another machine hears of it", () => {
    addFavorite(entry("keep", "11"));
    addFavorite(entry("mistake", "22"));
    const [kept, mistake] = state().favorites;
    if (kept === undefined || mistake === undefined) throw new Error("two favourites were kept");

    replaceFavorites([kept], 9_000);

    expect(names()).toEqual(["keep"]);
    expect(state().document.local.tombstones).toEqual([
      { id: mistake.id, deletedAt: 9_000, device: state().device.id },
    ]);
  });
});

describe("what is kept between visits", () => {
  it("reads the library back", async () => {
    addFavorite(entry("ME FPT", "$FPT"));

    await restoreFavorites();

    expect(names()).toEqual(["ME FPT"]);
    const stored = await storage.get<string>("Favorites");
    expect(orderedEntries(decodeFavoritesDocument(stored ?? "").local).map((e) => e.name)).toEqual([
      "ME FPT",
    ]);
  });

  it("keeps this browser's identity once it has one", async () => {
    const first = state().device.id;
    expect(first).not.toBe("");

    await restoreFavorites();

    expect(state().device.id).toBe(first);
  });
});

describe("the library as a file", () => {
  it("is named by this browser's stamp, as its file in a shared folder would be", () => {
    expect(deviceStamp("5E1D0C3A-8B7F-4A2E-9C6D-1F0B2A3C4D5E")).toBe("6AC8C510BD54");
    const { name } = exportFavorites();
    expect(name).toBe(libraryFileName(deviceStamp(state().device.id)));
    expect(isLibraryFile(name)).toBe(true);
  });

  it("carries the list, and says which browser wrote it", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);

    const library = decodePatternLibrary(exportFavorites().contents);

    expect(orderedEntries(library).map((kept) => kept.name)).toEqual(["ME FPT"]);
    expect(library.machine).toBe(state().device.label);
    expect(writesBy(library.vector, state().device.id)).toBe(1);
  });
});

describe("importing a library file", () => {
  const writes = () => writesBy(state().document.local.vector, state().device.id);
  const fromAnotherMachine = (...entries: SearchPatternEntry[]) =>
    encodePatternLibrary(
      syncedCollection<SearchPatternEntry>({
        entries,
        vector: incremented(syncedCollection().vector, "OTHER"),
        machine: "Mac mini",
      })
    );

  it("merges into the list rather than replacing it", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);
    const capsule = {
      ...entry("Capsule", "_FVH"),
      sortKey: 1024,
      modifiedAt: 500,
      device: "OTHER",
    };

    const result = importFavorites(fromAnotherMachine(capsule), "Mac mini.json", 2_000);

    expect(result).toEqual({ kind: "imported", added: 1, changed: 0, removed: 0 });
    expect([...names()].sort()).toEqual(["Capsule", "ME FPT"]);
    expect(writes()).toBe(2);
    expect(writesBy(state().document.local.vector, "OTHER")).toBe(1);
  });

  it("does not write when the file holds nothing new", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);
    const { name, contents } = exportFavorites();

    expect(importFavorites(contents, name, 2_000)).toEqual({
      kind: "imported",
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(writes()).toBe(1);
  });

  it("does not bring back what was deleted after the file was written", () => {
    addFavorite(entry("keep", "11"), 1_000);
    addFavorite(entry("mistake", "22"), 1_000);
    const { name, contents } = exportFavorites();
    const [kept] = state().favorites;
    if (kept === undefined) throw new Error("a favourite was kept");
    replaceFavorites([kept], 3_000);

    importFavorites(contents, name, 4_000);

    expect(names()).toEqual(["keep"]);
  });

  it("asks where both sides changed an entry, and keeps nothing until it is answered", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);
    const exported = decodePatternLibrary(exportFavorites().contents);
    const [fpt] = state().favorites;
    if (fpt === undefined) throw new Error("a favourite was kept");
    replaceFavorites([{ ...fpt, name: "Intel ME FPT" }], 2_000);
    const theirs = encodePatternLibrary({
      ...exported,
      entries: exported.entries.map((kept) => ({
        ...kept,
        name: "ME region table",
        modifiedAt: 2_500,
      })),
    });

    expect(importFavorites(theirs, "Other.json", 3_000)).toEqual({ kind: "asking", questions: 1 });
    expect(names()).toEqual(["Intel ME FPT"]);
    expect(state().pendingImport?.fileName).toBe("Other.json");
    expect(writes()).toBe(2);

    const answered = answerImport(new Map([[fpt.id, "keepTheirs"]]), 4_000);

    expect(answered).toEqual({ kind: "imported", added: 0, changed: 1, removed: 0 });
    expect(names()).toEqual(["ME region table"]);
    expect(state().favorites[0]?.id).toBe(fpt.id);
    expect(state().pendingImport).toBeUndefined();
  });

  it("keeps nothing of an import whose questions were not answered", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);
    const exported = decodePatternLibrary(exportFavorites().contents);
    const [fpt] = state().favorites;
    if (fpt === undefined) throw new Error("a favourite was kept");
    replaceFavorites([{ ...fpt, name: "Intel ME FPT" }], 2_000);
    const theirs = encodePatternLibrary({
      ...exported,
      entries: exported.entries.map((kept) => ({ ...kept, name: "ME region table" })),
    });
    importFavorites(theirs, "Other.json", 3_000);

    abandonImport();

    expect(names()).toEqual(["Intel ME FPT"]);
    expect(state().pendingImport).toBeUndefined();
    expect(answerImport(new Map([[fpt.id, "keepTheirs"]]))).toBeUndefined();
  });

  it("says so when the file is not a library", () => {
    addFavorite(entry("ME FPT", "$FPT"), 1_000);

    expect(importFavorites("not JSON at all", "notes.txt")).toEqual({ kind: "unreadable" });
    expect(importFavorites('{ "hello" : 1 }', "other.json")).toEqual({ kind: "unreadable" });
    expect(names()).toEqual(["ME FPT"]);
  });
});

describe("a browser's name", () => {
  it("says which browser, on which system", () => {
    expect(
      deviceLabelFor(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
      )
    ).toBe("Chrome on Windows");
    expect(
      deviceLabelFor(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
      )
    ).toBe("Safari on macOS");
    expect(
      deviceLabelFor("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")
    ).toBe("Firefox on Linux");
    expect(
      deviceLabelFor(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
      )
    ).toBe("Edge on Windows");
  });
});
