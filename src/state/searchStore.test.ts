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

const { closeSearch, noteSearchEdit, openSearch, searchStore, selectMatch, startSearch } =
  await import("@/state/searchStore");
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
  startSearch({ query: "FirmwareVolume", encoding: "smart" });
  await settle();

  // Two scans, not three: "FirmwareVolume" is ASCII, so its UTF-8 encoding is
  // the same bytes and `attemptsFor` folds the two into one attempt. The pass
  // reaching UTF-16 at all is what this test is about.
  const asked = posted.filter((request) => request.kind === "search").map((r) => r.encoding);
  expect(asked).toEqual(["ascii", "utf16LE"]);

  const state = searchStore.getSnapshot();
  expect(state.status).toBe("found");
  expect(state.foundEncoding).toBe("utf16LE");
  expect(state.current).toEqual({ start: 16, end: 20 });
});

test("the pass stops at the first encoding that finds anything", async () => {
  answerFor = "ascii";
  startSearch({ query: "FirmwareVolume", encoding: "smart" });
  await settle();

  expect(posted.filter((request) => request.kind === "search").map((r) => r.encoding)).toEqual([
    "ascii",
  ]);
  expect(searchStore.getSnapshot().foundEncoding).toBe("ascii");
});

test("not found is reported once every encoding has missed", async () => {
  answerFor = undefined;
  startSearch({ query: "FirmwareVolume", encoding: "smart" });
  await settle();

  // ASCII (standing in for UTF-8 too), then UTF-16 LE, then UTF-16 BE.
  expect(posted.filter((request) => request.kind === "search").length).toBe(3);
  const state = searchStore.getSnapshot();
  expect(state.status).toBe("notFound");
  expect(state.current).toBeUndefined();
});

test("a chosen encoding asks once and does not fall back", async () => {
  answerFor = "utf16LE";
  startSearch({ query: "FirmwareVolume", encoding: "ascii" });
  await settle();

  expect(posted.filter((request) => request.kind === "search").map((r) => r.encoding)).toEqual([
    "ascii",
  ]);
  expect(searchStore.getSnapshot().status).toBe("notFound");
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
  const state = searchStore.getSnapshot();
  expect(state.status).toBe("found");
  expect(state.current).toEqual({ start: 8, end: 12 });
});

test("an edit re-runs the search, so the matches follow the bytes", async () => {
  vi.useFakeTimers();
  try {
    const slot = workspaceStore.getSnapshot().panes.a;
    if (slot === undefined) throw new Error("the pane did not open");
    await slot.document.overwrite(8, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

    startSearch({ query: "DEADBEEF", encoding: "hex", from: 0 });
    await vi.advanceTimersByTimeAsync(50);
    expect(searchStore.getSnapshot().current).toEqual({ start: 8, end: 12 });

    // The match is typed over. Without the re-run the store would still be
    // pointing at bytes that are no longer there.
    await slot.document.overwrite(10, new Uint8Array([0x00, 0x00]));
    noteSearchEdit("a", { kind: "overwrite", start: 10, end: 12 });
    await vi.advanceTimersByTimeAsync(500);

    expect(searchStore.getSnapshot().status).toBe("notFound");
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
  const state = searchStore.getSnapshot();
  expect(state.open).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.matches).toBeUndefined();
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

  const matches = searchStore.getSnapshot().matches;
  if (matches === undefined) throw new Error("the index did not arrive");
  const third = matches.rangeAt(2);
  if (third === undefined) throw new Error("there should be a third match");

  selectMatch(third.start);
  const state = searchStore.getSnapshot();
  expect(state.current).toEqual(third);
  expect(state.status).toBe("found");
});

test("a result that is not a match start is ignored", () => {
  const before = searchStore.getSnapshot().current;
  selectMatch(999_999);
  expect(searchStore.getSnapshot().current).toEqual(before);
});
