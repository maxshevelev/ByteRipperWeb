import { describe, expect, it } from "vitest";
import { FileIndex, locateRanges } from "@/tools/me/agent/meAgentLocator";
import type { MEANode } from "@/tools/meaTree";

/**
 * How a byte comparison's run is placed at the one ME file it touches.
 *
 * @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests
 */

const node = (
  path: number[],
  title: string,
  options: {
    range?: { start: number; end: number };
    extents?: { start: number; end: number }[];
    children?: MEANode[];
  } = {}
): MEANode => ({
  path,
  title,
  subtitle: "",
  range: options.range,
  extents: options.extents,
  fields: [],
  children: options.children ?? [],
  isEmptySection: false,
  marks: undefined,
  helpTerm: undefined,
});

describe("the ME locator", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests.testARunIsPlacedAtTheOneFileItTouches
  it("places a run at the one file it touches", () => {
    const a = node([0, 1, 0], "a", {
      extents: [
        { start: 0x100, end: 0x140 },
        { start: 0x300, end: 0x340 },
      ],
    });
    const b = node([0, 1, 1], "b", { extents: [{ start: 0x142, end: 0x182 }] });
    const index = new FileIndex([a, b]);
    expect(index.only({ start: 0x310, end: 0x320 })?.title).toBe("a");
    expect(index.only({ start: 0x130, end: 0x142 })?.title).toBe("a");
    expect(index.only({ start: 0x130, end: 0x150 })).toBeUndefined();
    expect(index.only({ start: 0x200, end: 0x210 })).toBeUndefined();
    expect(index.only({ start: 0x180, end: 0x400 })?.title).toBeUndefined();
  });

  it("places a range in its area and at the smallest node that holds it whole", () => {
    const boot = node([0, 0], "Boot", { range: { start: 0x1000, end: 0x2000 } });
    const code = node([0, 1], "Code", {
      range: { start: 0x2000, end: 0x4000 },
      children: [node([0, 1, 0], "Manifest", { range: { start: 0x2000, end: 0x2200 } })],
    });
    const table = node([0], "Partitions", {
      range: { start: 0x1000, end: 0x4000 },
      children: [boot, code],
    });
    const region = { start: 0x1000, end: 0x4000 };
    const placed = locateRanges([table], region, [
      { start: 0x2010, end: 0x2020 },
      { start: 0x9000, end: 0x9010 },
    ]);
    expect(placed[0]?.map((one) => one.name)).toEqual(["Code", "Manifest"]);
    expect(placed[1]).toEqual([]);
  });
});
