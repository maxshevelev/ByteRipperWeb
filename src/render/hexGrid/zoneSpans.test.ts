import { describe, expect, it } from "vitest";
import { zoneSpans } from "@/render/hexGrid/hexGridRenderer";

describe("the zones the dump draws", () => {
  // A scattered zone reaches the dump as its stretches, each numbered in the owner's order for
  // its badge; a zone of one stretch carries no number.
  // @upstream ByteRipperTests/ToolZonesTests.swift#ToolZonesTests.testAScatteredZoneReachesTheDumpAsNumberedStretches
  it("are a scattered zone's stretches, numbered", () => {
    const spans = zoneSpans(
      [
        {
          id: "file",
          start: 0x20,
          end: 0xa0,
          stretches: [
            { start: 0x80, end: 0xa0 },
            { start: 0x20, end: 0x40 },
          ],
        },
        { id: "one", start: 0x100, end: 0x110 },
      ],
      "file"
    );

    expect(spans.map((one) => [one.start, one.end])).toEqual([
      [0x80, 0xa0],
      [0x20, 0x40],
      [0x100, 0x110],
    ]);
    expect(spans.map((one) => one.piece)).toEqual([1, 2, undefined]);
    expect(spans.map((one) => one.focused)).toEqual([true, true, false]);
    // Nothing between the stretches.
    expect(spans.some((one) => one.start < 0x80 && one.end > 0x40)).toBe(false);
  });
});
