import { describe, expect, it } from "vitest";
import { uefiZones, type ZonedNode } from "@/tools/uefi/uefiPresenter";

/** Ported from upstream's `UEFIToolTests` — the zones a selected node publishes. */

const node = (options: Partial<ZonedNode> & Pick<ZonedNode, "header" | "body">): ZonedNode => ({
  id: [0],
  name: "",
  tail: [options.body[1], options.body[1]],
  ...options,
});

describe("the zones a node publishes", () => {
  it("publishes nothing while nothing is selected", () => {
    expect(uefiZones(undefined)).toEqual({ zones: [], focus: undefined });
  });

  // Two zones, not three: the body's own start is where the header ends.
  it("publishes a node with a header and its body, and focuses the body", () => {
    const zones = uefiZones(
      node({ id: [1, 2, 0], name: "VTF", header: [0x1000, 0x1018], body: [0x1018, 0x1100] })
    );

    expect(zones.zones.map((zone) => zone.id)).toEqual(["1.2.0", "1.2.0#body"]);
    expect(zones.zones.map((zone) => [zone.start, zone.end])).toEqual([
      [0x1000, 0x1100],
      [0x1018, 0x1100],
    ]);
    expect(zones.zones.map((zone) => zone.name)).toEqual(["VTF", "VTF body"]);
    expect(zones.focus).toBe("1.2.0#body");
  });

  it("keeps a tail inside the node's own zone, and the body stops before it", () => {
    const zones = uefiZones(
      node({ header: [0x200, 0x218], body: [0x218, 0x2f8], tail: [0x2f8, 0x300] })
    );

    expect([zones.zones[0]?.start, zones.zones[0]?.end]).toEqual([0x200, 0x300]);
    expect([zones.zones[1]?.start, zones.zones[1]?.end]).toEqual([0x218, 0x2f8]);
  });

  it("publishes one zone for a node without a header", () => {
    const zones = uefiZones(node({ id: [4], header: [0x2000, 0x2000], body: [0x2000, 0x4000] }));

    expect(zones.zones).toHaveLength(1);
    expect([zones.zones[0]?.start, zones.zones[0]?.end]).toEqual([0x2000, 0x4000]);
    expect(zones.focus).toBe("4");
  });

  it("publishes one zone for a node without a body", () => {
    const zones = uefiZones(node({ id: [2], header: [0x10, 0x28], body: [0x28, 0x28] }));

    expect(zones.zones).toHaveLength(1);
    expect(zones.focus).toBe("2");
  });

  it("still names an unnamed node's body", () => {
    const zones = uefiZones(node({ header: [0, 0x18], body: [0x18, 0x40] }));

    expect(zones.zones.map((zone) => zone.name)).toEqual(["", "Body"]);
  });
});
