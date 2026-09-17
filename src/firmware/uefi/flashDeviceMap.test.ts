import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { flashDeviceMapBytes, mapImage, ZERO32 } from "@/firmware/testing/testBootGuard";
import type { UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * The Insyde H2O flash device map: a store the raw-area scan finds, its entries
 * read when their layout is the one known. Ported from the flash-device-map
 * cases of upstream's `ProtectedRangesTests`.
 */

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));

const allNodes = (roots: readonly UEFINode[]): UEFINode[] =>
  roots.flatMap((root) => flattened(root));

const isFlashDeviceMapDiagnostic = (one: UEFIDiagnostic) =>
  ("structure" in one.detail && one.detail.structure === "flashDeviceMap") ||
  one.detail.kind === "unknownFlashDeviceMapEntries";

describe("an Insyde flash device map", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAFlashDeviceMapIsAFixedNodeWithItsEntries
  it("is a fixed node with its entries", () => {
    const store = flashDeviceMapBytes({
      base: 0xffff_0000,
      entries: [
        { offset: 0x3000, size: 0x100, attributes: 0, hash: ZERO32 },
        { offset: 0x4000, size: 0x100, attributes: 1, hash: ZERO32 },
      ],
    });
    const parsed = parse(mapImage(store));

    const node = allNodes(parsed.roots).find(
      (one) => one.kind === "flashDeviceMapStore"
    ) as UEFINode;
    expect(node).toBeDefined();
    expect(nodeRange(node)).toEqual({ start: 0, end: store.length });
    expect(node.isFixed).toBe(true);
    expect(node.children.map((one) => one.kind)).toEqual([
      "flashDeviceMapEntry",
      "flashDeviceMapEntry",
    ]);
    expect(itemType(node)).toBe(ItemType.insydeFlashDeviceMapStore);
    expect(parsed.diagnostics.filter(isFlashDeviceMapDiagnostic)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAFlashDeviceMapOfAnUnknownEntryFormatIsALeafAndReported
  it("is a leaf, reported, when its entry format is unknown", () => {
    const store = flashDeviceMapBytes({
      base: 0xffff_0000,
      entries: [{ offset: 0x3000, size: 0x100, attributes: 0, hash: ZERO32 }],
      format: 1,
    });
    const parsed = parse(mapImage(store));

    const node = allNodes(parsed.roots).find(
      (one) => one.kind === "flashDeviceMapStore"
    ) as UEFINode;
    expect(node.children).toEqual([]);
    expect(parsed.diagnostics.map((one) => one.detail)).toContainEqual({
      kind: "unknownFlashDeviceMapEntries",
      size: 0x54,
      format: 1,
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ProtectedRangesTests.swift#ProtectedRangesTests.testAFlashDeviceMapOfALaterRevisionIsSkippedAndReported
  it("is skipped, reported, at a later revision", () => {
    const store = flashDeviceMapBytes({
      base: 0xffff_0000,
      entries: [{ offset: 0x3000, size: 0x100, attributes: 0, hash: ZERO32 }],
      revision: 5,
    });
    const parsed = parse(mapImage(store));

    expect(allNodes(parsed.roots).some((one) => one.kind === "flashDeviceMapStore")).toBe(false);
    expect(parsed.diagnostics.map((one) => one.detail)).toContainEqual({
      kind: "unknownRevision",
      structure: "flashDeviceMap",
      revision: 5,
    });
  });
});
