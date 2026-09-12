import { describe, expect, it } from "vitest";
import { EMPTY_ZONES, type Zone, type ZoneMap, zonesContaining } from "@/tools/zone";

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
