import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySegments } from "@/state/segmentsStore";
import { redoLast, undoHooks, undoLast } from "@/state/undoRouter";
import { openEmptyInPane, type PaneId, workspaceStore } from "@/state/workspaceStore";

/**
 * Where the dump goes after a step is the shell's business — the pane's reveal requests — and
 * which step was taken is the session's, so the window's side of a press says when there is one to
 * reveal rather than scrolling itself. Which history a press takes back, and the partition it puts
 * back, is `src/core/session/sessionActs.test.ts`.
 */

beforeEach(() => {
  openEmptyInPane("a");
});

afterEach(() => {
  undoHooks.onCaretRestored = undefined;
  workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
});

describe("the caret a step restores", () => {
  it("is handed over after every step, and not when there was nothing to take back", async () => {
    const revealed: PaneId[] = [];
    undoHooks.onCaretRestored = (pane) => revealed.push(pane);

    // Nothing in either history: no step, so nothing to reveal — and the key stays free for
    // whatever else wants it.
    expect(await undoLast("a", false)).toBe(false);
    expect(revealed).toEqual([]);

    const document = workspaceStore.getSnapshot().panes.a?.document;
    await document?.insert(0, new Uint8Array(64));
    applySegments("a", (partition) => partition.addCut(32));
    await document?.settled();
    expect(await undoLast("a", false)).toBe(true);
    expect(revealed).toEqual(["a"]);

    // A redo is a step too, even when the caret lands where the undo left it: it is a navigation
    // command wherever the caret ends up.
    expect(await redoLast("a")).toBe(true);
    expect(revealed).toEqual(["a", "a"]);

    // The reveal is the pane's own press, never the other pane's.
    expect(await undoLast("b", false)).toBe(false);
    expect(revealed).toEqual(["a", "a"]);
  });
});
