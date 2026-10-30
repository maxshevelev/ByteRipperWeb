import { describe, expect, it } from "vitest";
import {
  bandPlateFrames,
  DROP_EDGE_PADDING,
  DropBandLayout,
  dropPlateInsets,
  dropZonePlates,
  fragmentDropOutcome,
  isDuplicate,
  isJoin,
  PANE_DROP_NONE,
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
    expect(singleFileDropTargetTitle("addSecond")).toBe("Open for Comparison");
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

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testARefusingBandIsMarkedRefused
  it("says nothing where there is nothing to offer", () => {
    // Nothing to say means refused, not an empty caption: such a band is not shown.
    expect(paneBandTitle({ kind: "none" })).toBeUndefined();
    const plates = dropZonePlates(["replace"] as const, {
      up: true,
      hovered: undefined,
      titleFor: () => paneBandTitle({ kind: "none" }),
    });
    expect(plates).toEqual([]);
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

// `Design/DESKTOP_WINDOWS.md`, D6: a fragment panel let go on a pane becomes that pane.
describe("a fragment panel let go on a pane", () => {
  it("moves into the pane it is let go on, through the middle or onto the free half", () => {
    expect(fragmentDropOutcome("a", "replace", true, 16, false)).toEqual({
      kind: "move",
      intoPane: "a",
    });
    expect(fragmentDropOutcome("b", "addSecond", false, 16, false)).toEqual({
      kind: "move",
      intoPane: "b",
    });
  });

  it("is copied there with Option, when it has bytes to copy", () => {
    expect(fragmentDropOutcome("b", "addSecond", false, 16, true)).toEqual({
      kind: "duplicate",
      intoPane: "b",
    });
    expect(fragmentDropOutcome("b", "addSecond", false, 0, true)).toEqual(PANE_DROP_NONE);
  });

  it("is never joined: its bytes belong in its parent, which Update in Parent puts them in", () => {
    expect(fragmentDropOutcome("a", "insertAtStart", true, 16, false)).toEqual(PANE_DROP_NONE);
    expect(fragmentDropOutcome("a", "appendAtEnd", true, 16, true)).toEqual(PANE_DROP_NONE);
  });

  it("finds no free half where the pane is open", () => {
    expect(fragmentDropOutcome("b", "addSecond", true, 16, false)).toEqual(PANE_DROP_NONE);
  });
});

/**
 * Which zones are on screen and which is lit (§4.3): the rule `FileDragZonesTests`
 * and the newer `PaneDragTests` drive through real views and a window, asked here of
 * the rule the overlays render from. A region's bands are lit only where the pointer
 * is over that region, so "the other pane" is a call with nothing hovered.
 */
describe("the zones a drag shows", () => {
  const BANDS = ["insertAtStart", "replace", "appendAtEnd"] as const;
  const fileTitle = (band: (typeof BANDS)[number]) => singleFileDropTargetTitle(band);
  const shown = (plates: { zone: string }[]) => plates.map((plate) => plate.zone);
  const lit = (plates: { highlighted: boolean }[]) => plates.map((plate) => plate.highlighted);

  // @upstream ByteRipperTests/FileDragZonesTests.swift#FileDragZonesTests.testAFileOverOnePaneShowsTheOtherPanesZonesUnlit
  it("puts up every pane's bands for a file, lighting only the one under the pointer", () => {
    const left = dropZonePlates(BANDS, { up: true, hovered: "replace", titleFor: fileTitle });
    const right = dropZonePlates(BANDS, { up: true, hovered: undefined, titleFor: fileTitle });

    expect(shown(left)).toEqual([...BANDS]);
    expect(lit(left)).toEqual([false, true, false]);
    expect(shown(right)).toEqual([...BANDS]); // the other pane's zones are up too
    expect(lit(right)).toEqual([false, false, false]); // and unlit
  });

  // @upstream ByteRipperTests/FileDragZonesTests.swift#FileDragZonesTests.testSingleFileModeShowsBothHalvesAndLightsTheOneUnderThePointer
  it("keeps both halves of a single-file view up and lights the one under the pointer", () => {
    const zones = [...BANDS, "addSecond"] as const;
    const title = (zone: (typeof zones)[number]) => singleFileDropTargetTitle(zone);

    const overBands = dropZonePlates(zones, { up: true, hovered: "replace", titleFor: title });
    expect(lit(overBands)).toEqual([false, true, false, false]);

    const overSecond = dropZonePlates(zones, { up: true, hovered: "addSecond", titleFor: title });
    expect(shown(overSecond)).toEqual([...zones]); // the bands stay up over the other half
    expect(lit(overSecond)).toEqual([false, false, false, true]);
    expect(overSecond[3]?.title).toBe("Open for Comparison");
  });

  // @upstream ByteRipperTests/FileDragZonesTests.swift#FileDragZonesTests.testAPaneDragShowsEveryPanesZonesAndNoneThatRefuse
  it("puts up, for a pane, every band that would take it and none that would refuse it", () => {
    const over = (pane: "a" | "b") =>
      dropZonePlates(BANDS, {
        up: true,
        hovered: undefined,
        titleFor: (band) => paneBandTitle(paneDropOutcome("a", onto(pane, true, band))),
      });

    // Its own slot joins at either end; its middle refuses and is not shown.
    expect(shown(over("a"))).toEqual(["insertAtStart", "appendAtEnd"]);
    expect(shown(over("b"))).toEqual([...BANDS]);
    expect(lit([...over("a"), ...over("b")])).toEqual(Array(5).fill(false));
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheRefusedBandLeavesTheOtherBandsUp
  it("leaves the other bands up over the refused one, with nothing lit", () => {
    // The region refuses under the pointer, so nothing is hovered there.
    const plates = dropZonePlates(BANDS, {
      up: true,
      hovered: undefined,
      titleFor: (band) => paneBandTitle(paneDropOutcome("a", onto("a", true, band))),
    });
    expect(shown(plates)).toEqual(["insertAtStart", "appendAtEnd"]);
    expect(lit(plates)).toEqual([false, false]);
  });

  it("shows nothing while no drag is on, or while a panel covers the panes", () => {
    expect(dropZonePlates(BANDS, { up: false, hovered: "replace", titleFor: fileTitle })).toEqual(
      []
    );
  });
});

describe("where the plates stand", () => {
  it("stands every plate in from the edges, and halves the padding on a shared edge", () => {
    expect(DROP_EDGE_PADDING).toBe(10);
    expect(dropPlateInsets()).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
    expect(dropPlateInsets("left")).toEqual({ top: 10, bottom: 10, left: 5, right: 10 });
  });

  it("keeps the plates apart while the bands they stand for still meet", () => {
    const layout = new DropBandLayout({ halfHeight: 400 });
    const frames = bandPlateFrames(layout, "right");
    const strip = layout.stripHeight; // 100

    expect(frames.insertAtStart).toEqual({ top: 10, height: strip - 5 - 10, left: 10, right: 5 });
    expect(frames.replace.top).toBe(strip + 5);
    expect(frames.replace.top + frames.replace.height).toBe(400 - strip - 5);
    expect(frames.appendAtEnd.top).toBe(400 - strip + 5);
    expect(frames.appendAtEnd.top + frames.appendAtEnd.height).toBe(400 - 10);
    // The gap between two plates is the padding once.
    expect(frames.replace.top - (frames.insertAtStart.top + frames.insertAtStart.height)).toBe(10);
    // The bands themselves are where they were.
    expect(layout.band(strip - 1)).toBe("insertAtStart");
    expect(layout.band(strip)).toBe("replace");
  });

  it("collapses the middle plate to nothing in a very short box", () => {
    expect(bandPlateFrames(new DropBandLayout({ halfHeight: 90 })).replace.height).toBe(0);
  });
});
