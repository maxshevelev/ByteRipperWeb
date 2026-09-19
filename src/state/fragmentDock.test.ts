import { describe, expect, it } from "vitest";
import {
  collapsePanels,
  dockCount,
  dockIsEmpty,
  EMPTY_DOCK,
  expandPanel,
  type FragmentDock,
  NO_TRANSITION,
  openPanel,
  type PanelId,
  removePanel,
} from "@/state/fragmentDock";

/**
 * The dock's model — the order the pills sit in, the one-panel-up invariant,
 * and the transition every mutation hands back for the view to run. Pure: no
 * workspace, no surface, no document.
 */

/** `count` panels opened in a row, with the dock they leave behind. */
function opened(count: number): { dock: FragmentDock; ids: PanelId[] } {
  let dock = EMPTY_DOCK;
  const ids: PanelId[] = [];
  for (let index = 0; index < count; index++) {
    const change = openPanel(dock);
    dock = change.dock;
    ids.push(change.id);
  }
  return { dock, ids };
}

describe("opening", () => {
  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testOpeningIntoAnEmptyDockRaisesTheNewPanel
  it("raises the new panel in an empty dock", () => {
    const { id, dock, transition } = openPanel(EMPTY_DOCK);

    expect(dock.expanded).toBe(id);
    expect(dock.panels).toEqual([id]);
    // There was nothing up to fold.
    expect(transition.folding).toBeUndefined();
    expect(transition.raising).toBe(id);
    expect(transition.removed).toBeUndefined();
  });

  /**
   * Opening a second panel folds the first and raises the second in one
   * transition, rather than two that have to be sequenced by the caller.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testOpeningASecondPanelFoldsTheFirstInTheSameTransition
   */
  it("folds the first in the same transition as it raises the second", () => {
    const first = openPanel(EMPTY_DOCK);
    const second = openPanel(first.dock);

    expect(second.transition).toEqual({ folding: first.id, raising: second.id });
    expect(second.dock.expanded).toBe(second.id);
  });

  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testPanelsKeepTheOrderTheyWereOpenedIn
  it("keeps the panels in the order they were opened", () => {
    const { dock, ids } = opened(4);
    expect(dock.panels).toEqual(ids);

    const raised = expandPanel(dock, ids[0] as PanelId).dock;
    const folded = collapsePanels(raised).dock;

    // Raising and folding never reorder the dock.
    expect(folded.panels).toEqual(ids);
  });

  /**
   * Every panel is its own, including two opened on what may well be the same
   * part: the dock does not deduplicate.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testEveryOpenMakesADistinctPanel
   */
  it("makes a distinct panel every time", () => {
    const { dock, ids } = opened(5);

    expect(new Set(ids).size).toBe(5);
    expect(dockCount(dock)).toBe(5);
  });
});

describe("raising and folding", () => {
  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testExpandingAFoldedPanelSwapsTheTwo
  it("swaps the two when a folded panel is raised", () => {
    const { dock, ids } = opened(2);
    const [first, second] = ids as [PanelId, PanelId];

    const change = expandPanel(dock, first);

    expect(change.transition).toEqual({ folding: second, raising: first });
    expect(change.dock.expanded).toBe(first);
  });

  /**
   * Clicking the pill of the panel already on screen moves nothing — no fold,
   * no raise, and above all not a fold of the panel being asked for.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testExpandingThePanelThatIsUpChangesNothing
   */
  it("changes nothing when the panel that is up is raised again", () => {
    const { dock, ids } = opened(1);
    const change = expandPanel(dock, ids[0] as PanelId);

    expect(change.transition).toEqual(NO_TRANSITION);
    expect(change.dock.expanded).toBe(ids[0]);
  });

  /**
   * A panel this dock does not hold cannot be raised, and asking does not
   * disturb what is up.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testExpandingAPanelTheDockDoesNotHoldChangesNothing
   */
  it("changes nothing for a panel the dock does not hold", () => {
    const mine = opened(1);
    const stranger = openPanel(EMPTY_DOCK).id;

    const change = expandPanel(mine.dock, stranger);

    expect(change.transition).toEqual(NO_TRANSITION);
    expect(change.dock.expanded).toBe(mine.ids[0]);
    expect(dockCount(change.dock)).toBe(1);
  });

  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testCollapsingFoldsTheOneThatIsUpAndRaisesNothing
  it("folds the one that is up and raises nothing", () => {
    const { dock, ids } = opened(2);

    const change = collapsePanels(dock);

    expect(change.transition).toEqual({ folding: ids[1] });
    expect(change.dock.expanded).toBeUndefined();
    // Folding keeps both pills.
    expect(change.dock.panels).toEqual(ids);
  });

  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testCollapsingAClearStageChangesNothing
  it("is not an event on a clear stage", () => {
    expect(collapsePanels(EMPTY_DOCK).transition).toEqual(NO_TRANSITION);

    const once = collapsePanels(openPanel(EMPTY_DOCK).dock);
    expect(collapsePanels(once.dock).transition).toEqual(NO_TRANSITION);
  });
});

describe("removing", () => {
  /**
   * Removing the panel that is up folds it and clears the stage — the file it
   * was covering comes back, rather than the next pill.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testRemovingTheExpandedPanelFoldsItAndRaisesNothing
   */
  it("folds the expanded panel and raises nothing", () => {
    const { dock, ids } = opened(2);
    const [first, second] = ids as [PanelId, PanelId];

    const change = removePanel(dock, second);

    expect(change.transition).toEqual({ folding: second, removed: second });
    expect(change.dock.expanded).toBeUndefined();
    expect(change.dock.panels).toEqual([first]);
  });

  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testRemovingAFoldedPanelLeavesTheStageAlone
  it("leaves the stage alone when a folded panel goes", () => {
    const { dock, ids } = opened(2);
    const [first, second] = ids as [PanelId, PanelId];

    const change = removePanel(dock, first);

    expect(change.transition).toEqual({ removed: first });
    // The panel on screen did not move.
    expect(change.dock.expanded).toBe(second);
    expect(change.dock.panels).toEqual([second]);
  });

  // @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testRemovingKeepsTheOrderOfTheRest
  it("keeps the order of the rest", () => {
    const { dock, ids } = opened(4);

    const change = removePanel(dock, ids[1] as PanelId);

    expect(change.dock.panels).toEqual([ids[0], ids[2], ids[3]]);
  });

  /**
   * Removing something the dock does not hold — a panel removed twice, a pill
   * clicked as its close lands — changes nothing.
   *
   * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testRemovingAPanelTheDockDoesNotHoldChangesNothing
   */
  it("changes nothing when it is not held", () => {
    const { dock, ids } = opened(1);
    const id = ids[0] as PanelId;

    const once = removePanel(dock, id);
    expect(once.transition).toEqual({ folding: id, removed: id });

    const twice = removePanel(once.dock, id);
    expect(twice.transition).toEqual(NO_TRANSITION);
    expect(dockIsEmpty(twice.dock)).toBe(true);
  });
});

/**
 * The invariant, over a run of every mutation the dock has: at most one panel
 * is up, and the one that is up is always one the dock holds.
 *
 * @upstream ByteRipperTests/FragmentDockTests.swift#FragmentDockTests.testAtMostOnePanelIsEverUp
 */
it("never has a panel up that it does not hold", () => {
  let dock = EMPTY_DOCK;
  const live: PanelId[] = [];
  for (let step = 0; step < 12; step++) {
    if (step % 4 === 0) {
      const change = openPanel(dock);
      dock = change.dock;
      live.push(change.id);
    } else if (step % 4 === 1) {
      const first = live[0];
      if (first !== undefined) dock = expandPanel(dock, first).dock;
    } else if (step % 4 === 2) {
      dock = collapsePanels(dock).dock;
    } else {
      const last = live.pop();
      if (last !== undefined) dock = removePanel(dock, last).dock;
    }
    if (dock.expanded !== undefined) {
      expect(dock.panels, `after step ${step}: the panel up is not in the dock`).toContain(
        dock.expanded
      );
    }
  }
  expect(dockCount(dock)).toBe(live.length);
});
