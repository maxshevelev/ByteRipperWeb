import { describe, expect, it } from "vitest";
import { rowsOf, standingRowKey } from "@/tools/uefi/uefiStructureTool";
import type { WireNode } from "@/workers/protocol";

/**
 * A variable store's rows: the copies a later entry replaced are left out unless
 * asked for, and a hidden copy is shown by the row of the copy that stands for its
 * variable (`UEFIToolViewController.selectAndScroll`).
 */

function node(over: Partial<WireNode> & { id: readonly number[] }): WireNode {
  return {
    kind: "vssEntry",
    name: "",
    header: [0, 0],
    body: [0, 0],
    tail: [0, 0],
    isFixed: false,
    space: [],
    isErased: false,
    isExpandable: false,
    childDepth: 0,
    typeText: "",
    subtypeText: "",
    children: [],
    ...over,
  };
}

/** Five copies of two variables: 0 and 2 replaced by 3, and 1 by 4 — and the store keeps them all. */
const store = node({
  id: [0],
  kind: "vssStore",
  children: [0, 1, 2, 3, 4].map((index) => node({ id: [0, index], name: `Copy${index}` })),
  hiddenCopies: [
    [0, 3],
    [2, 3],
    [1, 4],
  ],
});

describe("a store's superseded copies", () => {
  // The tree lists one row per variable unless superseded entries are asked for.
  it("lists one row per variable unless asked for", () => {
    const open = new Set(["0"]);
    const rowsWithout = rowsOf([store], open, new Set(), false, [], 0, [], { shows: false });
    expect(rowsWithout.map((row) => row.key)).toEqual(["0", "0.3", "0.4"]);

    const rowsWith = rowsOf([store], open, new Set(), false, [], 0, [], { shows: true });
    expect(rowsWith.map((row) => row.key)).toEqual(["0", "0.0", "0.1", "0.2", "0.3", "0.4"]);
  });

  // A copy the tree leaves out is shown by the row of the copy it stands behind.
  it("shows a hidden copy by the row that stands for it", () => {
    expect(standingRowKey([store], "0.0")).toBe("0.3");
    expect(standingRowKey([store], "0.1")).toBe("0.4");
    expect(standingRowKey([store], "0.3")).toBe("0.3");
    expect(standingRowKey([store], "0")).toBe("0");
    expect(standingRowKey([store], "5.1")).toBe("5.1");
  });
});
