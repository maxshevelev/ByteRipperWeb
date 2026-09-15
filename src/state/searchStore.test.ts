/**
 * The Smart Search pass, as the store runs it.
 *
 * `smartSearch.test.ts` already proves the order of the attempts. What it
 * cannot see is the pass that *asks* them one at a time across a worker, and
 * that is where the order was lost: a miss on the first attempt was reported
 * as "not found" and took the pass down with it, so a UTF-16 string in a file
 * was never found — its ASCII attempt always misses first.
 *
 * The worker is faked. The point here is which questions get asked and what is
 * concluded from the answers, not the scanning, which `searchEngine.test.ts`
 * covers against upstream's own cases.
 */

import { beforeEach, expect, test, vi } from "vitest";

interface Posted {
  readonly kind: string;
  readonly id: number;
  readonly encoding?: string;
}

/** Every request the store has sent, in order. */
let posted: Posted[] = [];
/** The encoding the file is pretending to contain; undefined means nothing does. */
let answerFor: string | undefined;

/**
 * A worker that answers "first" and nothing else.
 *
 * It replies asynchronously, as a real one does — the pass awaits each reply,
 * and a synchronous answer would hide a bug that only appears when the store's
 * own listener has already run.
 */
class FakeWorker implements Pick<Worker, "addEventListener" | "removeEventListener"> {
  private listeners: ((event: MessageEvent) => void)[] = [];

  addEventListener(_type: string, listener: unknown): void {
    this.listeners.push(listener as (event: MessageEvent) => void);
  }

  removeEventListener(_type: string, listener: unknown): void {
    this.listeners = this.listeners.filter((entry) => entry !== listener);
  }

  postMessage(request: Posted): void {
    posted.push(request);
    if (request.kind !== "search") return;
    const match = request.encoding === answerFor ? { start: 16, end: 20 } : undefined;
    queueMicrotask(() => {
      const event = {
        data: { kind: "first", id: request.id, wrapped: false, ...(match ? { match } : {}) },
      } as MessageEvent;
      for (const listener of [...this.listeners]) listener(event);
    });
  }
}

// Installed before the store is imported, because `ensureWorker` constructs one
// the first time a search runs and keeps it for the life of the module.
(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const {
  closeSearch,
  editQuery,
  hideSearchResults,
  noteSearchEdit,
  openSearch,
  resultsFor,
  searchStore,
  selectMatch,
  setSearchEncoding,
  setSearchPane,
  setSmartSearch,
  startSearch,
  toggleSearchResults,
} = await import("@/state/searchStore");

/** The pane under test; every assertion here is about pane A's results. */
const paneResults = () => resultsFor(searchStore.getSnapshot(), "a");
const { openInPane, workspaceStore } = await import("@/state/workspaceStore");

beforeEach(() => {
  posted = [];
  answerFor = undefined;
  const bytes = new Uint8Array(64);
  openInPane("a", {
    name: "dump.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([bytes]),
  });
});

/** Waits for the pass to settle: each attempt costs a microtask and a turn. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a miss on an early encoding does not end the pass", async () => {
  // The bug: ASCII and UTF-8 miss, and the pass stopped before UTF-16 was
  // asked, so a UTF-16 string in the file was reported as absent.
  answerFor = "utf16LE";
  startSearch({ query: "FirmwareVolume", smart: true, encoding: "ascii" });
  await settle();

  // Two scans, not three: "FirmwareVolume" is ASCII, so its UTF-8 encoding is
  // the same bytes and `attemptsFor` folds the two into one attempt. The pass
  // reaching UTF-16 at all is what this test is about.
  const asked = posted.filter((request) => request.kind === "search").map((r) => r.encoding);
  expect(asked).toEqual(["ascii", "utf16LE"]);

  const results = paneResults();
  expect(results.status).toBe("found");
  expect(results.foundEncoding).toBe("utf16LE");
  expect(results.current).toEqual({ start: 16, end: 20 });
});

test("the pass stops at the first encoding that finds anything", async () => {
  answerFor = "ascii";
  startSearch({ query: "FirmwareVolume", smart: true, encoding: "ascii" });
  await settle();

  expect(posted.filter((request) => request.kind === "search").map((r) => r.encoding)).toEqual([
    "ascii",
  ]);
  expect(paneResults().foundEncoding).toBe("ascii");
});

test("not found is reported once every encoding has missed", async () => {
  answerFor = undefined;
  startSearch({ query: "FirmwareVolume", smart: true, encoding: "ascii" });
  await settle();

  // ASCII (standing in for UTF-8 too), then UTF-16 LE, then UTF-16 BE.
  expect(posted.filter((request) => request.kind === "search").length).toBe(3);
  const results = paneResults();
  expect(results.status).toBe("notFound");
  expect(results.current).toBeUndefined();
});

test("a chosen encoding asks once and does not fall back", async () => {
  answerFor = "utf16LE";
  startSearch({ query: "FirmwareVolume", smart: false, encoding: "ascii" });
  await settle();

  expect(posted.filter((request) => request.kind === "search").map((r) => r.encoding)).toEqual([
    "ascii",
  ]);
  expect(paneResults().status).toBe("notFound");
});

test("an edited document is searched as it reads, not as the file does", async () => {
  // The fake worker never finds anything, so a hit here can only have come from
  // the local scan against the document — which is the point: the worker holds
  // the file, and the file does not have these bytes in it.
  answerFor = undefined;
  const slot = workspaceStore.getSnapshot().panes.a;
  if (slot === undefined) throw new Error("the pane did not open");
  await slot.document.overwrite(8, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  expect(slot.document.isDirty).toBe(true);

  startSearch({ query: "DEADBEEF", encoding: "hex", from: 0 });
  await settle();

  expect(posted.filter((request) => request.kind === "search")).toEqual([]);
  const results = paneResults();
  expect(results.status).toBe("found");
  expect(results.current).toEqual({ start: 8, end: 12 });
});

// Every offset in the set is a guess once the bytes move: the matches go, and
// nothing is searched again until the user asks.
// @upstream ByteRipperTests/FindFlowTests.swift#FindFlowTests.testAnEditEndsTheSession
test("an edit ends the search rather than running it again", async () => {
  vi.useFakeTimers();
  try {
    const slot = workspaceStore.getSnapshot().panes.a;
    if (slot === undefined) throw new Error("the pane did not open");
    await slot.document.overwrite(8, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

    startSearch({ query: "DEADBEEF", encoding: "hex", from: 0 });
    await vi.advanceTimersByTimeAsync(50);
    expect(paneResults().current).toEqual({ start: 8, end: 12 });

    await slot.document.overwrite(10, new Uint8Array([0x00, 0x00]));
    noteSearchEdit("a", { kind: "overwrite", start: 10, end: 12 });
    await vi.advanceTimersByTimeAsync(500);

    expect(paneResults().status).toBe("idle");
    expect(paneResults().current).toBeUndefined();
    expect(paneResults().matches).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("emptying the query leaves the find bar up", () => {
  // Deleting the last character is editing a search, not dismissing one. The
  // bar used to be derived from the query, so it vanished out from under the
  // cursor that was still deleting.
  openSearch();
  startSearch({ query: "DEADBEEF", encoding: "hex" });
  expect(searchStore.getSnapshot().open).toBe(true);

  startSearch({ query: "", encoding: "hex" });
  expect(searchStore.getSnapshot().open).toBe(true);
  expect(paneResults().status).toBe("idle");
  expect(paneResults().matches).toBeUndefined();
});

test("only closing closes it", () => {
  openSearch();
  expect(searchStore.getSnapshot().open).toBe(true);
  closeSearch();
  expect(searchStore.getSnapshot().open).toBe(false);
});

test("opening an already-open bar says so, so the shortcut can start over", () => {
  closeSearch();
  expect(openSearch()).toBe(false);
  expect(openSearch()).toBe(true);
});

test("clicking a result makes it the current match", async () => {
  // Without this the list moved the panes but left the ordinal and the grid
  // pointing at whichever match was current before.
  answerFor = "hex";
  const slot = workspaceStore.getSnapshot().panes.a;
  if (slot === undefined) throw new Error("the pane did not open");
  await slot.document.overwrite(0, new Uint8Array([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]));

  startSearch({ query: "AA", encoding: "hex", from: 0 });
  await settle();

  const matches = paneResults().matches;
  if (matches === undefined) throw new Error("the index did not arrive");
  const third = matches.rangeAt(2);
  if (third === undefined) throw new Error("there should be a third match");

  selectMatch("a", third.start);
  expect(paneResults().current).toEqual(third);
  expect(paneResults().status).toBe("found");
});

test("a result that is not a match start is ignored", () => {
  const before = paneResults().current;
  selectMatch("a", 999_999);
  expect(paneResults().current).toEqual(before);
});

test("each pane keeps its own results when the other becomes active", async () => {
  // The list under a dump is a claim about *that* file. Clicking into the other
  // pane does not make it untrue, so it does not clear — which is what the
  // single shared result set used to do.
  const { openInPane, workspaceStore: workspace } = await import("@/state/workspaceStore");
  const bytes = new Uint8Array(64);
  bytes.set([0xde, 0xad], 8);
  openInPane("b", {
    name: "b.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([bytes]),
  });

  answerFor = "hex";
  startSearch({ query: "DEAD", encoding: "hex", pane: "a", from: 0 });
  await settle();
  expect(resultsFor(searchStore.getSnapshot(), "a").status).toBe("found");

  // The user clicks the other pane, and searches it for something else.
  setSearchPane("b");
  startSearch({ query: "BEEF", encoding: "hex", pane: "b", from: 0 });
  await settle();

  const state = searchStore.getSnapshot();
  expect(resultsFor(state, "b").status).toBe("found");
  // Pane A's results are exactly where they were.
  expect(resultsFor(state, "a").status).toBe("found");
  expect(resultsFor(state, "a").current).toEqual({ start: 16, end: 20 });
  expect(workspace.getSnapshot().panes.b).toBeDefined();
});

test("closing the bar clears every pane's results", () => {
  closeSearch();
  const state = searchStore.getSnapshot();
  for (const pane of ["a", "b"] as const) {
    expect(resultsFor(state, pane).matches).toBeUndefined();
    expect(resultsFor(state, pane).status).toBe("idle");
  }
});

test("what worked replaces what was asked for", async () => {
  // Upstream's reason, and it is about the *next* press: leaving the asked-for
  // encoding standing meant the following search started another pass from it,
  // trying the others again before landing on the one already settled on.
  answerFor = "utf16LE";
  setSmartSearch(true);
  startSearch({ query: "FirmwareVolume", smart: true, encoding: "ascii" });
  await settle();

  expect(paneResults().foundEncoding).toBe("utf16LE");
  expect(searchStore.getSnapshot().encoding).toBe("utf16LE");
});

test("the first attempt is the encoding the bar is showing", async () => {
  // Which, after an adoption, is the answer to the last question — so a repeat
  // press asks that one first instead of hunting from the top again.
  answerFor = "utf16LE";
  setSmartSearch(true);
  startSearch({ query: "FirmwareVolume", smart: true, encoding: "utf16LE" });
  await settle();

  const asked = posted.filter((request) => request.kind === "search").map((r) => r.encoding);
  expect(asked[0]).toBe("utf16LE");
  expect(asked).toHaveLength(1);
});

test("with Smart Search off the encoding is an instruction, not a guess", async () => {
  answerFor = "utf16LE";
  setSmartSearch(false);
  startSearch({ query: "FirmwareVolume", smart: false, encoding: "ascii" });
  await settle();

  const asked = posted.filter((request) => request.kind === "search").map((r) => r.encoding);
  expect(asked).toEqual(["ascii"]);
  // And nothing rewrites what the user chose.
  expect(searchStore.getSnapshot().encoding).toBe("ascii");
  expect(paneResults().status).toBe("notFound");
  setSmartSearch(true);
});

/** Pane A holding DEADBEEF at 8, unsaved, so the scan runs here against it. */
async function deadBeefAtEight(): Promise<void> {
  closeSearch();
  setSearchPane("a");
  const slot = workspaceStore.getSnapshot().panes.a;
  if (slot === undefined) throw new Error("the pane did not open");
  await slot.document.overwrite(8, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  setSearchEncoding("hex");
}

test("a search does not open the results panel on its own", async () => {
  await deadBeefAtEight();
  startSearch({ query: "DEADBEEF", from: 0 });
  await settle();
  expect(paneResults().status).toBe("found");
  expect(paneResults().resultsShown).toBe(false);
});

test("the results button searches a pattern nothing has looked for, and leaves the caret", async () => {
  await deadBeefAtEight();
  toggleSearchResults("DEADBEEF");
  expect(paneResults().resultsShown).toBe(true);
  await settle();

  const results = paneResults();
  expect(results.status).toBe("found");
  // Not a Find Next: nothing became the current match, so nothing moved.
  expect(results.current).toBeUndefined();
  expect(results.matches?.rangeAt(0)).toEqual({ start: 8, end: 12 });
});

test("with the search in hand the button only opens the panel", async () => {
  await deadBeefAtEight();
  startSearch({ query: "DEADBEEF", from: 0 });
  await settle();
  const before = paneResults();

  toggleSearchResults("DEADBEEF");
  const after = paneResults();
  expect(after.resultsShown).toBe(true);
  expect(after.current).toEqual(before.current);
  expect(after.matches).toBe(before.matches);
});

test("pressing it again, or the ×, puts the panel away and keeps the search", async () => {
  await deadBeefAtEight();
  toggleSearchResults("DEADBEEF");
  await settle();
  toggleSearchResults("DEADBEEF");
  expect(paneResults().resultsShown).toBe(false);
  expect(paneResults().matches).toBeDefined();

  toggleSearchResults("DEADBEEF");
  expect(paneResults().resultsShown).toBe(true);
  hideSearchResults("a");
  expect(paneResults().resultsShown).toBe(false);
  expect(paneResults().status).toBe("found");
});

test("the panel goes with the set: a new pattern typed, or an edit", async () => {
  await deadBeefAtEight();
  toggleSearchResults("DEADBEEF");
  await settle();
  editQuery("DEADBEE");
  expect(paneResults().resultsShown).toBe(false);

  toggleSearchResults("DEADBEEF");
  await settle();
  expect(paneResults().resultsShown).toBe(true);
  noteSearchEdit("a", { kind: "overwrite", start: 8, end: 9 });
  expect(paneResults().resultsShown).toBe(false);
});

test("a search that finds nothing still opens the panel the button asked for", async () => {
  await deadBeefAtEight();
  setSmartSearch(false);
  toggleSearchResults("CAFEBABE");
  await settle();
  expect(paneResults().status).toBe("notFound");
  expect(paneResults().resultsShown).toBe(true);
  setSmartSearch(true);
});
