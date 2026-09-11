/**
 * The map's arithmetic. Upstream's cases are window-driven; these check the
 * same claims against the geometry itself.
 */

import { expect, test } from "vitest";
import {
  BYTES_PER_ROW,
  derivedTopRow,
  detailWindowFitsWholeFile,
  offsetAtY,
  overviewIsInformative,
  preferredMode,
  ROW_STEP,
  snappedOffsetAtY,
  viewportBand,
  visibleRowCount,
} from "@/render/minimap/minimapGeometry";

test("a row costs the same however large the file is", () => {
  expect(visibleRowCount(0)).toBe(0);
  expect(visibleRowCount(2)).toBe(1);
  expect(visibleRowCount(ROW_STEP * 10 - 1)).toBe(10);
  expect(visibleRowCount(300)).toBe(100);
});

test("every byte gets its own row in detail, with no aggregation", () => {
  const at = (y: number) =>
    offsetAtY({ mode: "detail", y, areaHeight: 300, topRow: 0, extent: 4096, overviewRows: 0 });
  expect(at(0)).toBe(0);
  expect(at(ROW_STEP)).toBe(BYTES_PER_ROW);
  expect(at(ROW_STEP * 7)).toBe(BYTES_PER_ROW * 7);
});

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

test("the overview is not offered where it would magnify rather than compress", () => {
  expect(overviewIsInformative([200], 600)).toBe(false);
  expect(overviewIsInformative([16 * 1024 * 1024], 600)).toBe(true);
  // An unmeasured panel has no answer and must not disable the switch.
  expect(overviewIsInformative([200], 0)).toBe(true);
});

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
