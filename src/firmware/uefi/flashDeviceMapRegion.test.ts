import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { BinaryWriter, volume, volumeTopFile } from "@/firmware/testing/testImage";
import { vssStore, vssVariable } from "@/firmware/testing/testNvram";
import { sum8 } from "@/firmware/uefi/checksums";
import { type EFIGUID, guid, guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `FlashDeviceMapRegionTests.swift`: the regions an Insyde flash
 * device map names (`UEFI_IMAGE_FORMAT.md` §9) — ranges outside every volume,
 * with no signature, which the raw-area scan reads as padding, and reads as
 * regions named by type where the map says they are. A Variable Defaults region
 * is read further, as its `$VSS` stores.
 */

const SIZE = 0x10000;
const BASE = 0x1_0000_0000 - SIZE;
const PASSWORD = guid("C0027E32-8EE5-4D17-9B28-BA50166C4CB4");
const UNNAMED = guid("0BADF00D-0000-4000-8000-000000000001");

interface Entry {
  readonly type: EFIGUID;
  readonly offset: number;
  readonly size: number;
}

/** A flash device map whose entries carry the region types given. */
function map(entries: readonly Entry[]): Uint8Array {
  const body = new BinaryWriter();
  for (const entry of entries) {
    body.guid(entry.type);
    body.fill(16, 0); // RegionId
    body.u64(entry.offset);
    body.u64(entry.size);
    body.u32(FlashDeviceMap.modifiable);
    body.fill(32, 0); // Hash
  }
  const header = new BinaryWriter()
    .u32(FlashDeviceMap.signature)
    .u32(FlashDeviceMap.headerSize + body.count)
    .u32(FlashDeviceMap.headerSize)
    .u32(FlashDeviceMap.entrySize)
    .u8(FlashDeviceMap.entryFormat)
    .u8(3) // Revision
    .u8(0) // ExtensionCount
    .u8(0) // Checksum, filled in below
    .u64(BASE).bytes;
  header[FlashDeviceMap.checksumOffset] = (0x100 - sum8(header)) & 0xff;
  return Uint8Array.from([...header, ...body.bytes]);
}

const firstStore = vssStore({
  variables: [vssVariable({ name: "Setup" }), vssVariable({ name: "PchSetup" })],
  freeSpace: 0,
});
const secondStore = vssStore({ variables: [vssVariable({ name: "SaSetup" })], freeSpace: 0 });

const DEFAULTS_ENTRIES: readonly Entry[] = [
  { type: FlashDeviceMap.variableDefaults, offset: 0x1000, size: 0x2000 },
  { type: PASSWORD, offset: 0x3000, size: 0x100 },
];

/**
 * A 64 KiB image with no descriptor: the defaults at `0x1000`, the map at
 * `0x4000`, and a volume ending in the Volume Top File flush against the
 * image's end — which maps it at `0xFFFF0000`.
 */
function image(
  options: {
    readonly defaults?: Uint8Array;
    readonly maps?: readonly (readonly Entry[])[];
    readonly trailing?: number;
  } = {}
): Uint8Array {
  const defaults = options.defaults ?? Uint8Array.from([...firstStore, ...secondStore]);
  const maps = options.maps ?? [DEFAULTS_ENTRIES];
  const bytes = new Uint8Array(SIZE).fill(0xff);
  bytes.set(defaults, 0x1000);
  let at = 0x4000;
  for (const entries of maps) {
    const store = map(entries);
    bytes.set(store, at);
    at += 0x400;
  }
  bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
  const out = new Uint8Array(SIZE + (options.trailing ?? 0)).fill(0xff);
  out.set(bytes);
  return out;
}

const top = (bytes: Uint8Array): UEFINode[] =>
  (parseUefiImage(sourceOver(bytes)).roots[0] as UEFINode).children;
const range = (node: UEFINode | undefined) => nodeRange(node as UEFINode);
const regions = (nodes: readonly UEFINode[]) =>
  nodes.filter((node) => node.kind === "flashDeviceMapRegion");
const ofType = (nodes: readonly UEFINode[], type: EFIGUID) =>
  regions(nodes).find((node) => node.guid !== undefined && guidEquals(node.guid, type)) as UEFINode;

describe("the regions a flash device map names", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testTheVariableDefaultsRegionReadsAsItsStores
  it("reads the Variable Defaults region as its stores", () => {
    const parsed = parseUefiImage(sourceOver(image()));
    const nodes = (parsed.roots[0] as UEFINode).children;
    const defaults = ofType(nodes, FlashDeviceMap.variableDefaults);
    const stores = defaults.children.filter((node) => node.kind === "vssStore");

    expect(range(defaults)).toEqual({ start: 0x1000, end: 0x3000 });
    expect(defaults.name).toBe("Variable Defaults");
    expect(stores.map((node) => nodeRange(node))).toEqual([
      { start: 0x1000, end: 0x1000 + firstStore.length },
      { start: 0x1000 + firstStore.length, end: 0x1000 + firstStore.length + secondStore.length },
    ]);
    expect(stores[0]?.children.map((node) => node.name)).toEqual(["Setup", "PchSetup"]);
    expect(stores[1]?.children.map((node) => node.name)).toEqual(["SaSetup"]);
    expect(defaults.children[defaults.children.length - 1]?.kind).toBe("freeSpace");
    expect(range(defaults.children[defaults.children.length - 1]).end).toBe(0x3000);
    expect(parsed.diagnostics).toEqual([]);
  });

  // Every other region is a leaf named by its type, and the padding around it
  // stays what it was: nothing outside the range the map names is touched.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testARegionIsCutOutOfThePaddingAndNamedByItsType
  it("cuts a region out of the padding and names it by its type", () => {
    const nodes = top(image());
    const found = regions(nodes);

    expect(found.map((node) => node.name)).toEqual(["Variable Defaults", "Password"]);
    expect(found.map((node) => nodeRange(node))).toEqual([
      { start: 0x1000, end: 0x3000 },
      { start: 0x3000, end: 0x3100 },
    ]);
    expect(found[1]?.guid).toEqual(PASSWORD);
    expect(found[1]?.children).toEqual([]);
    expect(found.every((node) => node.isFixed)).toBe(true);

    const index = nodes.findIndex((node) => node.kind === "flashDeviceMapRegion");
    expect(range(nodes[index - 1])).toEqual({ start: 0, end: 0x1000 });
    expect(nodes[index - 1]?.kind).toBe("padding");
    expect(range(nodes[index + 2])).toEqual({ start: 0x3100, end: 0x4000 });
    expect(nodes[index + 2]?.kind).toBe("padding");
  });

  // The Type column keeps UEFITool's word for these bytes, and the subtype says
  // whether anything was written.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testARegionClassifiesAsPadding
  it("classifies a region as padding", () => {
    const nodes = top(image());
    const password = ofType(nodes, PASSWORD);
    const defaults = ofType(nodes, FlashDeviceMap.variableDefaults);

    expect(itemType(password)).toBe(ItemType.padding);
    expect(password.isErased).toBe(true);
    expect(itemSubtype(password)).toBe(Sub.onePadding);
    expect(defaults.isErased).toBe(false);
    expect(itemSubtype(defaults)).toBe(Sub.dataPadding);
  });

  // A type UEFITool does not name is still a region, called what it is.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testARegionOfAnUnnamedTypeKeepsItsGUID
  it("keeps the GUID of a region of an unnamed type", () => {
    const entries: readonly Entry[] = [{ type: UNNAMED, offset: 0x2000, size: 0x800 }];
    const found = regions(top(image({ maps: [entries] })));
    expect(found.map((node) => node.guid)).toEqual([UNNAMED]);
    expect(found[0]?.name).toBe("Flash device map region");
  });

  // The map's rows are named by region type, the way UEFITool names them.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testAnEntryIsNamedByItsRegionType
  it("names an entry by its region type", () => {
    const store = top(image()).find((node) => node.kind === "flashDeviceMapStore") as UEFINode;
    expect(store.children.map((node) => node.name)).toEqual(["Variable Defaults", "Password"]);
  });

  // Without a Volume Top File at the tail there is no address to place the
  // ranges by, and they stay padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testWithNoVolumeTopFileAtTheTailTheRegionsStayPadding
  it("leaves the regions as padding with no Volume Top File at the tail", () => {
    const nodes = top(image({ trailing: 0x100 }));
    expect(regions(nodes)).toEqual([]);
    expect(nodes.some((node) => node.kind === "vssStore")).toBe(false);
  });

  // A Variable Defaults region nobody wrote is a region still, with no stores in
  // it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testAnErasedVariableDefaultsRegionHoldsNoStores
  it("holds no stores in an erased Variable Defaults region", () => {
    const defaults = ofType(
      top(image({ defaults: new Uint8Array(0) })),
      FlashDeviceMap.variableDefaults
    );
    expect(defaults.children).toEqual([]);
    expect(defaults.isErased).toBe(true);
  });

  // A board can carry the map twice; each range is read once.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testTwoMapsNamingTheSameRegionReadItOnce
  it("reads a region two maps name once", () => {
    const entries: readonly Entry[] = [
      { type: FlashDeviceMap.variableDefaults, offset: 0x1000, size: 0x2000 },
    ];
    const nodes = top(image({ maps: [entries, entries] }));
    expect(regions(nodes)).toHaveLength(1);
    expect(
      (regions(nodes)[0] as UEFINode).children.filter((node) => node.kind === "vssStore")
    ).toHaveLength(2);
    expect(nodes.filter((node) => node.kind === "flashDeviceMapStore")).toHaveLength(2);
  });

  // Where two entries overlap, the one that starts first is placed, and the
  // other — no longer inside padding — stays out.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testOfTwoOverlappingEntriesTheFirstByAddressIsPlaced
  it("places the first by address of two overlapping entries", () => {
    const entries: readonly Entry[] = [
      { type: PASSWORD, offset: 0x2800, size: 0x1000 },
      { type: UNNAMED, offset: 0x2000, size: 0x1000 },
    ];
    const found = regions(top(image({ defaults: new Uint8Array(0), maps: [entries] })));
    expect(found.map((node) => node.guid)).toEqual([UNNAMED]);
    expect(found.map((node) => nodeRange(node))).toEqual([{ start: 0x2000, end: 0x3000 }]);
  });

  // An entry that lands in something already read — here the volume — has
  // nothing left to do.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FlashDeviceMapRegionTests.swift#FlashDeviceMapRegionTests.testAnEntryOutsidePaddingChangesNothing
  it("changes nothing for an entry that lands outside padding", () => {
    const entries: readonly Entry[] = [
      { type: FlashDeviceMap.variableDefaults, offset: 0xf000, size: 0x100 },
    ];
    const nodes = top(image({ maps: [entries] }));
    expect(regions(nodes)).toEqual([]);
    expect(nodes[nodes.length - 1]?.kind).toBe("volume");
  });
});
