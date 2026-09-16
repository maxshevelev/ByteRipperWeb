/**
 * A content change, as the tree's reader hears it.
 *
 * `contentChange.test.ts` proves the merge rules on their own. What it cannot
 * see is the *delivery*: that a burst of typing becomes one change rather than
 * thirty, that a reload does not wait for a delay nobody is coming to fill, and
 * that what crosses is the content as it now stands rather than what the file
 * was opened with.
 *
 * The worker is faked. This is about which questions get asked and with what,
 * not about parsing, which the firmware tests cover against upstream's own
 * cases.
 */

import { beforeEach, expect, test, vi } from "vitest";
import type { UndoOperation } from "@/core/edit/undoHistory";

interface Posted {
  readonly kind: string;
  readonly id: number;
  readonly content?: Blob;
  readonly range?: readonly [number, number];
  readonly sizeDelta?: number;
}

/** Every request the store has sent, in order. */
let posted: Posted[] = [];

/** A worker that records what it is asked and answers nothing. */
class FakeWorker implements Pick<Worker, "addEventListener" | "removeEventListener"> {
  addEventListener(_type: string, _listener: unknown): void {}
  removeEventListener(_type: string, _listener: unknown): void {}
  terminate(): void {}

  postMessage(request: Posted): void {
    posted.push(request);
  }
}

// Installed before the store is imported, because `ensureWorker` constructs one
// the first time a pane's tree is read and keeps it for the life of the module.
(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const { noteFirmwareOperations, openFirmware } = await import("@/state/firmwareStore");
const { editingHooks, openEmptyInPane, openInPane, revertPane, workspaceStore } = await import(
  "@/state/workspaceStore"
);

/** An overwrite of two bytes at 0x10 — the shape nearly every edit here has. */
const overwrite = (at: number): UndoOperation => ({
  kind: "overwrite",
  at,
  before: new Uint8Array(2),
  after: new Uint8Array([0xff, 0xff]),
});

/** The invalidations sent so far. */
const invalidations = () => posted.filter((request) => request.kind === "firmwareInvalidate");
const parses = () => posted.filter((request) => request.kind === "openFirmware");

/**
 * Lets the delivery finish what it does without a timer: gathering the content
 * is a promise even when the change goes straight through.
 */
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

/**
 * The store's delivery is on a timer, and the point of several of these cases
 * is that it *is* one. Faked rather than slept through, so a case says what it
 * means about the delay instead of racing it.
 */
beforeEach(() => {
  posted = [];
  vi.useFakeTimers();
  // The app installs the content-change hook at start-up, and it is what
  // carries a pane's news from the document to the tree. It goes on *after*
  // this file's own opening, so that the opening is not itself news the cases
  // below would have to allow for — and without it nothing here would hear the
  // workspace replacing a file, which is what the last cases are about.
  editingHooks.onContentChange = undefined;
  openInPane("a", {
    name: "dump.bin",
    size: 0x100,
    lastModified: 0,
    source: new Blob([new Uint8Array(0x100)]),
  });
  // A tree has to be open before anything is delivered to it: with no worker
  // there is nothing reading this pane's bytes and nothing to tell.
  openFirmware("a", new Blob([new Uint8Array(0x100)]));
  editingHooks.onContentChange = noteFirmwareOperations;
  posted = [];
});

// Typing lands one edit per keystroke; the tree hears one change, over the whole
// stretch they touched.
// @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testEditsArriveAsOneChangeOverTheStretchTheyTouched
// @upstream-differs what hears it is the tree firmwareStore holds for the pane, which is what a tool renders from, where upstream calls each active session's contentChanged
test("holds a burst of edits and delivers the stretch they all touched", async () => {
  noteFirmwareOperations("a", [overwrite(0x40)]);
  noteFirmwareOperations("a", [overwrite(0x20)]);
  noteFirmwareOperations("a", [overwrite(0x30)]);

  // Nothing yet: a change per keystroke would be a parse per keystroke.
  expect(invalidations()).toEqual([]);

  await vi.advanceTimersByTimeAsync(400);

  const sent = invalidations();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.range).toEqual([0x20, 0x42]);
  expect(sent[0]?.sizeDelta).toBe(0);
});

test("adds up the length changes of the edits it held", async () => {
  noteFirmwareOperations("a", [{ kind: "insert", at: 0x10, bytes: new Uint8Array(4) }]);
  noteFirmwareOperations("a", [{ kind: "delete", at: 0x20, bytes: new Uint8Array(2) }]);

  await vi.advanceTimersByTimeAsync(400);

  const sent = invalidations();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.sizeDelta).toBe(2);
});

// A revert replaces the content wholesale, so nothing read before it can be
// relied on — and it goes out at once, with nothing coming behind it to wait for.
// @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testAReplacedContentArrivesAsAReload
// @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testAReloadReachesTheSessionWithoutWaiting
test("replaces what the tree holds, and without waiting out the delay", async () => {
  // No operations: the content was replaced outright — a revert, a change made
  // outside the app. There is nothing coming behind it to coalesce with, and
  // holding it back is the panel sitting on a tree of a file that is gone.
  noteFirmwareOperations("a", []);
  await settle();

  expect(parses()).toHaveLength(1);
});

// A reload swallows an edit that was still waiting: there is nothing left to be
// precise about.
// @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testAReloadSwallowsAnEditStillWaiting
test("lets a reload swallow a held edit, which never goes out", async () => {
  noteFirmwareOperations("a", [overwrite(0x10)]);
  noteFirmwareOperations("a", []);
  await settle();

  expect(parses()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(400);
  // The edit's offsets are measured in content that has since been replaced,
  // so there is nothing left to be precise about.
  expect(invalidations()).toEqual([]);
});

test("carries the content as it now stands, not what the file was opened with", async () => {
  // A real edit, through the document: what crosses to the worker is the
  // content the *document* now holds, which is what the containers it drops are
  // read again from.
  const document = workspaceStore.getSnapshot().panes.a?.document;
  if (document === undefined) throw new Error("the pane did not open");
  await document.insert(0x10, new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
  noteFirmwareOperations("a", [{ kind: "insert", at: 0x10, bytes: new Uint8Array(4) }]);
  await vi.advanceTimersByTimeAsync(400);

  const sent = invalidations()[0];
  expect(sent?.content?.size).toBe(0x104);
  if (sent?.content === undefined) throw new Error("nothing was sent");
  const bytes = new Uint8Array(await sent.content.arrayBuffer());
  expect(bytes.slice(0x10, 0x14)).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
});

test("tells nobody about a pane nothing is reading", async () => {
  noteFirmwareOperations("b", [overwrite(0x10)]);

  await vi.advanceTimersByTimeAsync(400);

  expect(posted).toEqual([]);
});

// Opening a file into the pane a tool is reading: the tree in hand was read
// from the file the pane *had*, so it is not an older reading of what is on
// screen, it is a reading of something else. The panel would go on showing the
// analysis of the dump that was there before, under the new file's name.
//
// Three ways in, and they are one rule: a file opened into the pane, a New, a
// duplicate. A revert is the fourth, and arrives from the other direction — the
// document reports it with an empty operation list.
// @upstream ByteRipperTests/ToolSessionTests.swift#ToolSessionTests.testAReplacedContentArrivesAsAReload
test("reads the pane again when a file is opened into it", async () => {
  openInPane("a", {
    name: "other.bin",
    size: 0x40,
    lastModified: 0,
    source: new Blob([new Uint8Array(0x40)]),
  });
  await settle();

  const sent = parses();
  expect(sent).toHaveLength(1);
  // The tree is read from the bytes that are on screen now, not the ones that
  // were there when it was opened.
  expect(sent[0]?.content?.size).toBe(0x40);
});

test("reads the pane again when a New replaces what it held", async () => {
  openEmptyInPane("a");
  await settle();

  expect(parses()).toHaveLength(1);
  expect(parses()[0]?.content?.size).toBe(0);
});

test("reads the saved bytes again when a revert replaces an edit", async () => {
  // The revert is the document's own news — an operation list with nothing in
  // it is a replacement, exactly as an open is — and it goes out the same way.
  const document = workspaceStore.getSnapshot().panes.a?.document;
  if (document === undefined) throw new Error("the pane did not open");
  await document.insert(0x10, new Uint8Array([0xaa]));
  // The edit's own delivery, which is an invalidation and not a reload.
  await vi.advanceTimersByTimeAsync(400);
  await settle();
  posted = [];

  await revertPane("a");
  await settle();

  const sent = parses();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.content?.size).toBe(0x100);
});
