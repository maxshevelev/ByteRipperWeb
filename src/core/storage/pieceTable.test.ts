import { describe, expect, it } from "vitest";
import { type PieceSegment, PieceTable } from "@/core/storage/pieceTable";

/**
 * Ported from `PieceTableTests.swift`.
 *
 * The piece table's arithmetic: which source segments cover a window after a
 * sequence of edits, and how many pieces that takes. Bytes and files are
 * `EditOverlayStorage`'s business; here the sources are named, not read.
 */

/**
 * A readable rendering of a window: `b` for base bytes, `a` for added bytes,
 * each followed by its source offsets — so a test states the whole expected
 * layout in one line.
 */
function layout(table: PieceTable, start = 0, end = table.size): string {
  return table
    .segments(start, end)
    .map((segment) => `${segment.source === "base" ? "b" : "a"}${segment.start}-${segment.end}`)
    .join(" ");
}

const ranges = (table: PieceTable) =>
  table.addedRanges.map((range) => `${range.start}-${range.end}`);

describe("a fresh table", () => {
  it("is one piece of base", () => {
    const table = new PieceTable(100);
    expect(table.size).toBe(100);
    expect(table.pieceCount).toBe(1);
    expect(layout(table)).toBe("b0-100");
    expect(table.addedRanges).toEqual([]);
  });

  it("has no pieces over an empty base", () => {
    const table = new PieceTable(0);
    expect(table.size).toBe(0);
    expect(table.pieceCount).toBe(0);
    expect(layout(table)).toBe("");
    expect(table.segments(0, 10)).toEqual([]);
  });
});

interface Case {
  name: string;
  baseSize: number;
  edit: (table: PieceTable) => void;
  layout: string;
  size: number;
  pieceCount?: number;
  addedRanges?: string[];
}

function check(cases: Case[]): void {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const table = new PieceTable(testCase.baseSize);
      testCase.edit(table);
      expect(layout(table)).toBe(testCase.layout);
      expect(table.size).toBe(testCase.size);
      if (testCase.pieceCount !== undefined) expect(table.pieceCount).toBe(testCase.pieceCount);
      if (testCase.addedRanges !== undefined) expect(ranges(table)).toEqual(testCase.addedRanges);
    });
  }
}

describe("insert", () => {
  check([
    {
      name: "in the middle splits one piece into three",
      baseSize: 100,
      edit: (t) => t.insert(40, 0, 2),
      layout: "b0-40 a0-2 b40-100",
      size: 102,
      pieceCount: 3,
      addedRanges: ["40-42"],
    },
    {
      name: "at the start",
      baseSize: 10,
      edit: (t) => t.insert(0, 0, 1),
      layout: "a0-1 b0-10",
      size: 11,
      addedRanges: ["0-1"],
    },
    {
      name: "at the start, then at the end",
      baseSize: 10,
      edit: (t) => {
        t.insert(0, 0, 1);
        t.insert(t.size, 1, 2);
      },
      layout: "a0-1 b0-10 a1-2",
      size: 12,
      addedRanges: ["0-1", "11-12"],
    },
    {
      // An offset past the end inserts at the end rather than leaving a hole.
      name: "past the end lands at the end",
      baseSize: 10,
      edit: (t) => t.insert(999, 0, 3),
      layout: "b0-10 a0-3",
      size: 13,
    },
  ]);

  it("keeps a typed run to one piece", () => {
    // A typed run must not cost one piece per keystroke: successive inserts of
    // consecutive added bytes at the growing offset extend one piece.
    const table = new PieceTable(1_000_000);
    for (let i = 0; i < 500; i++) table.insert(100 + i, i, i + 1);

    expect(table.size).toBe(1_000_500);
    expect(table.pieceCount).toBe(3); // base head, the whole typed run, base tail
    expect(layout(table)).toBe("b0-100 a0-500 b100-1000000");
    expect(ranges(table)).toEqual(["100-600"]);
  });

  it("starts a new piece when the run is broken by a jump", () => {
    const table = new PieceTable(100);
    table.insert(10, 0, 1);
    table.insert(11, 1, 2); // continues the run
    expect(table.pieceCount).toBe(3);

    table.insert(50, 2, 3); // elsewhere
    expect(table.pieceCount).toBe(5);
    expect(layout(table)).toBe("b0-10 a0-2 b10-48 a2-3 b48-100");
  });
});

describe("delete on a plain base", () => {
  check([
    {
      name: "inside one piece",
      baseSize: 100,
      edit: (t) => t.delete(20, 30),
      layout: "b0-20 b30-100",
      size: 90,
    },
    {
      name: "everything leaves no pieces",
      baseSize: 100,
      edit: (t) => t.delete(0, 100),
      layout: "",
      size: 0,
      pieceCount: 0,
    },
    {
      name: "an end past EOF is clamped",
      baseSize: 10,
      edit: (t) => t.delete(8, 999),
      layout: "b0-8",
      size: 8,
    },
    {
      name: "an empty range does nothing",
      baseSize: 10,
      edit: (t) => t.delete(4, 4),
      layout: "b0-10",
      size: 10,
    },
    {
      name: "a range entirely past EOF does nothing",
      baseSize: 10,
      edit: (t) => t.delete(20, 30),
      layout: "b0-10",
      size: 10,
    },
  ]);

  it("spans several pieces", () => {
    const table = new PieceTable(100);
    table.insert(50, 0, 10); // b0-50 a0-10 b50-100
    table.delete(45, 65); // through the added piece

    expect(table.size).toBe(90);
    expect(layout(table)).toBe("b0-45 b55-100");
    expect(table.addedRanges).toEqual([]); // the added piece was consumed whole
  });

  it("trims partial pieces at both ends", () => {
    const table = new PieceTable(100);
    table.insert(50, 0, 10); // b0-50 a0-10 b50-100
    table.delete(55, 58); // inside the added piece

    expect(layout(table)).toBe("b0-50 a0-5 a8-10 b50-100");
    expect(ranges(table)).toEqual(["50-57"]); // adjacent added ranges merge
  });
});

describe("replace, which is an overwrite", () => {
  it("keeps the size when the lengths match", () => {
    const table = new PieceTable(100);
    table.replace(10, 12, 0, 2);

    expect(table.size).toBe(100);
    expect(layout(table)).toBe("b0-10 a0-2 b12-100");
    expect(ranges(table)).toEqual(["10-12"]);
  });

  it("grows the table when it runs past the end", () => {
    const table = new PieceTable(10);
    table.replace(8, 12, 0, 4);

    expect(table.size).toBe(12);
    expect(layout(table)).toBe("b0-8 a0-4");
  });

  it("does not pile up pieces when the same byte is overwritten repeatedly", () => {
    const table = new PieceTable(100);
    table.replace(10, 11, 0, 1);
    table.replace(10, 11, 1, 2);
    table.replace(10, 11, 2, 3);

    expect(table.size).toBe(100);
    expect(table.pieceCount).toBe(3);
    // The base byte at 10 stays replaced, the tail resumes at 11.
    expect(layout(table)).toBe("b0-10 a2-3 b11-100");
  });
});

describe("windows", () => {
  it("covers only what was asked for", () => {
    const table = new PieceTable(100);
    table.insert(50, 0, 10); // b0-50 a0-10 b50-100

    expect(layout(table, 48, 53)).toBe("b48-50 a0-3");
    expect(layout(table, 55, 62)).toBe("a5-10 b50-52");
    expect(layout(table, 0, 1)).toBe("b0-1");
    expect(layout(table, 109, 120)).toBe("b99-100"); // clamped to the end
    expect(table.segments(110, 120)).toEqual([]); // entirely past the end
    expect(table.segments(10, 10)).toEqual([]);
  });

  it("reads the same byte by byte as it does in one window", () => {
    const table = new PieceTable(40);
    table.insert(10, 0, 5);
    table.delete(2, 8);
    table.replace(20, 25, 5, 10);
    table.insert(table.size, 10, 12);
    table.delete(0, 1);

    const flatten = (segments: PieceSegment[]) =>
      segments.flatMap((segment) =>
        Array.from({ length: segment.end - segment.start }, (_, i) => [
          segment.source,
          segment.start + i,
        ])
      );

    const whole = flatten(table.segments(0, table.size));
    const byteWise = flatten(
      Array.from({ length: table.size }, (_, offset) => table.segments(offset, offset + 1)).flat()
    );

    expect(whole.length).toBe(table.size);
    expect(whole).toEqual(byteWise);
  });
});
