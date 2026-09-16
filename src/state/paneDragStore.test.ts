import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginFileDrag,
  beginPaneDrag,
  draggedPaneId,
  endDrag,
  notePaneDragCopying,
  notePaneDragZone,
  paneDragIsCopying,
  paneDragStore,
} from "@/state/paneDragStore";

/**
 * The gesture's memory. Upstream this lived on the overlay and was driven
 * through `PaneDropBandsView`'s testing seams; here it is a store, so it is read
 * directly — and the behaviours worth pinning are the ones its comments argue
 * for: the modifier recorded once for everyone, the pane kept across a band that
 * refuses it, and everything forgotten when the drag ends.
 */

beforeEach(() => {
  endDrag();
});

describe("the pane drag store", () => {
  it("starts with nothing in flight", () => {
    expect(paneDragStore.getSnapshot().inFlight).toBeUndefined();
    expect(draggedPaneId()).toBeUndefined();
    expect(paneDragIsCopying()).toBe(false);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheRegistryFindsAPaneByItsDragID
  it("remembers which pane was picked up, and forgets it when the drag ends", () => {
    beginPaneDrag("b");
    expect(paneDragStore.getSnapshot().inFlight).toBe("pane");
    expect(draggedPaneId()).toBe("b");

    endDrag();
    expect(draggedPaneId()).toBeUndefined();
    expect(paneDragStore.getSnapshot().zone).toBeUndefined();
  });

  it("tells a file drag apart from a pane drag", () => {
    beginFileDrag();
    expect(paneDragStore.getSnapshot().inFlight).toBe("file");
    // Nothing to name: a file drag carries files, not a pane.
    expect(draggedPaneId()).toBeUndefined();
  });

  it("drops a modifier change the drag did not make", () => {
    // Option going down over one overlay is news for all of them, and the
    // second one to hear it must not undo the first.
    beginPaneDrag("a");
    notePaneDragCopying(true);
    expect(paneDragIsCopying()).toBe(true);

    endDrag();
    expect(paneDragIsCopying()).toBe(false);
  });

  it("does not wake a subscriber for news that changes nothing", () => {
    beginPaneDrag("a");
    const listener = vi.fn();
    const unsubscribe = paneDragStore.subscribe(listener);

    notePaneDragCopying(false); // already false
    notePaneDragZone(undefined); // already nothing
    endDrag(); // the only change
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testCrossingTheRefusedMiddleBandDoesNotEndTheDrag
  it("keeps the pane in flight across a band that refuses it", () => {
    // Crossing the one zone with nothing to offer — the middle band over the
    // pane's own slot — takes the bands down but not the drag, or every band
    // after it answers "no" for the rest of the flight.
    beginPaneDrag("a");
    notePaneDragZone("replace");
    notePaneDragZone(undefined); // nothing to offer here
    expect(paneDragStore.getSnapshot().zone).toBeUndefined();
    expect(draggedPaneId()).toBe("a");

    // On the next pane, everything is still known.
    notePaneDragZone("appendAtEnd");
    expect(paneDragStore.getSnapshot().zone).toBe("appendAtEnd");
    expect(draggedPaneId()).toBe("a");
  });

  it("starts a fresh gesture clean", () => {
    beginPaneDrag("a");
    notePaneDragCopying(true);
    notePaneDragZone("replace");

    beginPaneDrag("b");
    expect(paneDragStore.getSnapshot()).toMatchObject({
      inFlight: "pane",
      paneId: "b",
      copying: false,
      zone: undefined,
    });
  });
});
