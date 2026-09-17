/**
 * Use Selection for Find: the selection becomes the pattern the find bar will
 * search for, and nothing else happens — the bar is not opened and no search is
 * run. Which column the selection was made in decides what the pattern says:
 * bytes from the hex column, text from the decoded-text column. A selection too
 * long to be a pattern is refused in words (§11).
 *
 * The worker is faked, and it answers every scan with a hit. ⌘E runs no scan at
 * all, which is half of what is asserted here — but "the count goes" says
 * nothing about a bar that had no count, and what a scan finds is
 * `searchEngine.test.ts`'s subject rather than this file's.
 *
 * Upstream also tests its Edit ▸ Use Selection for Find menu item — that it is
 * dimmed with nothing selected and carries the command otherwise. The web has
 * no Edit menu and no action of its own for this, so those two are `unported`
 * in the module map rather than ported here.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import type { InputRegion } from "@/core/edit/typingController";
import { dismissNotice, noticeStore } from "@/state/noticeStore";

interface Posted {
  readonly kind: string;
  readonly id: number;
  readonly encoding?: string;
}

/** Every request the store has sent the worker, in order. */
let posted: Posted[] = [];

/**
 * The worker, faked: it replies to every scan with a one-byte hit at the start
 * of the file. That the offset is fixed is the point — a search that landed is
 * all these tests need, and they say so by asking for one hit.
 *
 * It answers asynchronously, as a real one does: the pass awaits each reply, and
 * a synchronous answer would hide a bug that only appears once the store's own
 * listener has already run.
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
    queueMicrotask(() => {
      const event = {
        data: { kind: "first", id: request.id, wrapped: false, match: { start: 0, end: 1 } },
      } as MessageEvent;
      for (const listener of [...this.listeners]) listener(event);
    });
  }
}

// Installed before the store is imported, because `ensureWorker` constructs one
// the first time a search runs and keeps it for the life of the module.
(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const {
  clearRecents,
  closeSearch,
  editQuery,
  MAX_SELECTION_FIND_BYTES,
  openSearch,
  resultsFor,
  searchStore,
  setSearchEncoding,
  startSearch,
  useSelectionForFind,
} = await import("@/state/searchStore");
const { openInPane, workspaceStore } = await import("@/state/workspaceStore");

const search = () => searchStore.getSnapshot();
const query = () => search().query;
const staged = () => search().stagedPattern;
const results = () => resultsFor(search(), "a");

/** The pane under test; every assertion here is about pane A. */
function pane() {
  const slot = workspaceStore.getSnapshot().panes.a;
  if (slot === undefined) throw new Error("the pane did not open");
  return slot;
}

/** Opens a pane holding `bytes`, which the test then selects out of. */
function open(bytes: readonly number[]): void {
  const data = new Uint8Array(bytes);
  openInPane("a", {
    name: "dump.bin",
    size: data.length,
    lastModified: 0,
    source: new Blob([data]),
  });
}

/**
 * Selects `[start, end)` with the caret typing in `region` — a selection made in
 * the hex column or in the decoded-text one (§7).
 *
 * The region is set *after* the selection, which is the order a real drag puts
 * them in: installing a selection resets the pane's editing state, and the
 * caret's column is part of that.
 *
 * @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.select
 */
async function select(start: number, end: number, region: InputRegion): Promise<void> {
  await pane().typing.setSelection(start, end);
  await pane().typing.setInputRegion(region);
}

/** Waits for a search to settle: each reply costs a microtask and a turn. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  posted = [];
  dismissNotice(false);
});

afterEach(() => {
  // The stores outlive a test, so what one left standing would be the next
  // one's starting point: a staged pattern outlives the bar on purpose, and
  // there is no other way to take it down than the one the user has (typing).
  editQuery("");
  closeSearch();
  clearRecents();
  setSearchEncoding("ascii");
  dismissNotice(false);
});

// The whole point of the command: the pattern is loaded and the bar is left
// closed. The next ⌘F opens on it.
// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testItLoadsThePatternWithoutOpeningTheBar
test("the pattern is loaded and the bar stays closed", async () => {
  open([0x41, 0x42, 0xde, 0xad, 0xbe, 0xef]);
  // Something in the history for the staged pattern to outrank: without one,
  // "the bar opens on the pattern" would say nothing, since the field is left
  // holding it either way.
  startSearch({ query: "41", encoding: "hex", smart: false, from: 0 });
  await settle();
  closeSearch();
  expect(search().history[0]?.pattern).toBe("41");

  await select(2, 5, "hex");
  await useSelectionForFind();

  expect(search().open).toBe(false);
  expect(staged()).toEqual({ text: "DE AD BE", encoding: "hex" });
  expect(noticeStore.getSnapshot().current).toBeUndefined();

  openSearch();
  expect(search().open).toBe(true);
  expect(query()).toBe("DE AD BE");
  expect(search().encoding).toBe("hex");
});

// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testItRunsNoSearch
test("no search is run, and the selection stays where the user put it", async () => {
  open([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
  await select(0, 2, "hex");
  await useSelectionForFind();

  expect(posted.filter((request) => request.kind === "search")).toEqual([]);
  expect(results().status).toBe("idle");
  expect(results().current).toBeUndefined();
  expect(pane().document.selection).toMatchObject({ start: 0, end: 2 });
  expect(search().open).toBe(false);
});

// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testTheHexColumnGivesBytes
test("a selection in the hex column is bytes, whatever they also read as", async () => {
  open([0x42, 0x49, 0x4f, 0x53]); // "BIOS"
  await select(0, 4, "hex");
  await useSelectionForFind();

  expect(staged()).toEqual({ text: "42 49 4F 53", encoding: "hex" });
});

// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testTheDecodedTextColumnGivesText
test("a selection in the text column is the text it reads as", async () => {
  open([0x41, 0x4d, 0x49, 0x20, 0x42, 0x49, 0x4f, 0x53]); // "AMI BIOS"
  await select(4, 8, "text");
  await useSelectionForFind();

  expect(staged()).toEqual({ text: "BIOS", encoding: "utf8" });
});

// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testTheDecodedTextColumnFallsBackToBytes
test("bytes in the text column that are not text come back as bytes", async () => {
  open([0xff, 0xff, 0xfe, 0x80]);
  await select(0, 3, "text");
  await useSelectionForFind();

  expect(staged()).toEqual({ text: "FF FF FE", encoding: "hex" });
});

// A pattern loaded into an **open** bar replaces what the field said, and ends
// the search that field described — a count left standing would be about a
// pattern that is no longer there (§11).
// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testAnOpenBarShowsThePatternAndDropsTheOldCount
test("a pattern loaded into an open bar replaces the field and drops the count", async () => {
  open([0x41, 0x42, 0x41, 0x42, 0xde, 0xad]);
  openSearch();
  startSearch({ query: "41", encoding: "hex", smart: false, from: 0 });
  await settle();
  // There has to be a count for this to say anything: the fake worker answered.
  expect(results().status).toBe("found");
  expect(results().current).toEqual({ start: 0, end: 1 });

  await select(4, 6, "hex");
  await useSelectionForFind();

  expect(search().open).toBe(true); // an open bar stays open
  expect(query()).toBe("DE AD"); // and says what it will search for now
  expect(results().status).toBe("idle"); // the count described the other pattern
  expect(results().matches).toBeUndefined(); // and so did the greys
  expect(results().current).toBeUndefined();
});

// The loaded pattern is what the *next* open offers, and only until the user
// says something newer: typing in the field is theirs.
// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testTypingInTheFieldSupersedesTheLoadedPattern
test("typing in the field supersedes the loaded pattern", async () => {
  open([0x41, 0x42, 0xde, 0xad]);
  await select(2, 4, "hex");
  await useSelectionForFind();
  openSearch();

  editQuery("41 42");

  expect(staged()).toBeUndefined(); // what the user typed is the newer statement
  expect(query()).toBe("41 42");
});

// Upstream states this rule in `FindBarView.onSearch` rather than in its app
// tests; the web keeps it, so it is checked here. A search supersedes a staged
// pattern because what it finds goes into the history, which is what the next
// open offers.
test("a search supersedes the loaded pattern", async () => {
  open([0x41, 0x42, 0xde, 0xad]);
  await select(2, 4, "hex");
  await useSelectionForFind();

  startSearch({ query: "41", encoding: "hex", smart: false, from: 0 });
  // Cleared as the search starts, not when it lands: a search picked from the
  // menu is a search too, and every arm of `startSearch` is one.
  expect(staged()).toBeUndefined();

  await settle();
  closeSearch();
  openSearch();

  expect(query()).toBe("41"); // the history, not the selection, is offered back
});

// And a bar closed and opened again without anything typed offers the staged
// pattern: it is the newer statement than the history, and it outlives the bar.
test("closing the bar keeps the loaded pattern", async () => {
  open([0x41, 0x42, 0xde, 0xad]);
  await select(2, 4, "hex");
  await useSelectionForFind();

  closeSearch();
  expect(staged()).toBeDefined();

  openSearch();
  expect(query()).toBe("DE AD");
  expect(search().encoding).toBe("hex");
});

// A selection too long to be a pattern is refused in words rather than quietly
// truncated: a shortened pattern would find places the user never asked about,
// and the field has to be readable as the thing that was selected (§11).
// @upstream ByteRipperTests/UseSelectionForFindTests.swift#UseSelectionForFindTests.testAnOverlongSelectionIsRefused
test("a selection too long to be a pattern is refused in words", async () => {
  const size = MAX_SELECTION_FIND_BYTES + 16;
  open(new Array<number>(size).fill(0xff));
  await select(0, size, "hex");
  await useSelectionForFind();

  expect(staged()).toBeUndefined(); // nothing was loaded
  expect(noticeStore.getSnapshot().current?.lines).toEqual([
    "Selection too long to search for",
    `Up to ${MAX_SELECTION_FIND_BYTES} bytes can be used as a find pattern.`,
  ]);

  // And the limit itself is usable: one byte less is taken.
  await select(0, MAX_SELECTION_FIND_BYTES, "hex");
  await useSelectionForFind();
  expect(staged()).toBeDefined();
});
