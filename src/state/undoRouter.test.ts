import { beforeEach, describe, expect, it } from "vitest";
import {
  applySegments,
  clearSegments,
  noteSegmentEdit,
  resetSegments,
  segmentsFor,
} from "@/state/segmentsStore";
import { groupActs, redoLast, undoHooks, undoLast } from "@/state/undoRouter";
import type { PaneId } from "@/state/workspaceStore";

/**
 * The partition across undo and redo: it comes back as it was, not as the
 * inverse edits leave it.
 *
 * Only partition acts here — a document needs a pane — with the edits an undo
 * would make played through `noteSegmentEdit`, which is all the partition hears
 * of them.
 */

const cuts = () => segmentsFor("a")?.cuts ?? [];
const names = () => segmentsFor("a")?.segments.map((segment) => segment.name) ?? [];

beforeEach(() => {
  clearSegments("a");
  clearSegments("b");
  resetSegments("a", 64);
});

describe("a redo", () => {
  it("puts back a cut that an edit in between swallowed and gave back", async () => {
    applySegments("a", (partition) => partition.addCut(32));
    await undoLast("a", false);
    expect(cuts()).toEqual([]);

    // What undoing and redoing a join does to the partition waiting to be
    // redone: the bytes around the cut go, and come back.
    noteSegmentEdit("a", { kind: "delete", start: 24, end: 40 }, 48);
    noteSegmentEdit("a", { kind: "insert", at: 24, length: 16 }, 64);

    await redoLast("a");
    expect(cuts()).toEqual([32]);
  });
});

describe("a group", () => {
  it("is taken back to the partition it started from, and redone to the one it left", async () => {
    await groupActs("a", async () => {
      applySegments("a", (partition) => partition.addCut(48)?.rename(0, "bios.bin"));
      applySegments("a", (partition) => partition.rename(1, "donor.bin"));
    });
    expect(cuts()).toEqual([48]);

    await undoLast("a", false);
    expect(cuts()).toEqual([]);
    expect(names()).toEqual([""]);

    // As a join's undo leaves it: the joined bytes gone and back.
    noteSegmentEdit("a", { kind: "delete", start: 48, end: 64 }, 48);
    noteSegmentEdit("a", { kind: "insert", at: 48, length: 16 }, 64);

    await redoLast("a");
    expect(cuts()).toEqual([48]);
    expect(names()).toEqual(["bios.bin", "donor.bin"]);
  });
});

/**
 * Where the dump goes after a step is the shell's business — the pane's reveal
 * requests — and which step was taken is the router's, so the router says when
 * there is one to reveal rather than scrolling itself.
 */
describe("the caret a step restores", () => {
  it("is handed over after every step, and not when there was nothing to take back", async () => {
    // The stacks are the module's, and the cases above leave acts on them:
    // drain to the state a freshly loaded page is in before listening.
    undoHooks.onCaretRestored = undefined;
    while (await undoLast("a", false)) {
      // take back whatever the cases above left
    }

    const revealed: PaneId[] = [];
    undoHooks.onCaretRestored = (pane) => revealed.push(pane);

    // Nothing left in either history: no step, so nothing to reveal — and the
    // key stays free for whatever else wants it.
    expect(await undoLast("a", false)).toBe(false);
    expect(revealed).toEqual([]);

    applySegments("a", (partition) => partition.addCut(32));
    expect(await undoLast("a", false)).toBe(true);
    expect(revealed).toEqual(["a"]);

    // A redo is a step too, even when the caret lands where the undo left it:
    // it is a navigation command wherever the caret ends up.
    expect(await redoLast("a")).toBe(true);
    expect(revealed).toEqual(["a", "a"]);

    // The reveal is the pane's own press, never the other pane's.
    expect(await undoLast("b", false)).toBe(false);
    expect(revealed).toEqual(["a", "a"]);

    undoHooks.onCaretRestored = undefined;
  });
});
