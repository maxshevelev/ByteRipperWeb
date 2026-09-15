import { describe, expect, it } from "vitest";
import {
  EMPTY_ZONES,
  normalizedZones,
  type Zone,
  type ZoneMap,
  zonesContaining,
} from "@/tools/zone";

function map(...zones: Zone[]): ZoneMap {
  return { zones, focus: undefined };
}

const table: Zone = { id: "fit", name: "FIT table", start: 0x100, end: 0x200 };
const row: Zone = { id: "fit/2", name: "Microcode row", start: 0x120, end: 0x130 };
const target: Zone = { id: "ucode", name: "Microcode", start: 0x800, end: 0x1800 };

describe("zonesContaining", () => {
  it("finds nothing in an empty map", () => {
    expect(zonesContaining(EMPTY_ZONES, 0x120)).toEqual([]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testTheZonesOverAByteAreListedOutermostFirst
  it("orders the zones around an offset outermost first", () => {
    // The order is what a menu reads out and what a click walks inward
    // through, so the smallest thing under the pointer is the last word.
    expect(zonesContaining(map(row, table), 0x124).map((zone) => zone.id)).toEqual([
      "fit",
      "fit/2",
    ]);
  });

  it("leaves out a zone the offset misses", () => {
    expect(zonesContaining(map(table, row, target), 0x110).map((zone) => zone.id)).toEqual(["fit"]);
  });

  it("treats the end as past the zone", () => {
    // [start, end), the convention everywhere: the byte at `end` belongs to
    // whatever comes next, not to this.
    expect(zonesContaining(map(row), 0x130)).toEqual([]);
    expect(zonesContaining(map(row), 0x12f)).toEqual([row]);
  });
});

/** Ported from upstream's `ZoneMapTests`: the repair a map goes through before it is drawn. */
describe("normalizedZones", () => {
  const zone = (id: string, start: number, end: number): Zone => ({ id, name: id, start, end });
  const ranges = (drawn: ZoneMap) => drawn.zones.map((one) => [one.start, one.end]);

  // A map is a re-read behind the file, and what is left of a zone past a
  // shortening edit is still worth drawing.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testAZoneReachingPastTheEndIsCutToTheEnd
  it("cuts a zone reaching past the end to the end", () => {
    expect(ranges(normalizedZones(map(zone("fv", 0x100, 0x400)), 0x280))).toEqual([[0x100, 0x280]]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testAZoneStartingPastTheEndIsDropped
  it("drops a zone starting past the end", () => {
    const drawn = normalizedZones(map(zone("gone", 0x400, 0x500), zone("here", 0, 0x10)), 0x100);
    expect(drawn.zones.map((one) => one.id)).toEqual(["here"]);
  });

  // A stretch of no bytes is a mark, and marks are bookmarks.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testAnEmptyZoneIsDropped
  it("drops an empty zone", () => {
    expect(normalizedZones(map(zone("point", 0x40, 0x40)), 0x100).zones).toEqual([]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testARepeatedIdKeepsTheFirstOne
  it("keeps the first of two zones with one id", () => {
    const drawn = normalizedZones(map(zone("dup", 0, 0x10), zone("dup", 0x20, 0x30)), 0x100);
    expect(ranges(drawn)).toEqual([[0, 0x10]]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testAFocusThatSurvivesIsKept
  it("keeps a focus that survives", () => {
    expect(normalizedZones({ zones: [zone("a", 0, 0x10)], focus: "a" }, 0x100).focus).toBe("a");
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testAFocusOnAZoneThatWentAwayIsCleared
  it("clears a focus on a zone that went away", () => {
    const drawn = normalizedZones({ zones: [zone("gone", 0x400, 0x500)], focus: "gone" }, 0x100);
    expect(drawn.focus).toBeUndefined();
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testNestedZonesSurviveAndTheOuterOneIsDrawnFirst
  it("keeps nested zones and draws the outer one first", () => {
    const drawn = normalizedZones(
      map(zone("section", 0x100, 0x180), zone("volume", 0x100, 0x400)),
      0x1000
    );
    expect(drawn.zones.map((one) => one.id)).toEqual(["volume", "section"]);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ZoneMapTests.swift#ZoneMapTests.testTheResultDoesNotDependOnTheOrderItArrivedIn
  it("does not depend on the order the zones arrived in", () => {
    const zones = [zone("c", 0x200, 0x300), zone("a", 0, 0x100), zone("b", 0x100, 0x200)];
    const forwards = normalizedZones(map(...zones), 0x1000);
    const backwards = normalizedZones(map(...[...zones].reverse()), 0x1000);
    expect(forwards).toEqual(backwards);
    expect(forwards.zones.map((one) => one.id)).toEqual(["a", "b", "c"]);
  });
});
