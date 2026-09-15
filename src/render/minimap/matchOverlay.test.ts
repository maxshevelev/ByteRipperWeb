import { describe, expect, it } from "vitest";
import { MatchSet } from "@/core/search/matchSet";
import { EXACT, type SearchPattern } from "@/core/search/searchPattern";
import { currentMatchMarks, matchOverlayMarks } from "@/render/minimap/matchOverlay";

const twoBytes: SearchPattern = { bytes: new Uint8Array([0xde, 0xad]), encoding: "hex" };
const set = (extent: number, starts: number[]) => MatchSet.of(twoBytes, EXACT, extent, starts);
const columns = (...list: number[]) => list.reduce((bits, column) => bits | (1 << column), 0);

describe("the overview's match marks", () => {
  // Sixteen bytes a row, so each overview row is one dump row.
  it("marks the dump columns a match covers, in the row it is in", () => {
    const marks = matchOverlayMarks(set(1600, [35]), 1600, 100);
    expect(marks?.[2]).toBe(columns(3, 4));
    expect(marks?.filter((bits) => bits !== 0)).toHaveLength(1);
  });

  it("marks a match that crosses into the next row in both", () => {
    const marks = matchOverlayMarks(set(1600, [15]), 1600, 100);
    expect(marks?.[0]).toBe(columns(15));
    expect(marks?.[1]).toBe(columns(0));
  });

  it("finds a match past a long run of empty rows", () => {
    const marks = matchOverlayMarks(set(16_000, [5, 15_990]), 16_000, 1000);
    expect(marks?.[0]).toBe(columns(5, 6));
    expect(marks?.[999]).toBe(columns(6, 7));
  });

  it("is the same over a bitmap as over a list", () => {
    const starts = Array.from({ length: 3000 }, (_, i) => i * 37);
    const dense = set(111_000, starts);
    expect(dense.storage.kind).toBe("bitmap");
    const thin = new MatchSet(
      twoBytes,
      EXACT,
      111_000,
      starts.length,
      {
        kind: "sparse",
        starts: Float64Array.from(starts),
      },
      111_000
    );
    expect(matchOverlayMarks(dense, 111_000, 700)).toEqual(matchOverlayMarks(thin, 111_000, 700));
  });

  it("fills a row every column of which holds a match", () => {
    const starts = Array.from({ length: 800 }, (_, i) => i * 2);
    expect(matchOverlayMarks(set(1600, starts), 1600, 1)?.[0]).toBe(0xffff);
  });

  it("has nothing to mark without positions", () => {
    expect(matchOverlayMarks(undefined, 1600, 100)).toBeUndefined();
  });
});

describe("the current match's marks", () => {
  it("mark only its own range", () => {
    const marks = currentMatchMarks({ start: 17, end: 19 }, 1600, 100);
    expect(marks?.[1]).toBe(columns(1, 2));
    expect(currentMatchMarks(undefined, 1600, 100)).toBeUndefined();
  });
});
