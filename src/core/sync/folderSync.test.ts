import { describe, expect, it } from "vitest";
import {
  decodePatternLibrary,
  encodePatternLibrary,
  PATTERN_LIBRARY_RULES,
  type PatternLibrary,
} from "@/core/search/patternLibrary";
import { type SearchPatternEntry, searchPatternEntry } from "@/core/search/searchPatternEntry";
import { FolderSync, type SyncFolderFiles, writerOf } from "@/core/sync/folderSync";
import type { SyncDocument } from "@/core/sync/syncDocument";
import {
  orderedEntries,
  type SyncedCollection,
  sortKeyBetween,
  syncedCollection,
  withOrder,
} from "@/core/sync/syncedCollection";
import { libraryFileName } from "@/core/sync/syncFolderNaming";
import { incremented, mergedVectors } from "@/core/sync/versionVector";

// Upstream's LibrarySyncTests: two FolderSync instances over one folder *are*
// two machines — each with its own record, its own file in the folder, its own
// name in a version vector, and no knowledge of the other except through the
// folder. The folder here counts its writes, where upstream reads a file's
// modification date.
//
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testWhatOneMachineKeepsReachesTheOther
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testEachMachineWritesOnlyItsOwnFile
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAThirdMachineTakesEverythingInTheFolder
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTwoMachinesAddingSeparatelyEndUpWithBoth
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testADeletionTravels
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTheFileSaysWhichMacWroteIt
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testRenamingTheMacIsNotAChangeToTheLibrary
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTheLibraryStandsWithoutTheSharedFolder
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testEditingWhileTheFolderIsAwayPublishesLater
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTheLocalFileKeepsTheTruthAndTheBasesTogether
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testEachMachinesFileHasItsOwnBase
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnUnpublishedLibraryHasNoBase
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAPatternTypedIntoThisMachinesFileByHandArrives
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testALineDeletedByHandComesBack
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testStartingTheLibraryTakesWhatTheFolderHolds
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testSyncingWithNothingToSayDoesNotTouchTheFile
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnotherArrayOrderIsNotAChange
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTwoMachinesSettle
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testTwoMachinesRenamingOneEntryIsAQuestion
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testARaceIsAQuestionOnBothMachines
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnAnswerOnOneMachineSettlesTheOther
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testBothMachinesAreAskedWhenBothVersionsReachTheFolder
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testNothingIsSavedWhileAQuestionStands
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnsweringPublishesTheResult
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testKeepingMyVersionPublishesIt
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAQuestionDoesNotSettleItself
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testKeepingMyVersionWorksWithAThirdMachineInTheHistory
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnAnsweredQuestionStaysAnswered
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnEditIsNotLostWhenAFileComesBackFromAnotherLineage
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAQuestionIsNotSweptAwayByCountersThatMissedThisMachine
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAnEditAgainstADeletionIsAQuestionOnBothMachines
// @upstream ByteRipperTests/LibrarySyncTests.swift#LibrarySyncTests.testAMergedChangeIsAnnounced
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testWhatTheFolderHoldsIsReadBeforeAnythingIsWritten
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testMergingKeepsBothLists
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testTakingTheFilesPatternsDropsThisMacs
// @upstream ByteRipperTests/LibraryLocationTests.swift#LibraryLocationTests.testReplacingKeepsOnlyThisMacsList
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testKeepingMineIsAnAnswer
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testACopyLeftBySyncClientIsLeftAlone
// @upstream ByteRipperTests/LibraryConflictTests.swift#LibraryConflictTests.testAFileTheUserNamedIsLeftAlone
// @upstream-differs async machines over a memory folder; the watcher and poll tests are the store's

/** A stand-in for a device id's digest: twelve upper-case hex digits, stable per id. */
function stamp(device: string): string {
  const hash = (text: string) => {
    let h = 0x811c9dc5;
    for (const character of text) {
      h ^= character.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return (hash(device).slice(0, 6) + hash(`${device}#`).slice(0, 6)).toUpperCase();
}

class MemoryFolder implements SyncFolderFiles {
  readonly name = "Shared";
  readonly contents = new Map<string, string>();
  readonly writes = new Map<string, number>();

  async list(): Promise<readonly string[]> {
    return [...this.contents.keys()];
  }

  async read(name: string): Promise<string | undefined> {
    return this.contents.get(name);
  }

  readonly write = async (name: string, contents: string): Promise<void> => {
    this.contents.set(name, contents);
    this.writes.set(name, (this.writes.get(name) ?? 0) + 1);
  };

  readonly remove = async (name: string): Promise<void> => {
    this.contents.delete(name);
  };
}

/** What a machine is called, for the file it signs. */
const labels = new Map<string, string>();
/** What each machine last kept of its own record. */
const kept = new Map<string, SyncDocument<SearchPatternEntry>>();

const fileOf = (device: string) => libraryFileName(stamp(device));

async function machine(
  folder: MemoryFolder,
  device: string,
  options: { readonly publishing?: boolean } = {}
): Promise<FolderSync<SearchPatternEntry>> {
  const sync = new FolderSync<SearchPatternEntry>({
    rules: PATTERN_LIBRARY_RULES,
    device,
    machine: () => labels.get(device) ?? device,
    stamp,
    persist: (document) => {
      kept.set(device, document);
    },
  });
  if (options.publishing !== false) await sync.setFolder(folder);
  return sync;
}

const entry = (name: string, pattern: string) =>
  searchPatternEntry({ name, pattern, encoding: "hex" });

/** Adds an entry the way the store does — through `save`, which is what publishes. */
async function add(
  added: SearchPatternEntry,
  to: FolderSync<SearchPatternEntry>
): Promise<SearchPatternEntry> {
  const library = to.library;
  const placed = {
    ...added,
    sortKey: sortKeyBetween(orderedEntries(library).at(-1)?.sortKey, undefined),
    device: to.device,
  };
  await to.save({ ...library, entries: [...library.entries, placed] });
  return placed;
}

async function rename(
  renamed: SearchPatternEntry,
  name: string,
  on: FolderSync<SearchPatternEntry>
): Promise<void> {
  const library = on.library;
  await on.save({
    ...library,
    entries: library.entries.map((kept) => (kept.id === renamed.id ? { ...kept, name } : kept)),
  });
}

const names = (sync: FolderSync<SearchPatternEntry>) =>
  orderedEntries(sync.library).map((kept) => kept.name);

const namesIn = (folder: MemoryFolder, device: string) =>
  orderedEntries(decodePatternLibrary(folder.contents.get(fileOf(device)) ?? "{}")).map(
    (kept) => kept.name
  );

const writes = (folder: MemoryFolder, device: string) => folder.writes.get(fileOf(device)) ?? 0;

/** Rewrites a machine's file the way a text editor or a restored backup would. */
function edit(
  folder: MemoryFolder,
  device: string,
  change: (library: PatternLibrary) => PatternLibrary
) {
  const library = decodePatternLibrary(folder.contents.get(fileOf(device)) ?? "{}");
  folder.contents.set(fileOf(device), encodePatternLibrary(change(library)));
}

/** Two machines that renamed the same entry while neither could see the other. */
async function aRace(folder: MemoryFolder) {
  const desk = await machine(folder, "desk");
  const laptop = await machine(folder, "laptop");
  const shared = await add(entry("ME FPT", "$FPT"), desk);
  await laptop.sync();
  await laptop.setFolder(undefined);
  await rename(shared, "laptop name", laptop);
  await rename(shared, "desk name", desk);
  await laptop.setFolder(folder);
  return { desk, laptop, shared };
}

describe("the medium", () => {
  it("carries what one machine keeps to the other, and nothing else does", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");

    await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    expect(names(laptop)).toEqual(["ME FPT"]);
  });

  it("has each machine write only its own file", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("from the desk", "11"), desk);
    await laptop.sync();
    await add(entry("from the laptop", "22"), laptop);

    const deskWrites = writes(folder, "desk");
    for (let round = 0; round < 3; round++) await laptop.sync();

    expect(writes(folder, "desk")).toBe(deskWrites);
    expect(new Set(namesIn(folder, "laptop"))).toEqual(
      new Set(["from the desk", "from the laptop"])
    );
    expect(namesIn(folder, "desk")).toEqual(["from the desk"]);
  });

  it("gives a third machine everything in the folder, and no question", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("from the desk", "11"), desk);
    await add(entry("from the laptop", "22"), laptop);

    const mini = await machine(folder, "mini");

    expect(new Set(names(mini))).toEqual(new Set(["from the desk", "from the laptop"]));
    expect(mini.conflicts).toHaveLength(0);
  });

  it("makes fifteen of twelve and three", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await add(entry("desk pattern", "11"), desk);
    await add(entry("laptop pattern", "22"), laptop);
    await desk.sync();
    await laptop.sync();

    expect(desk.conflicts).toHaveLength(0);
    expect(new Set(names(desk))).toEqual(new Set(["ME FPT", "desk pattern", "laptop pattern"]));
    expect(new Set(names(laptop))).toEqual(new Set(names(desk)));
  });

  it("carries a deletion as a deletion", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const doomed = await add(entry("mistake", "11"), desk);
    await laptop.sync();
    expect(names(laptop)).toEqual(["mistake"]);

    const library = desk.library;
    await desk.save({
      ...library,
      entries: library.entries.filter((kept) => kept.id !== doomed.id),
      tombstones: [...library.tombstones, { id: doomed.id, deletedAt: Date.now(), device: "desk" }],
    });
    await laptop.sync();

    expect(names(laptop)).toEqual([]);
  });

  it("says inside the file which machine wrote it", async () => {
    const folder = new MemoryFolder();
    labels.set("desk", "Maxim's Mac mini");
    const desk = await machine(folder, "desk");
    await add(entry("ME FPT", "$FPT"), desk);

    expect(decodePatternLibrary(folder.contents.get(fileOf("desk")) ?? "").machine).toBe(
      "Maxim's Mac mini"
    );
    labels.delete("desk");
  });

  it("does not take renaming the machine for a change to the library", async () => {
    const folder = new MemoryFolder();
    labels.set("desk", "Mac mini");
    const desk = await machine(folder, "desk");
    await add(entry("ME FPT", "$FPT"), desk);
    const settled = writes(folder, "desk");

    labels.set("desk", "Something Else Entirely");
    for (let round = 0; round < 3; round++) await desk.sync();

    expect(writes(folder, "desk")).toBe(settled);
    expect(namesIn(folder, "desk")).toEqual(["ME FPT"]);
    labels.delete("desk");
  });
});

describe("the truth is local", () => {
  it("stands without the shared folder", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("ME FPT", "$FPT"), desk);

    folder.contents.delete(fileOf("desk"));
    await desk.sync();

    expect(names(desk)).toEqual(["ME FPT"]);
  });

  it("publishes what was edited while the folder was away", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("shared", "11"), desk);
    await laptop.sync();

    await desk.setFolder(undefined);
    await add(entry("typed offline", "22"), desk);
    expect(new Set(names(desk))).toEqual(new Set(["shared", "typed offline"]));

    await desk.setFolder(folder);
    await laptop.sync();

    expect(new Set(names(laptop))).toEqual(new Set(["shared", "typed offline"]));
  });

  it("keeps the truth and the bases in one record", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("ME FPT", "$FPT"), desk);

    const document = kept.get("desk");
    const empty = syncedCollection<SearchPatternEntry>();
    expect(orderedEntries(document?.local ?? empty).map((e) => e.name)).toEqual(["ME FPT"]);
    const base = document?.bases[fileOf("desk")];
    expect(orderedEntries(base ?? empty).map((e) => e.name)).toEqual(["ME FPT"]);
  });

  it("keeps one base per machine's file", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("from the desk", "11"), desk);
    await add(entry("from the laptop", "22"), laptop);
    const mini = await machine(folder, "mini");

    expect(new Set(Object.keys(mini.bases))).toEqual(
      new Set([fileOf("desk"), fileOf("laptop"), fileOf("mini")])
    );
  });

  it("has no base while nothing is published", async () => {
    const folder = new MemoryFolder();
    const alone = await machine(folder, "alone", { publishing: false });
    await add(entry("ME FPT", "$FPT"), alone);

    expect(Object.keys(alone.bases)).toEqual([]);
    expect(names(alone)).toEqual(["ME FPT"]);
  });
});

describe("edited by hand", () => {
  it("takes a pattern typed into this machine's file, and does not write over it", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("kept in the app", "11"), desk);

    edit(folder, "desk", (library) => ({
      ...library,
      entries: [...library.entries, entry("typed into the file", "22")],
    }));
    await desk.sync();

    expect(new Set(names(desk))).toEqual(new Set(["kept in the app", "typed into the file"]));
    expect(new Set(namesIn(folder, "desk"))).toEqual(
      new Set(["kept in the app", "typed into the file"])
    );
  });

  it("brings back a line deleted by hand: absence is not a deletion", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("first", "11"), desk);
    await add(entry("second", "22"), desk);

    edit(folder, "desk", (library) => ({
      ...library,
      entries: library.entries.filter((kept) => kept.name !== "second"),
    }));
    await desk.sync();

    expect(new Set(names(desk))).toEqual(new Set(["first", "second"]));
  });

  it("takes what the folder holds when it starts, and what arrived since on the next sync", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("from the desk", "11"), desk);

    const laptop = await machine(folder, "laptop");
    expect(names(laptop)).toEqual(["from the desk"]);

    await add(entry("arrived while asleep", "22"), desk);
    await laptop.sync();

    expect(new Set(names(laptop))).toEqual(new Set(["from the desk", "arrived while asleep"]));
  });

  it("leaves the file alone when a sync has nothing to say", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("ME FPT", "$FPT"), desk);
    const written = writes(folder, "desk");

    for (let round = 0; round < 5; round++) await desk.sync();

    expect(writes(folder, "desk")).toBe(written);
  });

  it("does not take another array order for a change", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    await add(entry("first", "11"), desk);
    await add(entry("second", "22"), desk);

    edit(folder, "desk", (library) => ({ ...library, entries: [...library.entries].reverse() }));
    const written = writes(folder, "desk");
    for (let round = 0; round < 3; round++) await desk.sync();

    expect(writes(folder, "desk")).toBe(written);
    expect(names(desk)).toEqual(["first", "second"]);
  });

  it("lets two machines settle, so neither writes any more", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("from the desk", "11"), desk);
    await laptop.sync();
    await add(entry("from the laptop", "22"), laptop);
    await desk.sync();
    await laptop.sync();
    await desk.sync();

    const deskWrites = writes(folder, "desk");
    const laptopWrites = writes(folder, "laptop");
    for (let round = 0; round < 3; round++) {
      await desk.sync();
      await laptop.sync();
    }

    expect(writes(folder, "desk")).toBe(deskWrites);
    expect(writes(folder, "laptop")).toBe(laptopWrites);
    expect(new Set(names(desk))).toEqual(new Set(["from the desk", "from the laptop"]));
    expect(new Set(names(laptop))).toEqual(new Set(names(desk)));
  });
});

describe("concurrent writes", () => {
  it("makes two renames of one entry a question, and each machine keeps its own meanwhile", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await laptop.setFolder(undefined);
    await rename(shared, "Intel ME FPT", desk);
    await rename(shared, "ME region table", laptop);
    await laptop.setFolder(folder);

    expect(laptop.conflicts).toHaveLength(1);
    expect(names(laptop)).toEqual(["ME region table"]);
    expect(namesIn(folder, "laptop")).toEqual(["ME region table"]);
    expect(namesIn(folder, "desk")).toEqual(["Intel ME FPT"]);
  });

  it("asks both machines about a race", async () => {
    const folder = new MemoryFolder();
    const { desk, laptop } = await aRace(folder);
    await desk.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(desk.conflicts).toHaveLength(1);
    expect(names(laptop)).toEqual(["laptop name"]);
    expect(names(desk)).toEqual(["desk name"]);
  });

  it("settles the other machine with an answer given on one", async () => {
    const folder = new MemoryFolder();
    const { desk, laptop, shared } = await aRace(folder);
    await desk.sync();
    expect(desk.conflicts).toHaveLength(1);

    await laptop.resolve(new Map([[shared.id, "keepOurs"]]));
    await desk.sync();

    expect(desk.conflicts).toHaveLength(0);
    expect(names(desk)).toEqual(["laptop name"]);
    expect(names(laptop)).toEqual(["laptop name"]);
  });

  it("asks both when both versions reach the folder", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await rename(shared, "Intel ME FPT", desk);
    const inTransit = folder.contents.get(fileOf("desk")) ?? "";
    folder.contents.delete(fileOf("desk"));
    await rename(shared, "ME region table", laptop);
    folder.contents.set(fileOf("desk"), inTransit);

    await laptop.sync();
    await desk.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(desk.conflicts).toHaveLength(1);
    expect(names(laptop)).toEqual(["ME region table"]);
    expect(names(desk)).toEqual(["Intel ME FPT"]);
  });

  it("refuses a save while a question stands", async () => {
    const folder = new MemoryFolder();
    const { laptop } = await aRace(folder);
    expect(laptop.conflicts.length).toBeGreaterThan(0);

    await add(entry("while unresolved", "99"), laptop);

    expect(names(laptop)).toEqual(["laptop name"]);
  });

  it("publishes an answer, and the other machine takes it", async () => {
    const folder = new MemoryFolder();
    const { desk, laptop, shared } = await aRace(folder);

    await laptop.resolve(new Map([[shared.id, "keepTheirs"]]));
    await desk.sync();

    expect(laptop.conflicts).toHaveLength(0);
    expect(names(laptop)).toEqual(["desk name"]);
    expect(names(desk)).toEqual(["desk name"]);
  });

  it("publishes keeping this machine's version, which the other takes without a question", async () => {
    const folder = new MemoryFolder();
    const { desk, laptop, shared } = await aRace(folder);
    expect(laptop.conflicts.length).toBeGreaterThan(0);

    await laptop.resolve(new Map([[shared.id, "keepOurs"]]));

    expect(laptop.conflicts).toHaveLength(0);
    expect(names(laptop)).toEqual(["laptop name"]);
    expect(namesIn(folder, "laptop")).toEqual(["laptop name"]);

    await desk.sync();
    expect(desk.conflicts).toHaveLength(0);
    expect(names(desk)).toEqual(["laptop name"]);
  });

  it("does not let a question settle itself", async () => {
    const folder = new MemoryFolder();
    const { laptop } = await aRace(folder);
    expect(laptop.conflicts).toHaveLength(1);

    for (let round = 0; round < 3; round++) await laptop.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(namesIn(folder, "desk")).toEqual(["desk name"]);
  });

  it("keeps this machine's version even with a third machine in the history", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await laptop.setFolder(undefined);
    await rename(shared, "laptop name", laptop);
    await rename(shared, "desk name", desk);
    edit(folder, "desk", (library) => ({
      ...library,
      vector: mergedVectors(library.vector, { "retired-mac": 5 }),
    }));

    await laptop.setFolder(folder);
    expect(laptop.conflicts).toHaveLength(1);

    await laptop.resolve(new Map([[shared.id, "keepOurs"]]));

    expect(laptop.conflicts).toHaveLength(0);
    const after = decodePatternLibrary(folder.contents.get(fileOf("laptop")) ?? "");
    expect(orderedEntries(after).map((e) => e.name)).toEqual(["laptop name"]);
    expect(after.vector["retired-mac"]).toBe(5);

    await desk.sync();
    expect(names(desk)).toEqual(["laptop name"]);
  });

  it("keeps an answered question answered", async () => {
    const folder = new MemoryFolder();
    const { laptop, shared } = await aRace(folder);
    await laptop.resolve(new Map([[shared.id, "keepOurs"]]));

    for (let round = 0; round < 3; round++) await laptop.sync();

    expect(laptop.conflicts).toHaveLength(0);
    expect(names(laptop)).toEqual(["laptop name"]);
  });

  it("does not lose an edit when a file comes back from another lineage", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await rename(shared, "laptop name", laptop);
    expect(names(laptop)).toEqual(["laptop name"]);

    edit(folder, "desk", (library) => ({
      ...library,
      entries: library.entries.map((kept) =>
        kept.id === shared.id ? { ...kept, name: "desk name" } : kept
      ),
      vector: { "desk-restored": 9 },
    }));
    await laptop.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(names(laptop)).toEqual(["laptop name"]);
  });

  it("does not sweep a question away with counters that missed this machine", async () => {
    const folder = new MemoryFolder();
    const { laptop } = await aRace(folder);
    expect(laptop.conflicts).toHaveLength(1);

    edit(folder, "desk", (library) => ({
      ...library,
      vector: incremented(mergedVectors(library.vector, { "a-third-mac": 7 }), "desk"),
    }));
    await laptop.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(names(laptop)).toEqual(["laptop name"]);
  });

  it("asks both machines about an edit against a deletion, and one answer settles both", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    await laptop.sync();

    await rename(shared, "Intel ME FPT", desk);
    const inTransit = folder.contents.get(fileOf("desk")) ?? "";
    folder.contents.delete(fileOf("desk"));
    const library = laptop.library;
    await laptop.save({
      ...library,
      entries: library.entries.filter((kept) => kept.id !== shared.id),
      tombstones: [
        ...library.tombstones,
        { id: shared.id, deletedAt: Date.now(), device: "laptop" },
      ],
    });
    folder.contents.set(fileOf("desk"), inTransit);

    await laptop.sync();
    await desk.sync();

    expect(laptop.conflicts).toHaveLength(1);
    expect(desk.conflicts).toHaveLength(1);

    for (let round = 0; round < 3; round++) {
      await desk.sync();
      await laptop.sync();
    }
    expect(desk.conflicts).toHaveLength(1);
    expect(names(desk)).toEqual(["Intel ME FPT"]);

    await desk.resolve(new Map([[shared.id, "keepOurs"]]));
    await laptop.sync();

    expect(desk.conflicts).toHaveLength(0);
    expect(laptop.conflicts).toHaveLength(0);
    expect(names(laptop)).toEqual(["Intel ME FPT"]);
  });

  it("announces a change that arrives from the folder", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("ME FPT", "$FPT"), desk);

    let announcements = 0;
    laptop.onChange(() => {
      announcements += 1;
    });
    await laptop.sync();

    expect(announcements).toBeGreaterThan(0);
    expect(names(laptop)).toEqual(["ME FPT"]);
  });
});

// Upstream's LibraryLocationTests, for the part that is the loop's rather than
// the tab's: what joining a folder that already holds a library does.
describe("joining a folder", () => {
  /** Another machine's library, as it would have left it in the folder. */
  function theirLibrary(folder: MemoryFolder, entries: readonly string[]) {
    const library: SyncedCollection<SearchPatternEntry> = withOrder(
      syncedCollection<SearchPatternEntry>({ vector: { "other-mac": 1 } }),
      entries.map((name, index) => entry(name, (0xa0 + index).toString(16).toUpperCase()))
    );
    folder.contents.set(fileOf("other-mac"), encodePatternLibrary(library));
  }

  it("reads what the folder holds before anything is written", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here", { publishing: false });

    expect(await here.inspect(folder)).toEqual({ kind: "empty" });
    folder.contents.set(fileOf("other-mac"), encodePatternLibrary(syncedCollection()));
    expect(await here.inspect(folder)).toEqual({ kind: "empty" });
    theirLibrary(folder, ["one", "two"]);
    expect(await here.inspect(folder)).toEqual({ kind: "patterns", count: 2 });
    folder.contents.set(fileOf("other-mac"), "nonsense");
    expect(await here.inspect(folder)).toEqual({ kind: "unreadable" });
  });

  it("keeps both lists when merging", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here", { publishing: false });
    await add(entry("mine", "11"), here);
    theirLibrary(folder, ["theirs"]);

    await here.publish(folder, "merge");

    expect(new Set(names(here))).toEqual(new Set(["mine", "theirs"]));
    expect(new Set(namesIn(folder, "here"))).toEqual(new Set(["mine", "theirs"]));
  });

  it("drops this machine's list when taking the folder's", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here", { publishing: false });
    await add(entry("mine", "11"), here);
    theirLibrary(folder, ["theirs"]);

    await here.publish(folder, "takeTheFile");

    expect(names(here)).toEqual(["theirs"]);
  });

  it("replaces with tombstones, never by writing over another machine's file", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here", { publishing: false });
    await add(entry("mine", "11"), here);
    theirLibrary(folder, ["theirs"]);
    const theirs = folder.contents.get(fileOf("other-mac"));

    await here.publish(folder, "replaceTheFile");

    expect(names(here)).toEqual(["mine"]);
    expect(namesIn(folder, "here")).toEqual(["mine"]);
    expect(folder.contents.get(fileOf("other-mac"))).toBe(theirs);
    expect(decodePatternLibrary(folder.contents.get(fileOf("here")) ?? "").tombstones).toHaveLength(
      1
    );
  });

  it("writes this machine's file on joining an empty folder, so a second machine has one to take", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here", { publishing: false });
    await add(entry("ME FPT", "$FPT"), here);

    await here.publish(folder, "merge");

    expect(namesIn(folder, "here")).toEqual(["ME FPT"]);
  });

  it("leaves alone what a sync client or a person put in the folder", async () => {
    const folder = new MemoryFolder();
    const here = await machine(folder, "here");
    await add(entry("mine", "11"), here);
    const stray = encodePatternLibrary(
      withOrder(syncedCollection<SearchPatternEntry>(), [entry("left behind", "22")])
    );
    const copies = [
      "ByteRipper Patterns 2.json",
      `ByteRipper Patterns (${stamp("desk")}) 2.json`,
      "ByteRipper Patterns backup.json",
    ];
    for (const name of copies) folder.contents.set(name, stray);

    await here.sync();

    expect(names(here)).toEqual(["mine"]);
    for (const name of copies) expect(folder.contents.has(name)).toBe(true);
  });
});

describe("taking from a folder that can only be read", () => {
  /** What a browser that cannot write a folder is handed by its picker. */
  const readOnly = (folder: MemoryFolder): SyncFolderFiles => ({
    name: folder.name,
    list: () => folder.list(),
    read: (name) => folder.read(name),
  });

  it("merges every machine's file and writes nothing", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const laptop = await machine(folder, "laptop");
    await add(entry("from the desk", "11"), desk);
    await add(entry("from the laptop", "22"), laptop);
    const before = new Map(folder.contents);

    const browser = await machine(folder, "browser", { publishing: false });
    await add(entry("kept in the browser", "33"), browser);
    const result = await browser.fetchFrom(readOnly(folder));

    expect(result).toEqual({ read: 2, problems: 0 });
    expect(new Set(names(browser))).toEqual(
      new Set(["from the desk", "from the laptop", "kept in the browser"])
    );
    expect(folder.contents).toEqual(before);
  });

  it("keeps a base for each file, so the next fetch weighs only what changed", async () => {
    const folder = new MemoryFolder();
    const desk = await machine(folder, "desk");
    const shared = await add(entry("ME FPT", "$FPT"), desk);
    const browser = await machine(folder, "browser", { publishing: false });
    await browser.fetchFrom(readOnly(folder));

    await rename(shared, "Intel ME FPT", desk);
    await browser.fetchFrom(readOnly(folder));

    expect(Object.keys(browser.bases)).toContain(fileOf("desk"));
    expect(browser.conflicts).toHaveLength(0);
    expect(names(browser)).toEqual(["Intel ME FPT"]);
  });
});

describe("a browser that lost its data", () => {
  it("finds the device a file belongs to among the file's own counters", async () => {
    const folder = new MemoryFolder();
    const old = await machine(folder, "0F3C8A1E-2B4D-4E6F-8A9B-1C2D3E4F5A6B");
    await add(entry("ME FPT", "$FPT"), old);
    const file = fileOf(old.device);
    const library = decodePatternLibrary(folder.contents.get(file) ?? "");

    expect(writerOf(library, file, stamp)).toBe(old.device);
    expect(writerOf(library, fileOf("someone else"), stamp)).toBeUndefined();
  });
});
