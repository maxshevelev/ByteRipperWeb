import { describe, expect, it } from "vitest";
import {
  DropBandLayout,
  isDuplicate,
  isJoin,
  type PaneDropDestination,
  paneBandTitle,
  paneDropOutcome,
  singleFileDropTargetTitle,
  singleFilePaneDrop,
} from "@/ui/drag/dragDrop";

/**
 * Ported from `DropBandLayoutTests.swift` and the pure half of `PaneDragTests.swift`.
 *
 * Upstream's tests name a pane by its index (0 and 1); the web names it by its
 * slot, so `a` and `b` stand where `0` and `1` do and the expected values below
 * are upstream's own. The tests that drive a real view — `bandForTesting`,
 * `paneDragEnteredForTesting`, `titleForTesting`, the `DropTargetView` half of
 * the refusal test, and the controller cases — are left to the module map: they
 * need a component harness this port does not have, the same decision G19, G37
 * and G38 made. A y within a half is top-down, 0 at the half's own top edge.
 */

const onto = (
  index: "a" | "b",
  inOriginWindow: boolean,
  band: "insertAtStart" | "replace" | "appendAtEnd" | "addSecond"
): PaneDropDestination => ({ kind: "pane", index, inOriginWindow, band });

const outside: PaneDropDestination = { kind: "outside" };

// @upstream ByteRipperTests/DropBandLayoutTests.swift
describe("drop-band geometry", () => {
  const layout = (halfHeight: number) => new DropBandLayout({ halfHeight });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testTopStripMapsToInsertAtStart
  it("maps the top strip to Insert at Start, its last row included", () => {
    const l = layout(400); // strip = 100
    expect(l.band(0)).toBe("insertAtStart");
    expect(l.band(l.stripHeight - 1)).toBe("insertAtStart");
  });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testMiddleMapsToReplace
  it("maps the middle to Replace, both of its edge rows included", () => {
    const l = layout(400);
    expect(l.band(l.halfHeight / 2)).toBe("replace");
    expect(l.band(l.stripHeight)).toBe("replace");
    expect(l.band(l.halfHeight - l.stripHeight - 1)).toBe("replace");
  });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testBottomStripMapsToAppendAtEnd
  it("maps the bottom strip to Append at End, the half's last row included", () => {
    const l = layout(400);
    expect(l.band(l.halfHeight - 1)).toBe("appendAtEnd");
    expect(l.band(l.halfHeight - l.stripHeight)).toBe("appendAtEnd");
  });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testOutsideTheHalfIsNoBand
  it("answers no band outside the half", () => {
    const l = layout(400);
    expect(l.band(-1)).toBeUndefined();
    expect(l.band(l.halfHeight)).toBeUndefined();
  });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testStripHeightIsClamped
  it("clamps the strip to 48…120 pt, 25 % in between", () => {
    expect(layout(100).stripHeight).toBe(48); // a short half clamps up to the minimum
    expect(layout(1000).stripHeight).toBe(120); // a tall half clamps down to the maximum
    expect(layout(400).stripHeight).toBe(100); // exactly 25 % of the half
  });

  // @upstream ByteRipperTests/DropBandLayoutTests.swift#DropBandLayoutTests.testTheBandsTileTheHalfAtSeveralHeights
  it("tiles the half at several heights, with no gap and no overlap", () => {
    for (const halfHeight of [100, 192, 400, 600, 1000]) {
      const l = layout(halfHeight);
      const strip = l.stripHeight;
      // Every row in the half maps to exactly one band.
      for (let y = 0; y < halfHeight; y += 1) {
        expect(l.band(y), `row ${y} of a ${halfHeight} half`).toBeDefined();
      }
      // And the boundaries are consistent.
      expect(l.band(0)).toBe("insertAtStart");
      expect(l.band(strip)).toBe("replace");
      expect(l.band(halfHeight - strip)).toBe("appendAtEnd");
    }
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testNoInsetIsTheLayoutThatWasThereBefore
  it("is the layout that was there before when nothing takes an inset", () => {
    const plain = layout(400);
    expect(plain.topInset).toBe(0);
    expect(plain.bandHeight).toBe(400);
    expect(plain.stripHeight).toBe(100);
    expect(plain.band(0)).toBe("insertAtStart");
    expect(plain.replaceRange).toEqual({ start: 100, end: 300 });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheStripsShareBelongsToNoBand
  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAnOverlayClaimsNoBandInTheStripsShare
  it("gives the inset's own rows to no band", () => {
    const l = new DropBandLayout({ halfHeight: 400, topInset: 44 });

    expect(l.band(0)).toBeUndefined(); // the strip's own top
    expect(l.band(43.9)).toBeUndefined(); // still the strip
    expect(l.band(44)).toBe("insertAtStart"); // the first band starts here
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheBandsDivideWhatTheStripLeaves
  it("divides what the inset leaves, not the whole half", () => {
    const inset = new DropBandLayout({ halfHeight: 400, topInset: 44 });

    expect(inset.bandHeight).toBe(356);
    expect(inset.stripHeight).toBe(89); // 25 % of 356, inside the 48…120 clamp
    expect(inset.band(44 + 88)).toBe("insertAtStart");
    expect(inset.band(44 + 90)).toBe("replace");
    expect(inset.band(399)).toBe("appendAtEnd");
    expect(inset.band(400)).toBeUndefined(); // past the pane's bottom
  });
});

// @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests
describe("what a pane drop means", () => {
  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testDroppingOnTheOtherPaneOfTheSameWindowSwaps
  it("swaps the two panes of one workspace", () => {
    expect(paneDropOutcome("a", onto("b", true, "replace"))).toEqual({ kind: "swap" });
    expect(paneDropOutcome("b", onto("a", true, "replace"))).toEqual({ kind: "swap" });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testDroppingAPaneOnItselfDoesNothing
  it("does nothing when a pane is dropped back where it was picked up", () => {
    expect(paneDropOutcome("a", onto("a", true, "replace"))).toEqual({ kind: "none" });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testDroppingOnAnotherWindowsPaneMovesIntoThatSlot
  it("moves a pane into another workspace's slot", () => {
    expect(paneDropOutcome("a", onto("b", false, "replace"))).toEqual({
      kind: "move",
      intoPane: "b",
    });
    // Even the same slot, which within one workspace would have been a no-op.
    expect(paneDropOutcome("a", onto("a", false, "replace"))).toEqual({
      kind: "move",
      intoPane: "a",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testDroppingOutsideDoesNothing
  it("does nothing outside every target", () => {
    expect(paneDropOutcome("a", outside)).toEqual({ kind: "none" });
    expect(paneDropOutcome("b", outside)).toEqual({ kind: "none" });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheEndBandsJoinAPaneIntoAnother
  it("joins a pane into another at either end", () => {
    expect(paneDropOutcome("a", onto("b", true, "insertAtStart"))).toEqual({
      kind: "join",
      intoPane: "b",
      at: "start",
    });
    expect(paneDropOutcome("a", onto("b", true, "appendAtEnd"))).toEqual({
      kind: "join",
      intoPane: "b",
      at: "end",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheMiddleBandSwapsOrMoves
  it("swaps in its own workspace and moves from another", () => {
    expect(paneDropOutcome("a", onto("b", true, "replace"))).toEqual({ kind: "swap" });
    expect(paneDropOutcome("a", onto("b", false, "replace"))).toEqual({
      kind: "move",
      intoPane: "b",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAPaneCanJoinItselfButNotSwapWithItself
  it("lets a pane join itself but not swap with itself", () => {
    expect(paneDropOutcome("b", onto("b", true, "insertAtStart"))).toEqual({
      kind: "join",
      intoPane: "b",
      at: "start",
    });
    expect(paneDropOutcome("b", onto("b", true, "appendAtEnd"))).toEqual({
      kind: "join",
      intoPane: "b",
      at: "end",
    });
    expect(paneDropOutcome("b", onto("b", true, "replace"))).toEqual({ kind: "none" });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAWindowsOwnPaneIsDuplicatedIntoItsFreeSlot
  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAPaneMovesIntoASingleFileWindowsFreePane
  it("duplicates a workspace's own pane into its free slot, and moves a stranger into it", () => {
    expect(paneDropOutcome("a", onto("b", true, "addSecond"))).toEqual({
      kind: "duplicate",
      intoPane: "b",
    });
    // A pane from elsewhere moves rather than copies.
    expect(paneDropOutcome("a", onto("b", false, "addSecond"))).toEqual({
      kind: "move",
      intoPane: "b",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testOptionTurnsAMoveIntoADuplicate
  it("turns a move into a duplicate when copying is asked for", () => {
    expect(paneDropOutcome("a", onto("b", false, "replace"))).toEqual({
      kind: "move",
      intoPane: "b",
    });
    expect(paneDropOutcome("a", onto("b", false, "replace"), true)).toEqual({
      kind: "duplicate",
      intoPane: "b",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testOptionTurnsASwapIntoADuplicate
  it("turns a swap into a duplicate when copying is asked for", () => {
    expect(paneDropOutcome("a", onto("b", true, "replace"))).toEqual({ kind: "swap" });
    expect(paneDropOutcome("a", onto("b", true, "replace"), true)).toEqual({
      kind: "duplicate",
      intoPane: "b",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testOptionLeavesAJoinAlone
  it("leaves a join alone when copying is asked for", () => {
    // A join already copies — the pane it reads from is left as it was — so
    // Option has nothing to add to it.
    expect(paneDropOutcome("a", onto("b", true, "insertAtStart"), true)).toEqual({
      kind: "join",
      intoPane: "b",
      at: "start",
    });
    expect(paneDropOutcome("a", onto("b", true, "appendAtEnd"), true)).toEqual({
      kind: "join",
      intoPane: "b",
      at: "end",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testOptionDoesNotMakeAPaneDroppedOnItselfDoAnything
  it("still does nothing on a pane's own middle band with copying asked for", () => {
    expect(paneDropOutcome("a", onto("a", true, "replace"), true)).toEqual({ kind: "none" });
  });
});

// @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests
describe("what the zones say", () => {
  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testEachBandIsCaptionedFromItsOwnOutcome
  it("captions each band from its own outcome, in the file zones' own words", () => {
    expect(paneBandTitle({ kind: "join", intoPane: "a", at: "start" })).toBe(
      singleFileDropTargetTitle("insertAtStart")
    );
    expect(paneBandTitle({ kind: "join", intoPane: "a", at: "end" })).toBe(
      singleFileDropTargetTitle("appendAtEnd")
    );
    expect(singleFileDropTargetTitle("insertAtStart")).toBe("Insert at Start");
    expect(singleFileDropTargetTitle("appendAtEnd")).toBe("Append at End");
    expect(singleFileDropTargetTitle("replace")).toBe("Replace Current File");
    expect(singleFileDropTargetTitle("addSecond")).toBe("Open as Second File");
    expect(paneBandTitle({ kind: "swap" })).toBe("Swap Panes");
    expect(paneBandTitle({ kind: "move", intoPane: "b" })).toBe("Move Here");
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testADuplicateIsReportedAsACopy
  it("reports a duplicate as a copy", () => {
    expect(paneBandTitle({ kind: "duplicate", intoPane: "b" })).toBe("Duplicate Here");
    expect(isDuplicate({ kind: "duplicate", intoPane: "b" })).toBe(true);
    // A pane from elsewhere moves; the zone keeps its own name for that.
    expect(isDuplicate({ kind: "move", intoPane: "b" })).toBe(false);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheCaptionFollowsTheModifier
  it("captions the band from what the modifier made it do", () => {
    // The middle band of another pane: Swap Panes on its own, Duplicate Here
    // with Option held — the same band, the words of what it will do now.
    const caption = (copying: boolean) =>
      paneBandTitle(paneDropOutcome("a", onto("b", true, "replace"), copying));

    expect(caption(false)).toBe("Swap Panes");
    expect(caption(true)).toBe("Duplicate Here");
  });

  it("calls the two end bands joins and the other two not", () => {
    expect(isJoin("insertAtStart")).toBe(true);
    expect(isJoin("appendAtEnd")).toBe(true);
    expect(isJoin("replace")).toBe(false);
    expect(isJoin("addSecond")).toBe(false);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testARefusingBandShowsTheRefusalSymbol
  it("says nothing where there is nothing to offer", () => {
    // Nothing to say means the symbol, not an empty caption.
    expect(paneBandTitle({ kind: "none" })).toBeUndefined();
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheMiddleBandIsTheOneThatRefusesOverAPanesOwnSlot
  it("refuses over a pane's own slot on the middle band alone", () => {
    const own = (band: "insertAtStart" | "replace" | "appendAtEnd") =>
      paneDropOutcome("a", onto("a", true, band));

    expect(paneBandTitle(own("insertAtStart"))).toBeDefined();
    expect(paneBandTitle(own("appendAtEnd"))).toBeDefined();
    expect(paneBandTitle(own("replace"))).toBeUndefined();
  });
});

// @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheSingleFileZonesMapToPanesTheSameWayTheyDoToFiles
describe("the single-file zones", () => {
  it("put the second half in the free pane and the three bands over the open one", () => {
    const arrangement = { open: "a", free: "b" } as const;
    expect(singleFilePaneDrop("addSecond", arrangement)).toEqual({ pane: "b", band: "addSecond" });

    for (const band of ["insertAtStart", "replace", "appendAtEnd"] as const) {
      const mapped = singleFilePaneDrop(band, arrangement);
      expect(mapped.pane).toBe("a"); // the band acts on the pane that is open
      expect(mapped.band).toBe(band);
    }
  });

  it("follows the file when the lone pane is the second one", () => {
    // The web lets the single file be the one in `b` — open two, close `a` —
    // where upstream's index 0 is simply "the pane that is open".
    const arrangement = { open: "b", free: "a" } as const;
    expect(singleFilePaneDrop("replace", arrangement)).toEqual({ pane: "b", band: "replace" });
    expect(singleFilePaneDrop("addSecond", arrangement)).toEqual({ pane: "a", band: "addSecond" });
  });
});
