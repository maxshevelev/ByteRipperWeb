/**
 * The overview picture, against the macOS app's own cases.
 *
 * `MinimapTests.swift` builds these through a window; the assertions are about
 * the picture, so they port to the pure build directly. Their names are kept
 * close to upstream's so a change there is findable here.
 */

import { describe, expect, test } from "vitest";
import { NO_BASELINE, type ModifiedBaseline } from "@/core/segments/baseline";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { MINIMAP_COLUMNS } from "@/render/minimap/overviewBinning";
import { buildOverviewRows, type OverviewSource } from "@/render/minimap/overviewBuild";

/** The baseline of a document that has a file behind it: the file itself. */
const savedBaseline = (storage: MemoryBackedStorage): ModifiedBaseline => ({
  spans: [{ start: 0, end: storage.size, storage, sourceOffset: 0 }],
  beyondFrom: storage.size,
});

async function picture(bytes: Uint8Array, rowCount: number, extra: Partial<OverviewSource> = {}) {
  const source: OverviewSource = {
    size: bytes.length,
    storage: new MemoryBackedStorage(bytes),
    baseline: NO_BASELINE,
    ...extra,
  };
  const built = await buildOverviewRows(source, bytes.length, rowCount, {
    from: 0,
    to: rowCount,
  });
  if (built === undefined) throw new Error("the picture did not build");
  return built;
}

const inkedColumns = (density: Uint8Array, row: number): number[] => {
  const columns: number[] = [];
  for (let column = 0; column < MINIMAP_COLUMNS; column++) {
    if ((density[row * MINIMAP_COLUMNS + column] ?? 0) > 0) columns.push(column);
  }
  return columns;
};

describe("a file smaller than the panel has rows", () => {
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testATinyFilesOverviewFillsTheRowWidth
  test("a tiny file's overview fills the row width", async () => {
    // 399 bytes over 1560 rows: every row covers a *fraction* of a byte. Sliced
    // per cell that left the whole file as a stripe down the right edge.
    const bytes = Uint8Array.from({ length: 399 }, (_, i) => 0x41 + (i % 26));
    const rowCount = 1560;
    const { density } = await picture(bytes, rowCount);

    const inkPerColumn = new Array(MINIMAP_COLUMNS).fill(0);
    let blankRows = 0;
    for (let row = 0; row < rowCount; row++) {
      const inked = inkedColumns(density, row);
      for (const column of inked) inkPerColumn[column]++;
      if (inked.length === 0) blankRows++;
    }

    expect(blankRows).toBe(0);
    expect(inkPerColumn[0]).toBe(inkPerColumn[MINIMAP_COLUMNS - 1]);
    expect(new Set(inkPerColumn).size).toBe(1);
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testATinyFileKeepsFillAndContentApart
  test("a tiny file keeps fill and content apart", async () => {
    // The stretch must not simply paint everything: the erased half stays pale.
    const bytes = new Uint8Array(399);
    bytes.fill(0xff, 0, 200);
    for (let i = 0; i < 199; i++) bytes[200 + i] = 0x41 + (i % 26);
    const rowCount = 1560;
    const boundary = Math.floor((200 * rowCount) / bytes.length);

    const { density, different } = await picture(bytes, rowCount, {
      differences: () => [{ kind: "different", start: 210, end: 211 }],
    });

    const inked = (row: number) => inkedColumns(density, row).length > 0;
    for (let row = 0; row < boundary - 1; row++) expect(inked(row)).toBe(false);
    for (let row = boundary + 1; row < rowCount; row++) expect(inked(row)).toBe(true);

    // One differing byte marks one row, across the width — at this scale one
    // byte *is* the row.
    const marked = [...different].filter((word) => word !== 0);
    expect(marked).toEqual([0xffff]);
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testARowThinnerThanItsCellsDividesItsWidth
  test("a row thinner than its cells divides its width", async () => {
    // 15 bytes per row, only the first of each significant.
    const rowCount = 20;
    const bytes = new Uint8Array(rowCount * 15);
    for (let row = 0; row < rowCount; row++) bytes[row * 15] = 0x41;
    const { density } = await picture(bytes, rowCount);

    for (let row = 0; row < rowCount; row++) {
      expect(inkedColumns(density, row)).toEqual([0]);
    }
  });
});

describe("a file larger than the panel has rows", () => {
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testOverviewShadesPaddingAndContentDifferently
  test("padding and content shade differently", async () => {
    const half = 128 * 1024;
    const bytes = new Uint8Array(half * 2);
    bytes.fill(0xff, 0, half);
    for (let i = 0; i < half; i++) bytes[half + i] = 0x41 + (i % 26);
    const rowCount = 512;
    const { density } = await picture(bytes, rowCount);

    const rowInk = (row: number) => {
      let total = 0;
      for (let c = 0; c < MINIMAP_COLUMNS; c++) total += density[row * MINIMAP_COLUMNS + c] ?? 0;
      return total;
    };
    expect(rowInk(10)).toBe(0);
    expect(rowInk(rowCount - 10)).toBeGreaterThan(MINIMAP_COLUMNS * 200);
  });

  test("a single changed byte among millions is visible", async () => {
    // The definition of done for M6. 4 MB of erased flash, one byte different.
    const bytes = new Uint8Array(4 * 1024 * 1024).fill(0xff);
    const rowCount = 1000;
    const { different } = await picture(bytes, rowCount, {
      differences: (start, end) =>
        start <= 0x200000 && end > 0x200000
          ? [{ kind: "different", start: 0x200000, end: 0x200001 }]
          : [],
    });

    const marked = [...different].filter((word) => word !== 0);
    expect(marked.length).toBe(1);
    // Not blank, and not the whole row either: one byte of a 4 KB row.
    expect(marked[0]).not.toBe(0);
  });
});

describe("the modified mask", () => {
  test("marks edited bytes against the saved file and nothing else", async () => {
    const saved = new Uint8Array(1024).fill(0x41);
    const now = saved.slice();
    now[600] = 0x42;

    const { modified } = await picture(now, 64, {
      baseline: savedBaseline(new MemoryBackedStorage(saved)),
      edited: [{ start: 600, end: 601 }],
    });

    const rows = [...modified].map((word, row) => (word === 0 ? -1 : row)).filter((r) => r >= 0);
    expect(rows).toEqual([Math.floor((600 * 64) / 1024)]);
  });

  test("a byte retyped to its old value is not modified", async () => {
    // The M4 lesson, in the map: `edited` says the byte came from the edit
    // buffer, which is not the same as differing from the file.
    const saved = new Uint8Array(1024).fill(0x41);
    const now = saved.slice();

    const { modified } = await picture(now, 64, {
      baseline: savedBaseline(new MemoryBackedStorage(saved)),
      edited: [{ start: 600, end: 601 }],
    });

    expect([...modified].every((word) => word === 0)).toBe(true);
  });

  test("an untitled document has nothing to be modified against", async () => {
    const bytes = new Uint8Array(1024).fill(0x41);
    const { modified } = await picture(bytes, 64, {
      baseline: NO_BASELINE,
      edited: [{ start: 0, end: 1024 }],
    });
    expect([...modified].every((word) => word === 0)).toBe(true);
  });
});

test("a cell past this file's end is neither modified nor different", async () => {
  // The extent is the *longer* file, so the shorter map's tail must stay empty
  // rather than reading as one long difference.
  const bytes = new Uint8Array(512).fill(0x41);
  const extent = 1024;
  const built = await buildOverviewRows(
    {
      size: bytes.length,
      storage: new MemoryBackedStorage(bytes),
      baseline: NO_BASELINE,
      differences: () => [{ kind: "different", start: 512, end: 1024 }],
    },
    extent,
    64,
    { from: 0, to: 64 }
  );
  if (built === undefined) throw new Error("the picture did not build");

  // Rows 32 onward are past this file's end.
  for (let row = 32; row < 64; row++) expect(built.different[row]).toBe(0);
});

test("a build can be cancelled", async () => {
  const bytes = new Uint8Array(64 * 1024).fill(0x41);
  await expect(
    buildOverviewRows(
      { size: bytes.length, storage: new MemoryBackedStorage(bytes), baseline: NO_BASELINE },
      bytes.length,
      500,
      { from: 0, to: 500 },
      { shouldCancel: () => true }
    )
  ).rejects.toThrow("cancelled");
});

test("the masks can be rebuilt without re-reading the file for density", async () => {
  // What an edit or a new comparison costs: the density picture is the half
  // that walks the file, and neither of those changes it everywhere.
  let reads = 0;
  const bytes = new Uint8Array(1024).fill(0x41);
  const counting = new MemoryBackedStorage(bytes);
  const storage = {
    size: counting.size,
    read: (at: number, length: number) => {
      reads++;
      return counting.read(at, length);
    },
    peek: (at: number, length: number) => counting.peek(at, length),
    prefetch: () => counting.prefetch(),
  };

  const built = await buildOverviewRows(
    {
      size: bytes.length,
      storage,
      baseline: NO_BASELINE,
      differences: () => [{ kind: "different", start: 0, end: 32 }],
    },
    bytes.length,
    64,
    { from: 0, to: 64 },
    { density: false }
  );
  if (built === undefined) throw new Error("the masks did not build");

  expect(reads).toBe(0);
  expect([...built.density].every((value) => value === 0)).toBe(true);
  expect(built.different[0]).not.toBe(0);
});
