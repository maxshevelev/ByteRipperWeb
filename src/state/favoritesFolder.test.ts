import { beforeEach, describe, expect, it } from "vitest";
import {
  decodePatternLibrary,
  encodePatternLibrary,
  PATTERN_LIBRARY_RULES,
} from "@/core/search/patternLibrary";
import { type SearchPatternEntry, searchPatternEntry } from "@/core/search/searchPatternEntry";
import { FolderSync, type SyncFolderFiles } from "@/core/sync/folderSync";
import { orderedEntries } from "@/core/sync/syncedCollection";
import { libraryFileName } from "@/core/sync/syncFolderNaming";
import type { FolderAccess, FolderPlatform, LibraryFolder } from "@/platform/files/libraryFolder";
import { type KeyValueStore, memoryKeyValueStore } from "@/platform/storage/keyValueStore";
import {
  addFavorite,
  adoptLibraryFile,
  allowFolderAccess,
  chooseLibraryFolder,
  deviceStamp,
  favoritesSettled,
  favoritesStore,
  folderLibraries,
  getFavoritesFromFolder,
  importFavorites,
  keepFavoritesInBrowser,
  publishFavoritesTo,
  removeOwnFileFrom,
  replaceFavorites,
  resolveFavorites,
  restoreFavorites,
  setFavoritesStorage,
  setFolderPlatform,
  syncFavorites,
  syncProblem,
} from "@/state/favoritesStore";

// Upstream's LibraryLocationTests and the store half of LibraryConflictTests:
// the folder behind a picker that is a test's own, and other machines that are
// FolderSync instances over the same memory.
//
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testItSaysTheLibraryIsOnThisMacOnly
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testMovingRemembersTheFolderAndNamesTheFileItself
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testMovingIntoAnEmptyFileAsksNothing
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testCancellingThePanelChangesNothing
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testChoosingAFolderThatAlreadyHasALibraryJoinsIt
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testAnUnreadableFileIsNotTakenForAnEmptyOne
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testMovingOffersToRemoveTheOldFileAndKeepsItByDefault
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testTrashingTheOldFileLeavesTheLibraryInOnePlace
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testKeepingOnThisMacOffersToTrashThePublishedFile
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testRepublishingToTheSameFileAsksNothing
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testKeepingOnThisMacUnpublishesAndKeepsThePatterns
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testThePublishedPlaceIsRememberedAcrossALaunch
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testComingBackIsRememberedAcrossALaunch
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testTheLibraryIsReadOnlyButStillReadable
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testAnsweringResolvesAndPublishes
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testTheResolverClosesWhenTheQuestionIsAnsweredElsewhere
// @upstream-differs the store driven directly, without the tab; the folder is a memory one and its permission a map

class MemoryFolder implements SyncFolderFiles {
  readonly contents = new Map<string, string>();
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async list(): Promise<readonly string[]> {
    return [...this.contents.keys()];
  }

  async read(name: string): Promise<string | undefined> {
    return this.contents.get(name);
  }

  readonly write = async (name: string, contents: string): Promise<void> => {
    this.contents.set(name, contents);
  };

  readonly remove = async (name: string): Promise<void> => {
    this.contents.delete(name);
  };
}

/** What each folder lets this visit do. */
const access = new Map<MemoryFolder, FolderAccess>();

function folderOver(files: MemoryFolder): LibraryFolder {
  return {
    name: files.name,
    stored: { memory: files },
    files,
    permission: async (request) => {
      const now = access.get(files) ?? "granted";
      if (now === "prompt" && request) {
        access.set(files, "granted");
        return "granted";
      }
      return now;
    },
    watch: () => () => undefined,
    isSame: async (other) => other.files === files,
  };
}

let nextPick: MemoryFolder | undefined;
let nextRead: SyncFolderFiles | undefined;

const platform: FolderPlatform = {
  canKeepFolder: true,
  pick: async () => (nextPick === undefined ? undefined : folderOver(nextPick)),
  restore: (stored) => {
    const memory = (stored as { memory?: MemoryFolder } | undefined)?.memory;
    return memory === undefined ? undefined : folderOver(memory);
  },
  pickToRead: async () => nextRead,
};

let storage: KeyValueStore;

beforeEach(async () => {
  storage = memoryKeyValueStore();
  setFavoritesStorage(storage);
  setFolderPlatform(platform);
  nextPick = undefined;
  nextRead = undefined;
  access.clear();
  await restoreFavorites();
});

const state = () => favoritesStore.getSnapshot();
const names = () => state().favorites.map((kept) => kept.name);
const entry = (name: string, pattern: string) =>
  searchPatternEntry({ name, pattern, encoding: "hex" });
const ownFile = () => libraryFileName(deviceStamp(state().device.id));
const namesIn = (folder: MemoryFolder, file: string) =>
  orderedEntries(decodePatternLibrary(folder.contents.get(file) ?? "{}")).map((kept) => kept.name);

/** Another machine publishing to the same folder. */
async function otherMachine(folder: MemoryFolder, device = "other-mac") {
  const other = new FolderSync<SearchPatternEntry>({
    rules: PATTERN_LIBRARY_RULES,
    device,
    machine: () => "Mac mini",
    stamp: deviceStamp,
  });
  await other.setFolder(folder);
  return other;
}

async function keep(other: FolderSync<SearchPatternEntry>, kept: SearchPatternEntry) {
  const library = other.library;
  await other.save({
    ...library,
    entries: [...library.entries, { ...kept, sortKey: (library.entries.length + 1) * 1024 }],
  });
}

/** Chooses `folder` in the picker and publishes into it with `adopting`. */
async function move(
  folder: MemoryFolder,
  adopting: "merge" | "takeTheFile" | "replaceTheFile" = "merge"
) {
  await favoritesSettled();
  nextPick = folder;
  const chosen = await chooseLibraryFolder();
  if (chosen === undefined || "refused" in chosen) throw new Error("the picker gave a folder");
  const leftBehind = await publishFavoritesTo(chosen.folder, adopting);
  return { holds: chosen.holds, leftBehind };
}

describe("where the library is", () => {
  it("is in this browser until it is moved", () => {
    expect(state().folder).toBeUndefined();
    expect(syncProblem(state())).toBeUndefined();
  });

  it("asks nothing when moving into an empty folder, and publishes this browser's list", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("iCloud Drive");

    const { holds } = await move(folder);

    expect(holds).toEqual({ kind: "empty" });
    expect(state().folder).toEqual({ name: "iCloud Drive", access: "granted" });
    expect(namesIn(folder, ownFile())).toEqual(["ME FPT"]);
  });

  it("changes nothing when the picker is cancelled", async () => {
    nextPick = undefined;
    expect(await chooseLibraryFolder()).toBeUndefined();
    expect(state().folder).toBeUndefined();
  });

  it("is remembered for the next visit", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("Shared");
    await move(folder);

    await restoreFavorites();

    expect(state().folder).toEqual({ name: "Shared", access: "granted" });
    expect(names()).toEqual(["ME FPT"]);
  });

  it("unpublishes on Keep in This Browser, keeps the patterns, and the file where it is", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("Shared");
    await move(folder);

    const previous = await keepFavoritesInBrowser();

    expect(previous?.name).toBe("Shared");
    expect(state().folder).toBeUndefined();
    expect(names()).toEqual(["ME FPT"]);
    expect(folder.contents.has(ownFile())).toBe(true);
    await restoreFavorites();
    expect(state().folder).toBeUndefined();
  });

  it("offers the folder it moved away from, whose file only this browser's answer removes", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const first = new MemoryFolder("First");
    const second = new MemoryFolder("Second");
    await move(first);

    const { leftBehind } = await move(second);

    expect(leftBehind?.name).toBe("First");
    expect(first.contents.has(ownFile())).toBe(true);
    if (leftBehind !== undefined) await removeOwnFileFrom(leftBehind);
    expect(first.contents.has(ownFile())).toBe(false);
    expect(namesIn(second, ownFile())).toEqual(["ME FPT"]);
  });

  it("offers nothing when publishing to the same folder again", async () => {
    const folder = new MemoryFolder("Shared");
    await move(folder);
    const { leftBehind } = await move(folder);
    expect(leftBehind).toBeUndefined();
  });
});

describe("joining a folder that already holds a library", () => {
  async function aFolderWithTheirs() {
    const folder = new MemoryFolder("Shared");
    const other = await otherMachine(folder);
    await keep(other, entry("theirs", "AA"));
    addFavorite(entry("mine", "11"));
    return { folder, other };
  }

  it("says what is there, and merging keeps both lists", async () => {
    const { folder } = await aFolderWithTheirs();

    const { holds } = await move(folder, "merge");

    expect(holds).toEqual({ kind: "patterns", count: 1 });
    expect(new Set(names())).toEqual(new Set(["mine", "theirs"]));
  });

  it("drops this browser's list when taking the folder's", async () => {
    const { folder } = await aFolderWithTheirs();
    await move(folder, "takeTheFile");
    expect(names()).toEqual(["theirs"]);
  });

  it("keeps only this browser's list when replacing, and leaves the other machine's file alone", async () => {
    const { folder } = await aFolderWithTheirs();
    const theirs = folder.contents.get(libraryFileName(deviceStamp("other-mac")));

    await move(folder, "replaceTheFile");

    expect(names()).toEqual(["mine"]);
    expect(folder.contents.get(libraryFileName(deviceStamp("other-mac")))).toBe(theirs);
  });

  it("does not take a library it cannot read for an empty one", async () => {
    const folder = new MemoryFolder("Shared");
    folder.contents.set(libraryFileName(deviceStamp("other-mac")), "not a library at all");
    addFavorite(entry("mine", "11"));
    await favoritesSettled();
    nextPick = folder;

    const chosen = await chooseLibraryFolder();

    expect(chosen !== undefined && "holds" in chosen ? chosen.holds : undefined).toEqual({
      kind: "unreadable",
    });
    expect(folder.contents.has(ownFile())).toBe(false);
    expect(state().folder).toBeUndefined();
  });
});

describe("a visit that has not been allowed to write", () => {
  it("does not publish, says so, and carries on once allowed", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("Shared");
    await move(folder);
    access.set(folder, "prompt");

    await restoreFavorites();

    expect(state().folder).toEqual({ name: "Shared", access: "prompt" });
    expect(syncProblem(state())).toBe("no access to the library folder");

    const other = await otherMachine(folder);
    await keep(other, entry("from another machine", "BB"));
    await allowFolderAccess();

    expect(state().folder?.access).toBe("granted");
    expect(new Set(names())).toEqual(new Set(["ME FPT", "from another machine"]));
  });
});

describe("a question about the library", () => {
  /** This browser and another machine renamed one entry while neither saw the other. */
  async function aConflict() {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("Shared");
    await move(folder);
    const other = await otherMachine(folder);
    const [shared] = other.library.entries;
    if (shared === undefined) throw new Error("the other machine took the entry");
    await other.save({
      ...other.library,
      entries: [{ ...shared, name: "ME region table" }],
    });

    await keepFavoritesInBrowser();
    const [mine] = state().favorites;
    if (mine === undefined) throw new Error("the entry is here");
    replaceFavorites([{ ...mine, name: "Intel ME FPT" }]);
    await move(folder, "merge");
    return { folder, other, id: mine.id };
  }

  it("makes the library read-only, and says so in the one wording", async () => {
    await aConflict();

    expect(state().conflicts).toHaveLength(1);
    expect(syncProblem(state())).toBe("1 conflicting change");
    expect(names()).toEqual(["Intel ME FPT"]);
    expect(addFavorite(entry("while unresolved", "99"))).toBe(false);
    expect(importFavorites(encodePatternLibrary(state().document.local), "any.json")).toEqual({
      kind: "readOnly",
    });
  });

  it("publishes an answer, and the other machine takes it", async () => {
    const { other, id } = await aConflict();

    await resolveFavorites(new Map([[id, "keepTheirs"]]));
    await other.sync();

    expect(state().conflicts).toHaveLength(0);
    expect(names()).toEqual(["ME region table"]);
    expect(orderedEntries(other.library).map((kept) => kept.name)).toEqual(["ME region table"]);
  });

  it("is settled here by an answer given on the other machine", async () => {
    const { other, id } = await aConflict();
    await other.sync();
    expect(other.conflicts).toHaveLength(1);

    await other.resolve(new Map([[id, "keepOurs"]]));
    await syncFavorites();

    expect(state().conflicts).toHaveLength(0);
    expect(names()).toEqual(["ME region table"]);
  });
});

describe("a browser that lost its data", () => {
  it("lists its old file, and carries on writing it once told it was its own", async () => {
    addFavorite(entry("ME FPT", "24465054"));
    const folder = new MemoryFolder("Shared");
    await move(folder);
    const before = state().device.id;
    const oldFile = ownFile();

    // The site's data is cleared: a new device, with an empty list — and a new
    // page, which starts with no identity in memory either.
    setFavoritesStorage(memoryKeyValueStore());
    favoritesStore.update((current) => ({
      ...current,
      device: { id: "", label: current.device.label },
    }));
    await restoreFavorites();
    expect(state().device.id).not.toBe(before);
    await move(folder, "merge");
    const newFile = ownFile();
    expect(names()).toEqual(["ME FPT"]);

    const listed = await folderLibraries();
    expect(listed.find((file) => file.name === oldFile)?.adoptable).toBe(true);
    expect(listed.find((file) => file.name === newFile)?.own).toBe(true);

    expect(await adoptLibraryFile(oldFile)).toBe(true);

    expect(state().device.id).toBe(before);
    expect(ownFile()).toBe(oldFile);
    expect(folder.contents.has(newFile)).toBe(false);
    expect(namesIn(folder, oldFile)).toEqual(["ME FPT"]);
  });
});

describe("a browser that can only read a folder", () => {
  it("takes what the folder holds, and writes nothing", async () => {
    const folder = new MemoryFolder("Shared");
    const other = await otherMachine(folder);
    await keep(other, entry("from the Mac", "CC"));
    addFavorite(entry("mine", "11"));
    await favoritesSettled();
    const before = new Map(folder.contents);
    nextRead = { name: folder.name, list: () => folder.list(), read: (name) => folder.read(name) };

    const result = await getFavoritesFromFolder();

    expect(result).toEqual({ folder: "Shared", read: 1, problems: 0 });
    expect(new Set(names())).toEqual(new Set(["mine", "from the Mac"]));
    expect(folder.contents).toEqual(before);
    expect(state().folder).toBeUndefined();
  });
});
