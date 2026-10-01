import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { BinaryWriter, volume, volumeTopFile } from "@/firmware/testing/testImage";
import { vssStore, vssVariable } from "@/firmware/testing/testNvram";
import { sum8 } from "@/firmware/uefi/checksums";
import { type EFIGUID, guid } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `InsydeVariableDefaultsTests.swift`: Insyde's Variable Default
 * region (`UEFI_IMAGE_FORMAT.md` §9) — a run of `$VSS` stores outside every
 * volume, which the raw-area scan reads as padding, and reads as stores where
 * the flash device map says they are.
 */

const SIZE = 0x10000;
const BASE = 0x1_0000_0000 - SIZE;
const PASSWORD = guid("C0027E32-8EE5-4D17-9B28-BA50166C4CB4");

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

describe("Insyde's Variable Defaults", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testTheRegionTheMapNamesReadsAsItsStores
  it("reads the region the map names as its stores", () => {
    const parsed = parseUefiImage(sourceOver(image()));
    const nodes = (parsed.roots[0] as UEFINode).children;
    const stores = nodes.filter((node) => node.kind === "vssStore");

    expect(stores.map((node) => nodeRange(node))).toEqual([
      { start: 0x1000, end: 0x1000 + firstStore.length },
      { start: 0x1000 + firstStore.length, end: 0x1000 + firstStore.length + secondStore.length },
    ]);
    expect(stores[0]?.children.map((node) => node.name)).toEqual(["Setup", "PchSetup"]);
    expect(stores[1]?.children.map((node) => node.name)).toEqual(["SaSetup"]);
    expect(parsed.diagnostics).toEqual([]);

    // The padding before the region and the erased rest of it stay what they
    // were; nothing outside the range the map names is touched.
    const index = nodes.findIndex((node) => node.kind === "vssStore");
    expect(range(nodes[index - 1])).toEqual({ start: 0, end: 0x1000 });
    expect(nodes[index - 1]?.kind).toBe("padding");
    expect(nodes[index + 2]?.kind).toBe("freeSpace");
    expect(range(nodes[index + 2]).end).toBe(0x3000);
    expect(range(nodes[index + 3])).toEqual({ start: 0x3000, end: 0x4000 });
  });

  // The map's rows are named by region type, the way UEFITool names them.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testAnEntryIsNamedByItsRegionType
  it("names an entry by its region type", () => {
    const store = top(image()).find((node) => node.kind === "flashDeviceMapStore") as UEFINode;
    expect(store.children.map((node) => node.name)).toEqual(["Variable Defaults", "Password"]);
  });

  // Without a Volume Top File at the tail there is no address to place the
  // range by, and it stays padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testWithNoVolumeTopFileAtTheTailTheRegionStaysPadding
  it("leaves the region as padding with no Volume Top File at the tail", () => {
    const nodes = top(image({ trailing: 0x100 }));
    expect(nodes.some((node) => node.kind === "vssStore")).toBe(false);
  });

  // A region nobody wrote is padding still.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testAnErasedRegionStaysPadding
  it("leaves an erased region as padding", () => {
    const nodes = top(image({ defaults: new Uint8Array(0) }));
    expect(nodes.some((node) => node.kind === "vssStore" || node.kind === "freeSpace")).toBe(false);
    expect(range(nodes[0])).toEqual({ start: 0, end: 0x4000 });
  });

  // A board can carry the map twice; the range is read once.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testTwoMapsNamingTheSameRegionReadItOnce
  it("reads a region two maps name once", () => {
    const entries: readonly Entry[] = [
      { type: FlashDeviceMap.variableDefaults, offset: 0x1000, size: 0x2000 },
    ];
    const nodes = top(image({ maps: [entries, entries] }));
    expect(nodes.filter((node) => node.kind === "vssStore")).toHaveLength(2);
    expect(nodes.filter((node) => node.kind === "flashDeviceMapStore")).toHaveLength(2);
  });

  // An entry that lands in something already read — here the volume — has
  // nothing left to do.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeVariableDefaultsTests.swift#InsydeVariableDefaultsTests.testAnEntryOutsidePaddingChangesNothing
  it("changes nothing for an entry that lands outside padding", () => {
    const entries: readonly Entry[] = [
      { type: FlashDeviceMap.variableDefaults, offset: 0xf000, size: 0x100 },
    ];
    const nodes = top(image({ maps: [entries] }));
    expect(nodes.some((node) => node.kind === "vssStore")).toBe(false);
    expect(nodes[nodes.length - 1]?.kind).toBe("volume");
  });
});
