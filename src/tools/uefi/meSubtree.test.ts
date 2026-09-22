import { describe, expect, it } from "vitest";
import type { MEANode } from "@/tools/meaTree";
import {
  isMeRegion,
  meDetail,
  meDetailTitle,
  meKey,
  meNodeAt,
  mePathCovering,
  mePathOf,
  meRegionPath,
} from "@/tools/uefi/meSubtree";
import { rowsOf } from "@/tools/uefi/uefiStructureTool";
import type { WireNode } from "@/workers/protocol";

/**
 * The ME region inside the UEFI Structure tree: which node is the graft point,
 * what the sub-tree's rows are called in an outline that is now two kinds of
 * row, and what an ME row's detail and reveal say.
 *
 * @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests
 */

/** A node of the UEFI tree, with only what these cases read filled in. */
function node(over: Partial<WireNode> & { id: readonly number[] }): WireNode {
  return {
    kind: "region",
    name: "",
    header: [0, 0],
    body: [0, 0],
    tail: [0, 0],
    isFixed: false,
    space: [],
    isErased: false,
    isExpandable: false,
    childDepth: 0,
    typeText: "Region",
    subtypeText: "",
    children: [],
    ...over,
  };
}

/** A row of the presented ME sub-tree, with only what these cases read. */
function meNode(over: Partial<MEANode> & { path: readonly number[]; title: string }): MEANode {
  return {
    subtitle: "",
    range: undefined,
    fields: [],
    children: [],
    isEmptySection: false,
    marks: undefined,
    ...over,
  };
}

const ME_REGION = node({
  id: [1],
  kind: "region",
  subtype: 0x02,
  name: "ME region",
  body: [0x1000, 0x600000],
  typeText: "Region",
  subtypeText: "ME",
});

const DESCRIPTOR = node({ id: [0], kind: "region", subtype: 0x00, name: "Descriptor region" });

describe("the graft point", () => {
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.isMERegion
  it("is the region the descriptor names ME, and no other", () => {
    expect(isMeRegion(ME_REGION)).toBe(true);
    expect(isMeRegion(DESCRIPTOR)).toBe(false);
    expect(isMeRegion(node({ id: [2], kind: "volume", subtype: 0x02 }))).toBe(false);
  });

  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meRegionID
  it("is found wherever it sits, and is nothing in an image without one", () => {
    const image = node({ id: [], kind: "image", children: [DESCRIPTOR, ME_REGION] });
    expect(meRegionPath([image])).toEqual([1]);
    expect(meRegionPath([DESCRIPTOR])).toBeUndefined();
  });
});

describe("an ME row's key", () => {
  it("cannot be mistaken for a node of the UEFI tree", () => {
    // A one-level ME path and a UEFI root would both read as "0".
    expect(meKey([0])).not.toBe("0");
    expect(mePathOf(meKey([2, 1, 4]))).toEqual([2, 1, 4]);
    expect(mePathOf("1.2")).toBeUndefined();
  });
});

describe("the rows the outline draws", () => {
  // The region as the only child of the image, so its own path is [0].
  const region = node({ ...ME_REGION, id: [0] });
  const tree = [node({ id: [], kind: "image", name: "Intel image", children: [region] })];
  const meRoots = [
    meNode({
      path: [0],
      title: "Firmware",
      children: [meNode({ path: [0, 0], title: "Version", subtitle: "15.0" })],
    }),
    meNode({ path: [1], title: "Regions", subtitle: "17 regions" }),
  ];

  it("leaves the ME region shut until its sub-tree is there", () => {
    const open = new Set(["", "0"]);
    const rows = rowsOf(tree, open, new Set(), false, [], 0);

    expect(rows.map((row) => row.key)).toEqual(["", "0"]);
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testTheMERegionExpandsToTheMESubTree
  it("opens the ME region onto the sub-tree, and never onto children of its own", () => {
    const open = new Set(["", "0", meKey([0])]);
    const rows = rowsOf(tree, open, new Set(), false, meRoots, 0);

    expect(rows.map((row) => `${row.key}@${row.depth}`)).toEqual([
      "@0",
      "0@1",
      "me/0@2",
      "me/0/0@3",
      "me/1@2",
    ]);
    // And the rows under it are the ME half: the panel draws them, selects them
    // and details them as ME rows rather than as nodes of the tree.
    expect(rows.filter((row) => row.me !== undefined).map((row) => row.me?.title)).toEqual([
      "Firmware",
      "Version",
      "Regions",
    ]);
    expect(rows.filter((row) => row.node !== undefined)).toHaveLength(2);
  });

  it("shows the region's Loading… row while the analysis runs", () => {
    const open = new Set(["", "0"]);
    const rows = rowsOf(tree, open, new Set(["0"]), false, [], 0);

    expect(rows.map((row) => row.key)).toEqual(["", "0", "0#loading"]);
  });
});

describe("what an ME row says when it is picked", () => {
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meDetailTitle
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testTheDetailCarriesAGroupsCount
  it("names itself by its title, and by its subtitle when it has nothing else", () => {
    const group = meNode({ path: [1], title: "Regions", subtitle: "17 regions" });
    expect(meDetailTitle(group)).toBe("Regions · 17 regions");

    const row = meNode({
      path: [1, 0],
      title: "Region 0",
      subtitle: "0x1000 · 0x2000",
      fields: [{ label: "Offset", value: "0x1000" }],
    });
    expect(meDetailTitle(row)).toBe("Region 0");
  });

  it("carries its curated fields into the detail, tick and all", () => {
    const row = meNode({
      path: [0],
      title: "Firmware",
      fields: [
        { label: "Family", value: "CSME" },
        { label: "Unmatched Hashes", value: "None", tone: "good" },
      ],
    });

    expect(meDetail(row)).toEqual({
      title: "Firmware",
      fields: [
        { label: "Family", value: "CSME", tone: "standard" },
        { label: "Unmatched Hashes", value: "None", tone: "good" },
      ],
      tables: [],
    });
  });
});

describe("the row that owns a byte of the ME region", () => {
  const roots = [
    meNode({
      path: [0],
      title: "Regions",
      children: [
        meNode({ path: [0, 0], title: "FTPR", range: { start: 0x2000, end: 0x3000 } }),
        meNode({ path: [0, 1], title: "NFTP", range: { start: 0x3000, end: 0x4000 } }),
      ],
    }),
  ];

  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.mePath
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testRevealingACaretInsideTheMERegionPicksTheSubTreesRow
  it("is the innermost row whose range covers it", () => {
    expect(mePathCovering(roots, 0x3100)).toEqual([0, 1]);
    expect(mePathCovering(roots, 0x2000)).toEqual([0, 0]);
    // A group stands for no bytes of its own, so it is descended through.
    expect(mePathCovering(roots, 0x9000)).toBeUndefined();
  });

  it("is found again from the key the panel kept", () => {
    expect(meNodeAt(roots, meKey([0, 1]))?.title).toBe("NFTP");
    expect(meNodeAt(roots, meKey([0, 9]))).toBeUndefined();
    expect(meNodeAt(roots, "0.1")).toBeUndefined();
  });
});
