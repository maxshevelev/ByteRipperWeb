import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  canNavigateBack,
  canNavigateForward,
  followCaretVisibility,
  forgetCaretOnScreen,
  forgetToolArrival,
  navigateBack,
  navigateForward,
  navigationHistory,
  noteToolStep,
  recordJump,
} from "@/state/navigationStore";
import { registerToolNavigation, resetToolNavigation, toolChoiceOf } from "@/state/toolNavigation";
import {
  openEmptyInPane,
  openInPane,
  paneState,
  setActivePane,
  workspaceStore,
} from "@/state/workspaceStore";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * §10.6 in a workspace: which acts record, and what Back and Forward put back. Ported from
 * upstream's `NavigationHistoryFlowTests`, at the level this port has one — the state and the
 * scroll link, not a window around them.
 *
 * @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests
 */

const ROW = 16;
const VIEWPORT = 10 * ROW;

/** A pane's scrolling element, as the link sees it: pixels from the top. */
function scroller(size: number) {
  let top = 0;
  const pane: LinkedScroller = {
    rowHeight: () => ROW,
    position: () => ({ top, left: 0 }),
    extent: () => ({
      maxTop: Math.max(0, (Math.ceil(size / ROW) + 1) * ROW - VIEWPORT),
      maxLeft: 0,
      viewportHeight: VIEWPORT,
    }),
    moveTo: (position) => {
      top = position.top;
    },
  };
  return {
    pane,
    /** A scroll by the reader: the position moves, and the link is told. */
    scrollBy(points: number, id: string) {
      top = Math.max(0, top + points);
      scrollLink.report(id);
    },
  };
}

const leave: (() => void)[] = [];

async function fileIn(pane: "a" | "b", size: number, name = "dump.bin") {
  openInPane(pane, {
    name,
    size,
    lastModified: 0,
    source: new Blob([new Uint8Array(size).fill(0x11)]),
  });
  const slot = paneState(pane);
  if (slot === undefined) throw new Error("pane should be open");
  const view = scroller(size);
  leave.push(scrollLink.register(pane, view.pane));
  return { document: slot.document, view };
}

beforeEach(() => {
  navigationHistory.removeAll();
  forgetToolArrival();
});

afterEach(() => {
  while (leave.length > 0) leave.pop()?.();
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
  scrollLink.forget("a");
  scrollLink.forget("b");
  forgetCaretOnScreen("a");
  forgetCaretOnScreen("b");
  resetToolNavigation();
});

/** A jump the way Go To makes one: the place it leaves is recorded, then the caret moves. */
function goTo(document: BinaryDocument, pane: "a" | "b", offset: number) {
  recordJump(pane);
  document.setSelection({ start: offset, end: offset, fileSize: document.size });
}

describe("Back and Forward", () => {
  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testBackUndoesAGoToAndForwardRedoesIt
  it("undoes a Go To, and redoes it", async () => {
    const { document, view } = await fileIn("a", 0x10000);
    document.setSelection({ start: 0x40, end: 0x40, fileSize: 0x10000 });
    const topBefore = scrollLink.visibleRange("a", ROW)?.start;
    // Nothing to go back to before a jump.
    expect(canNavigateBack()).toBe(false);

    goTo(document, "a", 0x8000);
    view.pane.moveTo({ top: ((0x8000 / ROW) * ROW) / 1, left: 0 });
    scrollLink.report("a");
    const topAfter = scrollLink.visibleRange("a", ROW)?.start;
    expect(document.caret).toBe(0x8000);
    expect(canNavigateBack()).toBe(true);

    navigateBack();
    expect(document.caret).toBe(0x40);
    // The same rows on screen.
    expect(scrollLink.visibleRange("a", ROW)?.start).toBe(topBefore);
    expect(canNavigateBack()).toBe(false);
    expect(canNavigateForward()).toBe(true);

    navigateForward();
    expect(document.caret).toBe(0x8000);
    expect(scrollLink.visibleRange("a", ROW)?.start).toBe(topAfter);
    expect(canNavigateForward()).toBe(false);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testTheCaretWalkingRecordsNothing
  it("records nothing for the caret walking", async () => {
    const { document } = await fileIn("a", 0x10000);
    goTo(document, "a", 0x4000);
    for (let step = 1; step <= 5; step++) {
      document.setSelection({
        start: 0x4000 + step * 16,
        end: 0x4000 + step * 16,
        fileSize: 0x10000,
      });
    }
    expect(navigationHistory.backStack).toHaveLength(1);
    navigateBack();
    expect(document.caret).toBe(0);
    // Forward goes back to where the walk ended, not to where the jump landed.
    navigateForward();
    expect(document.caret).toBe(0x4000 + 5 * 16);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testPagingTheCaretOffScreenIsOneStep
  it("takes paging the caret off screen as one step", async () => {
    const { document, view } = await fileIn("a", 0x40000);
    document.setSelection({ start: 0x1000, end: 0x1000, fileSize: 0x40000 });
    view.pane.moveTo({ top: (0x1000 / ROW) * ROW, left: 0 });
    scrollLink.report("a");
    navigationHistory.removeAll();
    followCaretVisibility();

    for (let page = 0; page < 6; page++) view.scrollBy(VIEWPORT, "a");
    const shown = scrollLink.visibleRange("a", ROW);
    expect(shown !== undefined && shown.start > 0x1000).toBe(true);
    expect(navigationHistory.backStack).toHaveLength(1);
    // Paging leaves the caret where it is.
    expect(document.caret).toBe(0x1000);

    navigateBack();
    expect(document.caret).toBe(0x1000);
    const back = scrollLink.visibleRange("a", ROW);
    // The caret is on screen again.
    expect(back !== undefined && back.start <= 0x1000 && 0x1000 < back.end).toBe(true);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testScrollingIsAStepOnlyWhenTheCaretGoesOffScreen
  it("takes scrolling as a step only when the caret goes off screen", async () => {
    const { document, view } = await fileIn("a", 0x40000);
    const steps = () => navigationHistory.backStack.length;
    document.setSelection({ start: 0x40, end: 0x40, fileSize: 0x40000 });
    followCaretVisibility();

    view.scrollBy(5, "a");
    // The caret is still on screen.
    expect(steps()).toBe(0);
    view.scrollBy(5000, "a");
    // Off screen: a step.
    expect(steps()).toBe(1);
    view.scrollBy(5000, "a");
    // Still off screen: the same step.
    expect(steps()).toBe(1);
    view.scrollBy(-20000, "a");
    // Back on screen.
    expect(steps()).toBe(1);
    document.setSelection({ start: 0x200, end: 0x200, fileSize: 0x40000 });
    view.scrollBy(5000, "a");
    // Off again: a new step.
    expect(steps()).toBe(2);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testAPlaceInAReplacedFileIsSkipped
  it("skips a place in a file that was replaced in its pane", async () => {
    const { document } = await fileIn("a", 0x10000);
    goTo(document, "a", 0x4000);
    expect(canNavigateBack()).toBe(true);
    openEmptyInPane("a", "other.bin");
    expect(canNavigateBack()).toBe(false);
  });

  // @upstream ByteRipperTests/NavigationHistoryTests.swift#NavigationHistoryFlowTests.testBackPutsBothPanesOfAComparisonBack
  it("puts both panes of a comparison back", async () => {
    const first = await fileIn("a", 300 * 16, "left.bin");
    const second = await fileIn("b", 300 * 16, "right.bin");
    setActivePane("a");

    recordJump("a");
    first.document.setSelection({ start: 1600, end: 1600, fileSize: 300 * 16 });
    second.document.setSelection({ start: 1600, end: 1600, fileSize: 300 * 16 });

    navigateBack();
    expect(first.document.caret).toBe(0);
    expect(second.document.caret).toBe(0);
  });
});

describe("a tool's choice in the history", () => {
  /** A tool panel as the window sees it: a row in focus, and what was done with it. */
  function tool(module: string) {
    const state = { row: undefined as string | undefined, focused: 0 };
    const shown: unknown[] = [];
    const handle = {
      mark: () => state.row,
      show: (mark: unknown) => {
        shown.push(mark);
        state.row = mark as string;
      },
      focus: () => {
        state.focused += 1;
      },
    };
    return { state, shown, handle, module };
  }

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testBackWalksTheRowsClickedInTheTree
  it("chooses the row clicked again, and gives its table the keyboard", async () => {
    const { document } = await fileIn("a", 0x10000);
    const panel = tool("fit");
    leave.push(registerToolNavigation("a", panel.module, panel.handle));

    // A click on a row: the place it leaves is a step of the table, taken before the choice.
    panel.state.row = "one";
    noteToolStep("a");
    panel.state.row = "two";
    document.setSelection({ start: 0x20, end: 0x20, fileSize: 0x10000 });

    navigateBack();
    expect(panel.shown).toEqual(["one"]);
    expect(panel.state.focused).toBe(1);
    expect(document.caret).toBe(0);

    navigateForward();
    expect(panel.shown).toEqual(["one", "two"]);
    expect(panel.state.focused).toBe(2);
  });

  it("gives the keyboard to the dump for a jump that was not a click on a row", async () => {
    const { document } = await fileIn("a", 0x10000);
    const panel = tool("fit");
    leave.push(registerToolNavigation("a", panel.module, panel.handle));
    panel.state.row = "one";

    goTo(document, "a", 0x4000);
    navigateBack();

    // The row is chosen again, but the arrow keys belong to the dump.
    expect(panel.shown).toEqual(["one"]);
    expect(panel.state.focused).toBe(0);
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testBackChoosesTheRowClickedBeforeTheToolWasClosed
  it("keeps the choice of a tool that was closed, and chooses it again once it is open", async () => {
    const { document } = await fileIn("a", 0x10000);
    const first = tool("fit");
    const ends = registerToolNavigation("a", first.module, first.handle);
    first.state.row = "clicked";
    noteToolStep("a");
    first.state.row = "later";
    // Closed: the session ends and the last choice stays with the pane.
    ends();
    expect(toolChoiceOf("a")).toEqual({ module: "fit", mark: "later" });
    document.setSelection({ start: 0x40, end: 0x40, fileSize: 0x10000 });

    navigateBack();
    // The dump alone was given back; the choice the place carried waits for the tool.
    expect(document.caret).toBe(0);
    expect(toolChoiceOf("a")).toEqual({ module: "fit", mark: "clicked" });

    const again = tool("fit");
    leave.push(registerToolNavigation("a", again.module, again.handle));
    again.state.row = undefined;
    navigateForward();
    expect(again.shown).toEqual(["later"]);
  });

  it("gives back the dump alone for a place whose tool is not the one open", async () => {
    await fileIn("a", 0x10000);
    const fit = tool("fit");
    const ends = registerToolNavigation("a", fit.module, fit.handle);
    fit.state.row = "one";
    noteToolStep("a");
    ends();

    const other = tool("me");
    leave.push(registerToolNavigation("a", other.module, other.handle));
    navigateBack();

    expect(other.shown).toEqual([]);
  });
});
