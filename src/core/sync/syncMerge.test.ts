import { describe, expect, it } from "vitest";
import {
  type LibraryResolution,
  mergePatternLibraries,
  type PatternLibrary,
  resolvePatternLibrary,
} from "@/core/search/patternLibrary";
import { type SearchPatternEntry, searchPatternEntry } from "@/core/search/searchPatternEntry";
import {
  mintId,
  orderedEntries,
  type SyncTombstone,
  syncedCollection,
  TOMBSTONE_LIFETIME_MS,
} from "@/core/sync/syncedCollection";
import { conflictId, isResolved } from "@/core/sync/syncMerge";
import { writesBy } from "@/core/sync/versionVector";

/**
 * The merge, which is the feature. Two machines write inside the sync window,
 * and what comes back has to be reconciled without losing anything and without
 * asking about everything. These are upstream's table of cases: what is decided
 * silently, and the three things that must never be.
 */

const mac = "desk-mac";
const laptop = "laptop";
const EPOCH = 1_700_000_000_000;

function entry(
  name: string,
  pattern: string,
  options: { id?: string; sortKey?: number; device?: string; at?: number } = {}
): SearchPatternEntry {
  return searchPatternEntry({
    id: options.id ?? mintId(),
    name,
    pattern,
    encoding: "hex",
    sortKey: options.sortKey ?? 1024,
    modifiedAt: EPOCH + (options.at ?? 0) * 1000,
    device: options.device ?? mac,
  });
}

function library(
  entries: SearchPatternEntry[],
  vector: Record<string, number>,
  tombstones: SyncTombstone[] = []
): PatternLibrary {
  return syncedCollection({ entries, tombstones, vector });
}

const tombstone = (id: string, device: string, deletedAt = Date.now()): SyncTombstone => ({
  id,
  deletedAt,
  device,
});

const names = (collection: PatternLibrary) => collection.entries.map((kept) => kept.name);
const answers = (pairs: [string, LibraryResolution][]) => new Map(pairs);

describe("a merge that is not one", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAVersionThatHasSeenEverythingSimplyWins
  it("takes the version that has seen everything", () => {
    const mine = library([entry("ME FPT", "$FPT")], { [mac]: 1 });
    const theirs = library([entry("ME FPT", "$FPT"), entry("Capsule", "5A A5")], {
      [mac]: 1,
      [laptop]: 1,
    });

    const outcome = mergePatternLibraries(mine, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(names(outcome.library)).toEqual(["ME FPT", "Capsule"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAStaleFileChangesNothing
  it("changes nothing for a stale file", () => {
    const theirs = library([entry("ME FPT", "$FPT")], { [mac]: 1 });
    const mine = library([entry("ME FPT", "$FPT"), entry("Capsule", "5A A5")], { [mac]: 2 });

    const outcome = mergePatternLibraries(theirs, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(names(outcome.library)).toEqual(["ME FPT", "Capsule"]);
  });
});

describe("a concurrent merge it can decide", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testConcurrentAdditionsAreBothKept
  it("keeps both sides' additions", () => {
    const shared = entry("ME FPT", "$FPT");
    const base = library([shared], { [mac]: 1 });
    const mine = library([shared, entry("mine", "11")], { [mac]: 2 });
    const theirs = library([shared, entry("theirs", "22", { device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(new Set(names(outcome.library))).toEqual(new Set(["ME FPT", "mine", "theirs"]));
    expect(writesBy(outcome.library.vector, mac)).toBe(2);
    expect(writesBy(outcome.library.vector, laptop)).toBe(1);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testOnlyOneSideChangedIt
  it("takes the side that changed an entry", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([entry("ME FPT", "$FPT", { id })], { [mac]: 2 });
    const theirs = library([entry("Intel ME FPT", "$FPT", { id, device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(names(outcome.library)).toEqual(["Intel ME FPT"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testBothSidesChangedItTheSameWay
  it("has nothing to reconcile when both made the same change", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const renamed = entry("Intel ME FPT", "$FPT", { id });
    const mine = library([renamed], { [mac]: 2 });
    const theirs = library([renamed], { [mac]: 1, [laptop]: 1 });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(names(outcome.library)).toEqual(["Intel ME FPT"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testADeletionTravels
  it("lets a deletion travel", () => {
    const id = mintId();
    const doomed = entry("mistake", "11", { id });
    const base = library([doomed], { [mac]: 1 });
    const mine = library([doomed], { [mac]: 1 });
    const theirs = library([], { [mac]: 1, [laptop]: 1 }, [tombstone(id, laptop)]);

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(outcome.library.entries).toEqual([]);
    expect(outcome.library.tombstones.map((note) => note.id)).toEqual([id]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testALineRemovedByHandIsNotADeletion
  it("does not take a line removed by hand for a deletion", () => {
    const id = mintId();
    const kept = entry("ME FPT", "$FPT", { id });
    const base = library([kept], { [mac]: 1 });
    const mine = library([kept], { [mac]: 2 });
    const theirs = library([], { [mac]: 1, [laptop]: 1 });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(names(outcome.library)).toEqual(["ME FPT"]);
    expect(isResolved(outcome)).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testTheFilesOrderLeadsAndLocalEntriesFollow
  it("lets the other file's order lead, with local entries after it", () => {
    const a = mintId();
    const b = mintId();
    const base = library(
      [entry("a", "11", { id: a, sortKey: 1024 }), entry("b", "22", { id: b, sortKey: 2048 })],
      { [mac]: 1 }
    );
    const mine = library(
      [
        entry("a", "11", { id: a, sortKey: 1024 }),
        entry("b", "22", { id: b, sortKey: 2048 }),
        entry("mine", "33", { sortKey: 3072 }),
      ],
      { [mac]: 2 }
    );
    // They dragged b above a.
    const theirs = library(
      [entry("a", "11", { id: a, sortKey: 1024 }), entry("b", "22", { id: b, sortKey: 512 })],
      { [mac]: 1, [laptop]: 1 }
    );

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(orderedEntries(outcome.library).map((kept) => kept.name)).toEqual(["b", "a", "mine"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testTheSameSearchAddedTwiceBecomesOneEntry
  it("makes one entry of the same search added on both sides", () => {
    const base = library([], { [mac]: 1 });
    const mine = library(
      [entry("Capsule", "5A A5", { id: "00000000-0000-0000-0000-000000000001" })],
      {
        [mac]: 2,
      }
    );
    const theirs = library(
      [entry("Capsule", "5A A5", { id: "FF000000-0000-0000-0000-000000000002", device: laptop })],
      { [mac]: 1, [laptop]: 1 }
    );

    const ourView = mergePatternLibraries(base, mine, theirs);
    const theirView = mergePatternLibraries(base, theirs, mine);

    expect(isResolved(ourView)).toBe(true);
    expect(ourView.library.entries).toHaveLength(1);
    expect(ourView.library.entries.map((kept) => kept.id)).toEqual(
      theirView.library.entries.map((kept) => kept.id)
    );
  });
});

describe("the three questions", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testBothChangedItDifferentlyIsAQuestion
  it("asks when both changed an entry differently", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([entry("Intel ME FPT", "$FPT", { id })], { [mac]: 2 });
    const theirs = library([entry("ME region table", "$FPT", { id, device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(outcome.conflicts).toHaveLength(1);
    const conflict = outcome.conflicts[0];
    if (conflict?.kind !== "bothEdited")
      throw new Error(`expected bothEdited, got ${conflict?.kind}`);
    expect(conflict.ours.name).toBe("Intel ME FPT");
    expect(conflict.theirs.name).toBe("ME region table");
    expect(names(outcome.library)).toEqual(["Intel ME FPT"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testEditedHereAndDeletedThereIsAQuestion
  it("asks when an entry was edited here and deleted there", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([entry("Intel ME FPT", "$FPT", { id })], { [mac]: 2 });
    const theirs = library([], { [mac]: 1, [laptop]: 1 }, [tombstone(id, laptop)]);

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(outcome.conflicts).toHaveLength(1);
    const conflict = outcome.conflicts[0];
    if (conflict?.kind !== "editedAndDeleted") {
      throw new Error(`expected editedAndDeleted, got ${conflict?.kind}`);
    }
    expect(conflict.entry.name).toBe("Intel ME FPT");
    expect(conflict.deletedBy).toBe(laptop);
    expect(conflict.deletedHere).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testDeletedHereAndEditedThereIsAQuestionToo
  it("asks on the machine that deleted it too", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([], { [mac]: 2 }, [tombstone(id, mac)]);
    const theirs = library([entry("ME region table", "$FPT", { id })], { [mac]: 1, [laptop]: 1 });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(outcome.conflicts).toHaveLength(1);
    const conflict = outcome.conflicts[0];
    if (conflict?.kind !== "editedAndDeleted") {
      throw new Error(`expected editedAndDeleted, got ${conflict?.kind}`);
    }
    expect(conflict.entry.name).toBe("ME region table");
    expect(conflict.deletedBy).toBe(mac);
    expect(conflict.deletedHere).toBe(true);
    expect(outcome.library.entries).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAnsweringFromTheSideThatDeleted
  it("can be answered either way from the side that deleted", () => {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([], { [mac]: 2 }, [tombstone(id, mac)]);
    const theirs = library([entry("ME region table", "$FPT", { id })], { [mac]: 1, [laptop]: 1 });
    const outcome = mergePatternLibraries(base, mine, theirs);

    const kept = resolvePatternLibrary(outcome, answers([[id, "keepTheirs"]]));
    expect(names(kept)).toEqual(["ME region table"]);
    expect(kept.tombstones).toEqual([]);

    const deleted = resolvePatternLibrary(outcome, answers([[id, "keepOurs"]]));
    expect(deleted.entries).toEqual([]);
    expect(deleted.tombstones.map((note) => note.id)).toEqual([id]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAnEntryKeptAgainstADeletionIsNotDeletedAgain
  it("does not delete again an entry kept against a deletion", () => {
    const id = mintId();
    const deletedAt = 1_000_000;
    const kept = { ...entry("Intel ME FPT", "$FPT", { id }), modifiedAt: deletedAt + 60_000 };
    const mine = library([kept], { [mac]: 3 });
    const theirs = library([], { [mac]: 1, [laptop]: 2 }, [tombstone(id, laptop, deletedAt)]);

    const outcome = mergePatternLibraries(undefined, mine, theirs, { assumeConcurrent: true });

    expect(outcome.conflicts).toEqual([]);
    expect(names(outcome.library)).toEqual(["Intel ME FPT"]);
    expect(outcome.library.tombstones).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testTheMachineHoldingTheNoteTakesTheRevivalBack
  it("lets the machine holding the note take the revival back", () => {
    const id = mintId();
    const deletedAt = 1_000_000;
    const revived = { ...entry("Intel ME FPT", "$FPT", { id }), modifiedAt: deletedAt + 60_000 };
    const mine = library([], { [mac]: 2 }, [tombstone(id, mac, deletedAt)]);
    const theirs = library([revived], { [mac]: 1, [laptop]: 3 });

    const outcome = mergePatternLibraries(undefined, mine, theirs, { assumeConcurrent: true });

    expect(outcome.conflicts).toEqual([]);
    expect(names(outcome.library)).toEqual(["Intel ME FPT"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAnUntouchedEntryStaysDeleted
  it("leaves deleted an entry last touched before the deletion", () => {
    const id = mintId();
    const stale = { ...entry("ME FPT", "$FPT", { id }), modifiedAt: 1_000_000 };
    const mine = library([stale], { [mac]: 1 });
    const theirs = library([], { [laptop]: 2 }, [tombstone(id, laptop, 2_000_000)]);

    const outcome = mergePatternLibraries(undefined, mine, theirs, { assumeConcurrent: true });

    expect(outcome.conflicts).toEqual([]);
    expect(outcome.library.entries).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testTheSameSearchUnderTwoNamesIsAQuestion
  it("asks when the same search is kept under two names", () => {
    const base = library([], { [mac]: 1 });
    const mine = library([entry("Capsule header", "5A A5")], { [mac]: 2 });
    const theirs = library([entry("Aptio capsule", "5A A5", { device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });

    const outcome = mergePatternLibraries(base, mine, theirs);

    expect(outcome.conflicts).toHaveLength(1);
    const conflict = outcome.conflicts[0];
    if (conflict?.kind !== "duplicate")
      throw new Error(`expected duplicate, got ${conflict?.kind}`);
    expect(conflict.ours.name).toBe("Capsule header");
    expect(conflict.theirs.name).toBe("Aptio capsule");
    expect(outcome.library.entries).toHaveLength(1);
  });
});

describe("answering", () => {
  function bothEdited() {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([entry("Intel ME FPT", "$FPT", { id })], { [mac]: 2 });
    const theirs = library([entry("ME region table", "$FPT", { id, device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });
    return { id, outcome: mergePatternLibraries(base, mine, theirs) };
  }

  function editedAndDeleted() {
    const id = mintId();
    const base = library([entry("ME FPT", "$FPT", { id })], { [mac]: 1 });
    const mine = library([entry("Intel ME FPT", "$FPT", { id })], { [mac]: 2 });
    const theirs = library([], { [mac]: 1, [laptop]: 1 }, [tombstone(id, laptop)]);
    return { id, outcome: mergePatternLibraries(base, mine, theirs) };
  }

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testKeepingTheirsTakesTheirVersion
  it("takes their version when theirs is kept", () => {
    const { id, outcome } = bothEdited();
    expect(names(resolvePatternLibrary(outcome, answers([[id, "keepTheirs"]])))).toEqual([
      "ME region table",
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testKeepingOursLeavesTheMergedLibraryAsItIs
  it("leaves the merged library as it is when ours is kept", () => {
    const { id, outcome } = bothEdited();
    expect(names(resolvePatternLibrary(outcome, answers([[id, "keepOurs"]])))).toEqual([
      "Intel ME FPT",
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testAcceptingADeletionLeavesATombstone
  it("leaves a tombstone when a deletion is accepted", () => {
    const { id, outcome } = editedAndDeleted();
    const resolved = resolvePatternLibrary(outcome, answers([[id, "keepTheirs"]]));
    expect(resolved.entries).toEqual([]);
    expect(resolved.tombstones.map((note) => note.id)).toEqual([id]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testKeepingAnEditedEntryDropsTheirTombstone
  it("drops their tombstone when the edited entry is kept", () => {
    const { id, outcome } = editedAndDeleted();
    const resolved = resolvePatternLibrary(outcome, answers([[id, "keepOurs"]]));
    expect(names(resolved)).toEqual(["Intel ME FPT"]);
    expect(resolved.tombstones).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testKeepingBothNames
  it("keeps both names when both are kept", () => {
    const base = library([], { [mac]: 1 });
    const mine = library([entry("Capsule header", "5A A5")], { [mac]: 2 });
    const theirs = library([entry("Aptio capsule", "5A A5", { device: laptop })], {
      [mac]: 1,
      [laptop]: 1,
    });
    const outcome = mergePatternLibraries(base, mine, theirs);
    const first = outcome.conflicts[0];
    if (first === undefined) throw new Error("expected a question");

    const resolved = resolvePatternLibrary(outcome, answers([[conflictId(first), "keepBoth"]]));

    expect(new Set(names(resolved))).toEqual(new Set(["Capsule header", "Aptio capsule"]));
  });
});

describe("tombstones", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testOldTombstonesArePruned
  it("are forgotten once every machine has had the chance to hear about them", () => {
    const recent = tombstone(mintId(), mac, Date.now());
    const ancient = tombstone(mintId(), mac, Date.now() - TOMBSTONE_LIFETIME_MS - 60_000);
    const mine = library([], { [mac]: 2 }, [recent, ancient]);
    const theirs = library([], { [mac]: 1, [laptop]: 1 });

    const outcome = mergePatternLibraries(undefined, mine, theirs);

    expect(outcome.library.tombstones.map((note) => note.id)).toEqual([recent.id]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testATombstoneForAnEntryThatSurvivedIsDropped
  it("are dropped for an entry that survived", () => {
    const id = mintId();
    const kept = entry("ME FPT", "$FPT", { id });
    const mine = library([kept], { [mac]: 2 }, [tombstone(id, laptop)]);
    const theirs = library([kept], { [mac]: 2 });

    const outcome = mergePatternLibraries(undefined, mine, theirs);

    expect(names(outcome.library)).toEqual(["ME FPT"]);
    expect(outcome.library.tombstones).toEqual([]);
  });
});

describe("no common past", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/LibraryMergeTests.swift#LibraryMergeTests.testWithNoBaseEverythingIsKept
  it("keeps everything either side has", () => {
    const mine = library([entry("mine", "11")], { [mac]: 3 });
    const theirs = library([entry("theirs", "22", { device: laptop })], { [laptop]: 4 });

    const outcome = mergePatternLibraries(undefined, mine, theirs);

    expect(isResolved(outcome)).toBe(true);
    expect(new Set(names(outcome.library))).toEqual(new Set(["mine", "theirs"]));
  });
});
