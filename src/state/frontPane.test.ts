import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  canRenamePane,
  closePart,
  foldParts,
  frontPane,
  openEmptyInPane,
  openPart,
  paneState,
  raisePart,
  renamePane,
  setActivePane,
  windowPanesAreReachable,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Which pane a command is addressed to once parts can be opened over the files.
 *
 * Two answers, and the plan sorts every command into one of them
 * (`Design/FRAGMENT_PANELS_PLAN.md`, "Which commands follow the front
 * surface"): a command about a *document* means the part in the panel that is
 * up, and a command about the workspace's *panes* goes on meaning them — and is
 * refused while a panel covers them, rather than acting where nobody can see.
 */

afterEach(() => {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
    activePane: "a",
  }));
});

const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
const front = () => frontPane(workspaceStore.getSnapshot());
const panesReachable = () => windowPanesAreReachable(workspaceStore.getSnapshot());

describe("the pane in front", () => {
  it("is the active pane while the stage is clear", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("b");

    expect(front()).toBe("b");
  });

  it("is the part of the panel that is up", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");

    expect(front()).toBe(part);
  });

  /**
   * Folded again, the same command means the workspace's own pane.
   *
   * @upstream ByteRipperTests/FragmentToolTests.swift#FragmentToolTests.testFoldingThePanelGivesTheCommandBackToTheTab
   */
  it("goes back to the pane when the panel folds, and returns when it is raised", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");

    foldParts();
    expect(front()).toBe("a");

    raisePart(part);
    expect(front()).toBe(part);
  });

  it("goes back to the pane when the panel that was up closes", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");

    closePart(part);

    expect(front()).toBe("a");
  });

  /**
   * The two are not one pointer with two names: a part in front does not make
   * the workspace's own active pane anything else, and the pane commands go on
   * meaning what they meant.
   */
  it("leaves the workspace's own active pane where it was", () => {
    openEmptyInPane("a");
    openEmptyInPane("b");
    setActivePane("b");
    const part = openPart(bytes, "body.bin");

    expect(front()).toBe(part);
    expect(workspaceStore.getSnapshot().activePane).toBe("b");
  });

  /** The newest panel is the one in front: opening a second part folds the first. */
  it("is the part that was opened last", () => {
    openEmptyInPane("a");
    openPart(bytes, "first");
    const second = openPart(bytes, "second");

    expect(front()).toBe(second);
  });
});

describe("the workspace's own panes", () => {
  it("are reachable with nothing in front of them", () => {
    openEmptyInPane("a");

    expect(panesReachable()).toBe(true);
  });

  it("are out of reach while a panel is up", () => {
    openEmptyInPane("a");
    openPart(bytes, "body.bin");

    expect(panesReachable()).toBe(false);
  });

  /** A folded panel covers nothing: its pill is a pill, not a wall. */
  it("are reachable again once the panel is folded", () => {
    openEmptyInPane("a");
    openPart(bytes, "body.bin");

    foldParts();

    expect(panesReachable()).toBe(true);
  });
});

/**
 * A part is a document like any other, so the operations that are a document's
 * take it — and write it back where it lives rather than into a slot.
 */
describe("a document command handed a part", () => {
  it("renames the part and leaves the slots alone", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");

    expect(canRenamePane(part)).toBe(true);
    expect(renamePane(part, "volume.bin")).toBe(true);

    expect(paneState(part)?.name).toBe("volume.bin");
    expect(paneState("a")?.name).toBe("Untitled.bin");
  });

  it("writes nothing back for a part that has been closed", () => {
    const part = openPart(bytes, "body.bin");
    closePart(part);

    expect(renamePane(part, "volume.bin")).toBe(false);
    expect(paneState(part)).toBeUndefined();
  });
});
