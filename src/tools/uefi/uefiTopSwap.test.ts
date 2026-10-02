import { describe, expect, it } from "vitest";
import { termId } from "@/core/help/helpIds";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import type { ProtectedRanges } from "@/firmware/uefi/protectedRanges";
import type { TopSwapCopy } from "@/firmware/uefi/topSwap";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeNode, type NodeID, type UEFINode } from "@/firmware/uefi/uefiNode";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import {
  counterpartMenuTitle,
  topSwapName,
  uefiTopSwapCounterpart,
  uefiTopSwapRole,
  uefiTopSwapTwin,
  wireTopSwapRole,
} from "@/tools/uefi/uefiTopSwap";
import { nodeName } from "@/tools/uefi/uefiTreeDisplay";
import type { WireNode } from "@/workers/protocol";

/**
 * Ported from `UEFITopSwapTests.swift`: what the panel says about a Top Swap copy —
 * the copy's outermost rows say they are one, both blocks' outermost rows say
 * where the other copy is, and the copy's `?` opens the page about Top Swap.
 */

const r = (start: number, end: number) => ({ start, end });
const COPY: TopSwapCopy = { top: r(0x1_0000, 0x2_0000), backup: r(0, 0x1_0000) };

/** A region of two blocks, each a volume holding one file. */
function image(match = true, withRanges = true): UEFIImage {
  const volume = (base: number) =>
    makeNode({
      kind: "volume",
      name: "Volume",
      header: r(base, base + 0x48),
      body: r(base + 0x48, base + 0x1_0000),
      children: [
        makeNode({
          kind: "file",
          subtype: 0x07,
          name: "Driver",
          header: r(base + 0x48, base + 0x60),
          body: r(base + 0x60, base + 0x100),
        }),
      ],
    });
  const region = makeNode({
    kind: "region",
    subtype: 1,
    name: "BIOS region",
    header: r(0, 0),
    body: r(0, 0x2_0000),
    children: [volume(0), volume(0x1_0000)],
  });
  const ranges: ProtectedRanges = {
    ranges: [],
    obbDigests: [],
    diagnostics: [],
    topSwap: COPY,
    topSwapCopiesMatch: match,
  };
  return new UEFIImage({
    size: 0x2_0000,
    roots: [region],
    ...(withRanges ? { protectedRanges: ranges } : {}),
  });
}

const nodeAt = (img: UEFIImage, path: NodeID) => img.node(path) as UEFINode;
const catalogue = GuidsCatalogue.empty;

describe("a Top Swap copy", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testTheCopysOutermostRowsSayTheyAreOne
  it("says in the outermost rows of the copy that they are one", () => {
    const img = image();
    expect(uefiTopSwapRole(nodeAt(img, [0, 0]), img)).toEqual({ kind: "copy", of: COPY.top });
    expect(uefiTopSwapRole(nodeAt(img, [0, 1]), img)).toEqual({
      kind: "original",
      copiedAt: COPY.backup,
    });
    // Inside them, and around them, nothing changes.
    expect(uefiTopSwapRole(nodeAt(img, [0, 0, 0]), img)).toBeUndefined();
    expect(uefiTopSwapRole(nodeAt(img, [0]), img)).toBeUndefined();

    const copy = nodeAt(img, [0, 0]);
    const original = nodeAt(img, [0, 1]);
    expect(nodeName({ ...copy, topSwap: uefiTopSwapRole(copy, img)?.kind }, catalogue)).toBe(
      "Volume (Top Swap copy)"
    );
    expect(
      nodeName({ ...original, topSwap: uefiTopSwapRole(original, img)?.kind }, catalogue)
    ).toBe("Volume");
    expect(topSwapName("Volume", "copy")).toBe("Volume (Top Swap copy)");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testTheDetailsSayWhereTheOtherCopyIsAndWhetherTheyAgree
  it("says in the details where the other copy is and whether they agree", () => {
    const reader = new ImageReader(sourceOver(new Uint8Array(0x2_0000)));
    const topSwap = (path: NodeID, img: UEFIImage) =>
      buildNodeDetail(nodeAt(img, path), img, reader, []).fields.find(
        (one) => one.label === "Top Swap"
      )?.value;
    const img = image();
    expect(topSwap([0, 0], img)).toBe("Copy of 0x10000–0x20000; the copies match");
    expect(topSwap([0, 1], img)).toBe("Copied at 0x0–0x10000; the copies match");
    expect(topSwap([0, 0, 0], img)).toBeUndefined();
    expect(topSwap([0, 0], image(false))).toBe("Copy of 0x10000–0x20000; the copies differ");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testTheCopysHelpIsTheTopSwapPage
  it("opens the Top Swap page from the copy's ?", () => {
    const img = image();
    const help = (path: NodeID) => {
      const node = nodeAt(img, path);
      return uefiHelpTerm({ ...node, topSwap: uefiTopSwapRole(node, img)?.kind });
    };
    expect(help([0, 0])).toBe(termId("top-swap"));
    expect(help([0, 1])).toBe(termId("volume"));
  });

  // Any node of either block has a twin one block away, of the same kind: down
  // into the copy from the top block, up out of it.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testEveryNodeInEitherBlockHasATwin
  it("gives every node in either block a twin", () => {
    const img = image();
    const file = uefiTopSwapCounterpart(nodeAt(img, [0, 1, 0]), img);
    expect(file?.range).toEqual(r(0x48, 0x100));
    expect(file?.kind).toBe("file");
    expect(file?.isInCopy).toBe(true);
    expect(file === undefined ? "" : counterpartMenuTitle(file)).toBe("Go to Top Swap Copy");

    const volume = uefiTopSwapCounterpart(nodeAt(img, [0, 0]), img);
    expect(volume?.range).toEqual(r(0x1_0000, 0x2_0000));
    expect(volume?.isInCopy).toBe(false);
    expect(volume === undefined ? "" : counterpartMenuTitle(volume)).toBe("Go to Original");

    // The region holds both blocks and is in neither.
    expect(uefiTopSwapCounterpart(nodeAt(img, [0]), img)).toBeUndefined();
  });

  // The twin is the node of that range and kind among those covering its first
  // byte; where the copies drifted apart, the innermost node that still holds
  // the range.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testTheTwinIsFoundAmongTheNodesCoveringIt
  it("finds the twin among the nodes covering it", () => {
    const img = image();
    const counterpart = uefiTopSwapCounterpart(nodeAt(img, [0, 1, 0]), img);
    expect(counterpart).toBeDefined();
    if (counterpart === undefined) return;
    const chain = img.nodesContaining(counterpart.range.start);
    expect(uefiTopSwapTwin(counterpart, chain)?.id).toEqual([0, 0, 0]);

    const drifted = { ...counterpart, kind: "section" };
    // No section there: the file holding the range is as near as it gets.
    expect(uefiTopSwapTwin(drifted, chain)?.id).toEqual([0, 0, 0]);
  });

  // Without the ranges read there is no copy to speak of.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITopSwapTests.swift#UEFITopSwapTests.testWithoutTheRangesReadNothingIsSaid
  it("says nothing without the ranges read", () => {
    const bare = image(true, false);
    expect(uefiTopSwapRole(nodeAt(bare, [0, 0]), bare)).toBeUndefined();
    expect(uefiTopSwapCounterpart(nodeAt(bare, [0, 0]), bare)).toBeUndefined();
  });
});

/** The panel holds wire nodes: the same answer over the tree it was sent. */
describe("a Top Swap copy, as the panel holds the tree", () => {
  const wire = (node: UEFINode): WireNode => ({
    id: node.id,
    kind: node.kind,
    subtype: node.subtype,
    name: node.name,
    guid: undefined,
    header: [node.header.start, node.header.end],
    body: [node.body.start, node.body.end],
    tail: [node.tail.start, node.tail.end],
    isFixed: node.isFixed,
    space: [],
    compression: undefined,
    isErased: node.isErased,
    isExpandable: false,
    childDepth: 0,
    typeText: "",
    subtypeText: "",
    children: node.children.map(wire),
  });

  it("finds the same roles over wire nodes", () => {
    const img = image();
    const roots = img.roots.map(wire);
    const at = (path: number[]) => {
      let nodes: readonly WireNode[] = roots;
      let found: WireNode | undefined;
      for (const index of path) {
        found = nodes[index];
        nodes = found?.children ?? [];
      }
      return found as WireNode;
    };
    expect(wireTopSwapRole(at([0, 0]), COPY, roots)).toEqual({ kind: "copy", of: COPY.top });
    expect(wireTopSwapRole(at([0, 1]), COPY, roots)?.kind).toBe("original");
    expect(wireTopSwapRole(at([0, 0, 0]), COPY, roots)).toBeUndefined();
    expect(wireTopSwapRole(at([0, 0]), undefined, roots)).toBeUndefined();
  });
});
