import { beforeEach, describe, expect, it } from "vitest";
import { type KeyValueStore, memoryKeyValueStore } from "@/platform/storage/keyValueStore";
import {
  clearRecentFiles,
  pruneMissingRecentFiles,
  RECENT_FILE_LIMIT,
  recentFilesStore,
  recordRecentFile,
  restoreRecentFiles,
  setRecentFilesStorage,
} from "@/state/recentFilesStore";

// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testRecordMovesAnOlderEntryToTheFront
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testRecordCapsAtTheLimit
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testRecordingTheFirstEntryChangesNothing
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testRecordingIntoAnEmptyListChangesIt
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testClearEmptiesTheList
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testPruneMissingDropsDeadPathsAndKeepsTheLiveOnes
// @upstream ByteRipperTests/RecentFilesStoreTests.swift#RecentFilesStoreTests.testPruneMissingLeavesAHealthyListAlone
//
// The store's rows are handles, not paths: a handle is what re-opens the file,
// so a stand-in here is an object with the two members the store touches —
// `name` and `getFile` — plus a permission answer where a test needs one.

const names = () => recentFilesStore.getSnapshot().rows.map((row) => row.name);

interface HandleSpec {
  readonly name: string;
  /** Rejected from `getFile` when present: how the disk answers the row. */
  readonly getFileError?: Error;
  /** The answer to a `queryPermission` the store asks on a launch. */
  readonly permission?: PermissionState;
}
function handle(spec: HandleSpec): FileSystemFileHandle {
  const queryPermission =
    spec.permission === undefined ? undefined : async () => spec.permission as PermissionState;
  return {
    kind: "file",
    name: spec.name,
    getFile: () =>
      spec.getFileError !== undefined
        ? Promise.reject(spec.getFileError)
        : Promise.resolve(new File([new Uint8Array(4)], spec.name)),
    ...(queryPermission === undefined ? {} : { queryPermission }),
  } as unknown as FileSystemFileHandle;
}

let storage: KeyValueStore;

beforeEach(async () => {
  storage = memoryKeyValueStore();
  setRecentFilesStorage(storage);
  // The store is one list for the whole origin; a test starts it out.
  clearRecentFiles();
});

describe("recording an open", () => {
  it("moves an older entry to the front, and the older entry is not duplicated", () => {
    recordRecentFile(handle({ name: "a.bin" }), "a.bin");
    recordRecentFile(handle({ name: "b.bin" }), "b.bin");
    recordRecentFile(handle({ name: "a.bin" }), "a.bin");

    expect(names()).toEqual(["a.bin", "b.bin"]);
  });

  it("caps the list at the limit, newest first", () => {
    for (let i = 0; i < 12; i += 1) {
      recordRecentFile(handle({ name: `f${i}.bin` }), `f${i}.bin`);
    }

    expect(names()).toHaveLength(RECENT_FILE_LIMIT);
    // Newest first: the last recorded file is at the front, and the two oldest
    // are the ones dropped.
    expect(names()[0]).toBe("f11.bin");
    expect(names()).not.toContain("f0.bin");
    expect(names()).not.toContain("f1.bin");
  });

  it("changes nothing when the file already at the front is re-opened", () => {
    recordRecentFile(handle({ name: "a.bin" }), "a.bin");

    expect(recordRecentFile(handle({ name: "a.bin" }), "a.bin")).toBe(false);
    expect(names()).toEqual(["a.bin"]);
  });

  it("changes the list on a first record", () => {
    expect(recordRecentFile(handle({ name: "a.bin" }), "a.bin")).toBe(true);
    expect(names()).toEqual(["a.bin"]);
  });
});

describe("Clear Menu", () => {
  it("empties the list, and it stays empty", () => {
    recordRecentFile(handle({ name: "a.bin" }), "a.bin");
    recordRecentFile(handle({ name: "b.bin" }), "b.bin");

    clearRecentFiles();

    expect(names()).toEqual([]);
  });
});

describe("pruning at launch", () => {
  it("drops a file that is gone, and keeps the ones that are not", async () => {
    recordRecentFile(handle({ name: "live.bin" }), "live.bin");
    recordRecentFile(
      handle({ name: "gone.bin", getFileError: new DOMException("No such file", "NotFound") }),
      "gone.bin"
    );

    await pruneMissingRecentFiles();

    expect(names()).toEqual(["live.bin"]);
  });

  // The web's reading of a missing file is narrower than upstream's: upstream
  // asks the disk, the page asks the handle, and a handle whose permission is
  // not yet granted has not said the file is gone — so it is kept, not dropped.
  it("keeps a file whose permission is not yet granted", async () => {
    recordRecentFile(handle({ name: "locked.bin", permission: "denied" }), "locked.bin");

    await pruneMissingRecentFiles();

    expect(names()).toEqual(["locked.bin"]);
  });

  it("leaves a healthy list as it is", async () => {
    recordRecentFile(handle({ name: "a.bin" }), "a.bin");
    recordRecentFile(handle({ name: "b.bin" }), "b.bin");

    await pruneMissingRecentFiles();

    expect(names()).toEqual(["b.bin", "a.bin"]);
  });
});

describe("restoring the list", () => {
  // The one key the store keeps its rows under (an implementation detail the
  // test needs only to lay rows down the way a run that ended would have).
  const KEY = "recent";

  it("reads the rows back, and the files that are gone are swept", async () => {
    await storage.put(KEY, [
      { handle: handle({ name: "a.bin" }), name: "a.bin" },
      {
        handle: handle({
          name: "gone.bin",
          getFileError: new DOMException("No such file", "NotFound"),
        }),
        name: "gone.bin",
      },
    ]);

    await restoreRecentFiles();

    expect(names()).toEqual(["a.bin"]);
  });
});
