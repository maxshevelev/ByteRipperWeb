import { describe, expect, it } from "vitest";
import { zoneStretchBrackets } from "@/render/minimap/zoneStretches";

describe("the gutter's brackets", () => {
  // A scattered zone — an ME file's chunks — is a bracket per stretch, never one over the span,
  // and each stretch nests in the zone around it.
  // @upstream ByteRipperTests/MinimapZoneTests.swift#MinimapZoneTests.testAScatteredZoneIsABracketPerStretch
  it("are one per stretch of a scattered zone", () => {
    const brackets = zoneStretchBrackets([
      { id: "volume", start: 0, end: 0x400 },
      {
        id: "file",
        start: 0x100,
        end: 0x240,
        stretches: [
          { start: 0x200, end: 0x240 },
          { start: 0x100, end: 0x140 },
        ],
      },
    ]);
    expect(brackets.map((one) => one.zone.id)).toEqual(["volume", "file", "file"]);
    // The stretches, in address order, and nothing between them.
    expect(brackets.map((one) => [one.start, one.end])).toEqual([
      [0, 0x400],
      [0x100, 0x140],
      [0x200, 0x240],
    ]);
    expect(brackets.map((one) => one.depth)).toEqual([0, 1, 1]);
  });
});
