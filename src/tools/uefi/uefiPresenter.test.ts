import { describe, expect, it } from "vitest";
import { nodeIDOfZone, uefiZones, type ZonedNode } from "@/tools/uefi/uefiPresenter";
import { normalizedZones, zonesContaining } from "@/tools/zone";

/** Ported from upstream's `UEFIToolTests` — the zones a selected node publishes. */

const node = (options: Partial<ZonedNode> & Pick<ZonedNode, "header" | "body">): ZonedNode => ({
  id: [0],
  name: "",
  tail: [options.body[1], options.body[1]],
  ...options,
});

describe("the zones a node publishes", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testNothingSelectedPublishesNothing
  it("publishes nothing while nothing is selected", () => {
    expect(uefiZones(undefined)).toEqual({ zones: [], focus: undefined });
  });

  // Two zones, not three: the body's own start is where the header ends.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testANodeWithAHeaderPublishesItsBodyAndFocusesIt
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testSelectingANodePublishesItsBody
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

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testATailStaysInsideTheNodesOwnZone
  it("keeps a tail inside the node's own zone, and the body stops before it", () => {
    const zones = uefiZones(
      node({ header: [0x200, 0x218], body: [0x218, 0x2f8], tail: [0x2f8, 0x300] })
    );

    expect([zones.zones[0]?.start, zones.zones[0]?.end]).toEqual([0x200, 0x300]);
    expect([zones.zones[1]?.start, zones.zones[1]?.end]).toEqual([0x218, 0x2f8]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testANodeWithoutAHeaderPublishesOneZone
  it("publishes one zone for a node without a header", () => {
    const zones = uefiZones(node({ id: [4], header: [0x2000, 0x2000], body: [0x2000, 0x4000] }));

    expect(zones.zones).toHaveLength(1);
    expect([zones.zones[0]?.start, zones.zones[0]?.end]).toEqual([0x2000, 0x4000]);
    expect(zones.focus).toBe("4");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testANodeWithoutABodyPublishesOneZone
  it("publishes one zone for a node without a body", () => {
    const zones = uefiZones(node({ id: [2], header: [0x10, 0x28], body: [0x28, 0x28] }));

    expect(zones.zones).toHaveLength(1);
    expect(zones.focus).toBe("2");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testAnUnnamedNodesBodyIsStillNamed
  it("still names an unnamed node's body", () => {
    const zones = uefiZones(node({ header: [0, 0x18], body: [0x18, 0x40] }));

    expect(zones.zones.map((zone) => zone.name)).toEqual(["", "Body"]);
  });
});

describe("the zones as the dump draws them", () => {
  // Nesting is legal, and the focus still names a zone that is in the map.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testTheNestedZonesSurviveNormalisation
  it("keep the node and its body, nested, through normalisation", () => {
    const drawable = normalizedZones(
      uefiZones(node({ id: [0], name: "FFSv2", header: [0, 0x48], body: [0x48, 0x1000] })),
      0x1000
    );

    expect(drawable.zones).toHaveLength(2);
    expect(drawable.focus).toBe("0#body");
    // A byte in the header is in the node's zone and no other.
    expect(zonesContaining(drawable, 0x10).map((zone) => zone.id)).toEqual(["0"]);
    expect(zonesContaining(drawable, 0x48).map((zone) => zone.id)).toEqual(["0", "0#body"]);
  });
});

describe("a zone id read back into a node's path", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testZoneIdsRoundTripToNodePaths
  it("round-trips the ids the panel publishes", () => {
    expect(
      nodeIDOfZone(uefiZones(node({ id: [1, 2, 0], header: [0, 8], body: [8, 16] })).focus ?? "")
    ).toEqual([1, 2, 0]);
    expect(nodeIDOfZone("0")).toEqual([0]);
    expect(nodeIDOfZone("3.1")).toEqual([3, 1]);
  });

  // A part's zone leads to the node it is part of: the reader picked "VTF body"
  // in the dump and the row they want is VTF. Any part, not only the one
  // published today — the suffix is not what identifies the node.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testAPartsZoneIdLeadsToItsNode
  it("sends a part's zone to the node the part is of", () => {
    expect(nodeIDOfZone("1.2.0#body")).toEqual([1, 2, 0]);
    expect(nodeIDOfZone("1.2.0#header")).toEqual([1, 2, 0]);
    expect(nodeIDOfZone("0#body")).toEqual([0]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIPresenterTests.testAZoneIdThatIsNotAPathIsRejected
  it("refuses an id that is not a path", () => {
    expect(nodeIDOfZone("")).toBeUndefined();
    expect(nodeIDOfZone("root")).toBeUndefined();
    expect(nodeIDOfZone("1.x")).toBeUndefined();
    expect(nodeIDOfZone("1..2")).toBeUndefined();
    expect(nodeIDOfZone("#body")).toBeUndefined();
    expect(nodeIDOfZone("1.x#body")).toBeUndefined();
  });

  // A field Swift's `Int(_:)` would refuse is a refusal for the whole id, where
  // JavaScript's looser numeric readers would take all three of these.
  it("reads a field the way Swift's Int does, not the way Number does", () => {
    expect(nodeIDOfZone("1e3")).toBeUndefined();
    expect(nodeIDOfZone("0x10")).toBeUndefined();
    expect(nodeIDOfZone(" ")).toBeUndefined();
    expect(nodeIDOfZone("+1.2")).toEqual([1, 2]);
  });
});
