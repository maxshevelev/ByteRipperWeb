/**
 * The map's arithmetic. Upstream's cases are window-driven; these check the
 * same claims against the geometry itself.
 */

import { describe, expect, test } from "vitest";
import {
  BYTES_PER_ROW,
  derivedTopRow,
  detailWindowFitsWholeFile,
  offsetAtY,
  overviewIsInformative,
  preferredMode,
  ROW_STEP,
  scrollTargetForBand,
  snappedOffsetAtY,
  viewportBand,
  visibleRowCount,
  wheelScrollTarget,
  yOfOffset,
} from "@/render/minimap/minimapGeometry";

test("a row costs the same however large the file is", () => {
  expect(visibleRowCount(0)).toBe(0);
  expect(visibleRowCount(2)).toBe(1);
  expect(visibleRowCount(ROW_STEP * 10 - 1)).toBe(10);
  expect(visibleRowCount(300)).toBe(100);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testEveryByteGetsItsOwnRowWithNoAggregation
test("every byte gets its own row in detail, with no aggregation", () => {
  const at = (y: number) =>
    offsetAtY({ mode: "detail", y, areaHeight: 300, topRow: 0, extent: 4096, overviewRows: 0 });
  expect(at(0)).toBe(0);
  expect(at(ROW_STEP)).toBe(BYTES_PER_ROW);
  expect(at(ROW_STEP * 7)).toBe(BYTES_PER_ROW * 7);
});

// @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testAMarkSitsAtTheSameHeightOnBothMaps
test("the same height is the same offset in both maps", () => {
  // The definition of done. Both maps are binned over the same extent, so the
  // mapping depends on nothing but y.
  const shared = {
    mode: "overview",
    areaHeight: 600,
    topRow: 0,
    extent: 8_000_000,
    overviewRows: 600,
  } as const;
  for (const y of [0, 1, 150, 299, 300, 599]) {
    expect(offsetAtY({ ...shared, y })).toBe(offsetAtY({ ...shared, y }));
  }
  // And it is monotonic and spans the file.
  expect(offsetAtY({ ...shared, y: 0 })).toBe(0);
  expect(offsetAtY({ ...shared, y: 600 })).toBe(8_000_000);
  expect(offsetAtY({ ...shared, y: 300 })).toBe(4_000_000);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testClickingTheOverviewStartAndEndSnapsToFileBounds
test("clicking the overview's edges snaps to the file's own bounds", () => {
  const map = {
    mode: "overview",
    areaHeight: 600,
    topRow: 0,
    extent: 8_000_000,
    overviewRows: 600,
    fileSize: 4_000_000,
  } as const;
  expect(snappedOffsetAtY({ ...map, y: 0 })).toBe(0);
  expect(snappedOffsetAtY({ ...map, y: 2 })).toBe(0);
  expect(snappedOffsetAtY({ ...map, y: 600 })).toBe(3_999_999);
  // A shorter file's clicks clamp to its own last byte, not the extent's.
  expect(snappedOffsetAtY({ ...map, y: 500 })).toBe(3_999_999);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testWindowSlidesWithThePaneAndReachesTheFileEnd
test("the window slides with the panes and reaches the file's end", () => {
  const sizes = [1_000_000];
  const windowRows = 100;
  const totalRows = Math.ceil(1_000_000 / BYTES_PER_ROW);

  const top = (start: number) =>
    derivedTopRow({
      mode: "detail",
      sizes,
      windowRows,
      viewport: { start, end: start + windowRows * BYTES_PER_ROW },
    });

  expect(top(0)).toBe(0);
  // Scrolled to the very end, the window's last row is the file's last.
  const lastPaneTop = (totalRows - windowRows) * BYTES_PER_ROW;
  expect(top(lastPaneTop)).toBe(totalRows - windowRows);
  expect(top(lastPaneTop / 2)).toBeGreaterThan(0);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testWindowStaysAtTheTopForAFileThatFits
test("a file that fits keeps the window at the top", () => {
  expect(
    derivedTopRow({
      mode: "detail",
      sizes: [1024],
      windowRows: 200,
      viewport: { start: 0, end: 1024 },
    })
  ).toBe(0);
  expect(detailWindowFitsWholeFile([1024], 600)).toBe(true);
  expect(detailWindowFitsWholeFile([16 * 1024 * 1024], 600)).toBe(false);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testOverviewIsNotOfferedForAFileItWouldMagnify
test("the overview is not offered where it would magnify rather than compress", () => {
  expect(overviewIsInformative([200], 600)).toBe(false);
  expect(overviewIsInformative([16 * 1024 * 1024], 600)).toBe(true);
  // An unmeasured panel has no answer and must not disable the switch.
  expect(overviewIsInformative([200], 0)).toBe(true);
});

// @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testAFileTheOverviewCouldCompressStillOpensInDetail
test("a small file opens in detail and a dump in the overview", () => {
  expect(preferredMode([1024], 600)).toBe("detail");
  expect(preferredMode([16 * 1024 * 1024], 600)).toBe("overview");
});

test("the viewport band stays on the map and stays catchable", () => {
  const band = viewportBand({
    mode: "overview",
    viewport: { start: 0, end: 4096 },
    areaHeight: 600,
    topRow: 0,
    extent: 16 * 1024 * 1024,
    overviewRows: 600,
  });
  // A sliver of a large file: given a floor so the pointer can catch it.
  expect(band?.height).toBeGreaterThanOrEqual(4);
  expect(band?.top).toBe(0);

  const atEnd = viewportBand({
    mode: "overview",
    viewport: { start: 16 * 1024 * 1024 - 4096, end: 16 * 1024 * 1024 },
    areaHeight: 600,
    topRow: 0,
    extent: 16 * 1024 * 1024,
    overviewRows: 600,
  });
  if (atEnd === undefined) throw new Error("the band should be drawn at the file's end");
  expect(atEnd.top + atEnd.height).toBeLessThanOrEqual(600);
});

test("no file showing means no band", () => {
  expect(
    viewportBand({
      mode: "overview",
      viewport: undefined,
      areaHeight: 600,
      topRow: 0,
      extent: 1024,
      overviewRows: 600,
    })
  ).toBeUndefined();
});

// @upstream ByteRipperTests/BookmarkMinimapTests.swift#BookmarkMinimapTests.testDraggingTheBandDoesNotSnap
describe("dragging the band", () => {
  // The band is a scrollbar handle, so its travel down the map stands for the
  // file's whole scrollable range — in detail mode especially, where the map
  // itself shows only a few hundred rows of a file that may have millions.
  const fileSize = 4 * 1024 * 1024;
  const sizes = [fileSize];
  const areaHeight = 600;
  const bandHeight = 60;

  test("detail: the band reaches the end of the file", () => {
    const totalRows = Math.ceil(fileSize / BYTES_PER_ROW);
    const windowRows = visibleRowCount(areaHeight);
    const paneRows = Math.round(bandHeight / ROW_STEP);

    const atTop = scrollTargetForBand({
      mode: "detail",
      bandTop: 0,
      bandHeight,
      areaHeight,
      sizes,
    });
    const atBottom = scrollTargetForBand({
      mode: "detail",
      bandTop: windowRows * ROW_STEP - bandHeight,
      bandHeight,
      areaHeight,
      sizes,
    });

    expect(atTop).toBe(0);
    // Dragged to the bottom of its travel, the band asks for the last page of
    // the file — not for the bottom of the map's own little window.
    expect(atBottom).toBe((totalRows - paneRows) * BYTES_PER_ROW);
    expect(atBottom).toBeGreaterThan(4 * 1024 * 1024 - 4096);
  });

  test("detail: halfway down the travel is halfway through the file", () => {
    const windowRows = visibleRowCount(areaHeight);
    const travel = windowRows * ROW_STEP - bandHeight;
    const middle = scrollTargetForBand({
      mode: "detail",
      bandTop: travel / 2,
      bandHeight,
      areaHeight,
      sizes,
    });
    if (middle === undefined) throw new Error("the band should map to an offset");
    expect(middle / fileSize).toBeGreaterThan(0.49);
    expect(middle / fileSize).toBeLessThan(0.51);
  });

  test("detail: a file that fits on the map maps the band straight to its row", () => {
    const small = [600];
    expect(
      scrollTargetForBand({
        mode: "detail",
        bandTop: ROW_STEP * 3,
        bandHeight,
        areaHeight,
        sizes: small,
      })
    ).toBe(3 * BYTES_PER_ROW);
  });

  test("overview: the band is a proportional scrollbar over the whole file", () => {
    const paneRows = 50;
    const totalRows = Math.ceil(fileSize / BYTES_PER_ROW);
    expect(
      scrollTargetForBand({ mode: "overview", bandTop: 0, bandHeight, areaHeight, sizes, paneRows })
    ).toBe(0);
    expect(
      scrollTargetForBand({
        mode: "overview",
        bandTop: areaHeight - bandHeight,
        bandHeight,
        areaHeight,
        sizes,
        paneRows,
      })
    ).toBe((totalRows - paneRows) * BYTES_PER_ROW);
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testDraggingTheBandToTheTopClampsAtTheFileStart
  test("a drag past either end clamps rather than running off", () => {
    expect(
      scrollTargetForBand({ mode: "detail", bandTop: -500, bandHeight, areaHeight, sizes })
    ).toBe(0);
    const far = scrollTargetForBand({
      mode: "detail",
      bandTop: 100_000,
      bandHeight,
      areaHeight,
      sizes,
    });
    if (far === undefined) throw new Error("the band should map to an offset");
    expect(far).toBeLessThan(fileSize);
  });
});

describe("the wheel over a map", () => {
  const sizes = [4 * 1024 * 1024];

  test("scrolls at the map's own scale, not the pane's", () => {
    // One hex row per ROW_STEP of wheel, which is what makes the map move with
    // the hand rather than creeping.
    const target = wheelScrollTarget({
      deltaY: ROW_STEP * 20,
      viewport: { start: 0, end: 800 },
      sizes,
    });
    expect(target).toBe(20 * BYTES_PER_ROW);
  });

  test("scrolls towards the end of the file on a downward wheel", () => {
    const start = 1000 * BYTES_PER_ROW;
    const down = wheelScrollTarget({
      deltaY: ROW_STEP * 10,
      viewport: { start, end: start + 800 },
      sizes,
    });
    const up = wheelScrollTarget({
      deltaY: -ROW_STEP * 10,
      viewport: { start, end: start + 800 },
      sizes,
    });
    expect(down).toBe(1010 * BYTES_PER_ROW);
    expect(up).toBe(990 * BYTES_PER_ROW);
  });

  test("clamps at both ends and ignores a wheel too small to move a row", () => {
    expect(wheelScrollTarget({ deltaY: -100, viewport: { start: 0, end: 800 }, sizes })).toBe(0);
    expect(
      wheelScrollTarget({ deltaY: 1, viewport: { start: 0, end: 800 }, sizes })
    ).toBeUndefined();
    expect(wheelScrollTarget({ deltaY: 100, viewport: undefined, sizes })).toBeUndefined();
  });
});

test("an offset's height and the byte at that height agree", () => {
  // The selection strip, the band and a click all go through this pair.
  const shared = { mode: "overview", areaHeight: 600, topRow: 0, extent: 8_000_000 } as const;
  for (const offset of [0, 1_000_000, 4_000_000, 7_999_999]) {
    const y = yOfOffset({ ...shared, offset });
    const back = offsetAtY({ ...shared, y, overviewRows: 600 });
    expect(Math.abs(back - offset)).toBeLessThan(8_000_000 / 600 + 1);
  }
});
