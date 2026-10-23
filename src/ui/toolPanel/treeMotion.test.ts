import { describe, expect, it } from "vitest";
import { planTreeMotion, type Snapshot } from "@/ui/toolPanel/treeMotion";

const key = (row: string) => row;
const ROW = 22;

/** The rows as they stood, the first just under a head of one row. */
const stood = (rows: readonly string[]): Snapshot<string> => ({
  index: new Map(rows.map((row, at) => [row, at])),
  rows: new Map(rows.map((row) => [row, row])),
  origin: 22,
});

describe("a tree's rows in motion", () => {
  it("plays a branch opening: nothing leaves, the rows before are what the others move from", () => {
    const before = stood(["a", "b", "c"]);
    const change = planTreeMotion(before, ["a", "b", "b.1", "b.2", "c"], key, ROW, false);
    expect(change.from).toBe(before);
    expect(change.exiting).toEqual([]);
  });

  it("keeps a branch that shuts on screen where it stood, to fade", () => {
    const change = planTreeMotion(
      stood(["a", "b", "b.1", "b.2", "c"]),
      ["a", "b", "c"],
      key,
      ROW,
      false
    );
    expect(change.exiting).toEqual([
      { row: "b.1", key: "b.1", index: 2, top: 22 + 2 * ROW },
      { row: "b.2", key: "b.2", index: 3, top: 22 + 3 * ROW },
    ]);
  });

  it("lands at once on the first rows, when asked to, and when nothing came or went", () => {
    expect(planTreeMotion(undefined, ["a"], key, ROW, false).from).toBeUndefined();
    expect(planTreeMotion(stood(["a"]), ["a", "b"], key, ROW, true).from).toBeUndefined();
    expect(planTreeMotion(stood(["a", "b"]), ["a", "b"], key, ROW, false).from).toBeUndefined();
  });

  it("lands at once when more rows come or go than motion can follow", () => {
    const many = Array.from({ length: 400 }, (_, at) => `r${at}`);
    expect(planTreeMotion(stood(["a"]), ["a", ...many], key, ROW, false).from).toBeUndefined();
  });

  it("has nothing to fade where no row was on screen to place it by", () => {
    const change = planTreeMotion(
      { ...stood(["a", "b"]), origin: undefined },
      ["a"],
      key,
      ROW,
      false
    );
    expect(change.exiting).toEqual([]);
  });
});
