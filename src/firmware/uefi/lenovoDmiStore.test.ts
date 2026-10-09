import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { flashDeviceMapBytes } from "@/firmware/testing/testFlashDeviceMap";
import { volume, volumeTopFile } from "@/firmware/testing/testImage";
import { MTM, SERIAL, STANDARD_LOG, testBlock, testLog } from "@/firmware/testing/testLenovoDMI";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { guid } from "@/firmware/uefi/efiGuid";
import { itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * Lenovo's DMI store (`lenovoDmiStore.ts`): read as one row with the log and both blocks
 * under it — in place of the three regions an Insyde map declares, or out of the padding
 * it lies in — and a `LENV` block on its own the same way. The format itself is
 * `src/firmware/lenovoDmi`'s and tested there; these check the rows.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests
 */

const SIZE = 0x10000;
const BASE = 0x1_0000_0000 - SIZE;
/** The region type Insyde's map gives the three: "Unknown". */
const UNKNOWN = guid("201D65E5-BE23-4875-80F8-B1D4795E7E08");

/** The log, block 1 at generation 3 and block 2 at generation 4. */
const STORE = Uint8Array.from([
  ...testLog(STANDARD_LOG.slice(2), 0x77),
  ...testBlock({ generation: 3, key: 0x77, entries: [SERIAL, MTM] }),
  ...testBlock({ generation: 4, key: 0x77, entries: [SERIAL] }),
]);

/**
 * A 64 KiB image with no descriptor: the store at `0x8000`, a map at `0x4000` when
 * `mapped`, and a volume ending in the Volume Top File flush against the image's end.
 */
function image(mapped: boolean, at = 0x8000): Uint8Array {
  const bytes = new Uint8Array(SIZE).fill(0xff);
  bytes.set(STORE, at);
  if (mapped) {
    bytes.set(
      flashDeviceMapBytes(
        [
          { type: UNKNOWN, offset: at, size: 0x2000 },
          { type: UNKNOWN, offset: at + 0x2000, size: 0x1000 },
          { type: UNKNOWN, offset: at + 0x3000, size: 0x1000 },
        ],
        BASE
      ),
      0x4000
    );
  }
  bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
  return bytes;
}

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const stores = (nodes: readonly UEFINode[]) =>
  nodes.flatMap((node) => flattened(node)).filter((node) => node.kind === "lenovoDMIStore");

describe("Lenovo's DMI store in the tree", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testTheMapsThreeRegionsAreOneStore
  it("makes the map's three regions the one store they are", () => {
    const parsed = parse(image(true));
    const found = stores(parsed.roots);
    const store = found[0] as UEFINode;
    expect(found).toHaveLength(1);
    expect(nodeRange(store)).toEqual({ start: 0x8000, end: 0xc000 });
    // The firmware finds it where the map says.
    expect(store.isFixed).toBe(true);
    expect(
      parsed.allNodes.some(
        (node) =>
          node.kind === "flashDeviceMapRegion" &&
          node.guid !== undefined &&
          node.guid.toString() === UNKNOWN.toString()
      )
    ).toBe(false);
    expect(store.children.map((child) => child.kind)).toEqual([
      "ldbgLog",
      "lenvBlock",
      "lenvBlock",
    ]);
    expect(store.children.map((child) => nodeRange(child))).toEqual([
      { start: 0x8000, end: 0xa000 },
      { start: 0xa000, end: 0xb000 },
      { start: 0xb000, end: 0xc000 },
    ]);
    // Block 2 has the higher generation.
    expect(store.children.map((child) => child.subtype)).toEqual([undefined, 0, 1]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testWithoutAMapTheStoreIsReadOutOfPadding
  it("reads the store out of the padding it lies in without a map", () => {
    const parsed = parse(image(false));
    const store = stores(parsed.roots)[0] as UEFINode;
    expect(nodeRange(store)).toEqual({ start: 0x8000, end: 0xc000 });
    const outer = (parsed.roots[0] as UEFINode).children.find(
      (node) => nodeRange(node).start <= 0x8000 && 0x8000 < nodeRange(node).end
    ) as UEFINode;
    expect(outer.kind).toBe("padding");
    expect(outer.children.map((child) => child.kind)).toEqual([
      "padding",
      "lenovoDMIStore",
      "padding",
    ]);
    expect(nodeRange(outer.children[0] as UEFINode).end).toBe(0x8000);
    expect(nodeRange(outer.children[2] as UEFINode).start).toBe(0xc000);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testEntriesAreRowsOfTheirBlock
  it("makes each entry a row of its block", () => {
    const store = stores(parse(image(true)).roots)[0] as UEFINode;
    const entries = (store.children[1] as UEFINode).children;
    expect(entries.map((entry) => entry.kind)).toEqual(["lenvEntry", "lenvEntry"]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "Baseboard serial number",
      "Machine type/model",
    ]);
    expect(entries[0]?.header).toEqual({ start: 0xa010, end: 0xa028 });
    expect(entries[0]?.body).toEqual({ start: 0xa028, end: 0xa030 });
    expect(entries[1]?.header.start).toBe(0xa030);
    expect((store.children[1] as UEFINode).header).toEqual({ start: 0xa000, end: 0xa010 });

    const writes = (store.children[0] as UEFINode).children;
    expect(writes.map((write) => write.name)).toEqual(["2022-06-29 20:30:25"]);
    expect(writes.map((write) => write.kind)).toEqual(["ldbgEntry"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testTheStoreClassifiesAsPadding
  it("classifies the store as padding, as a GPNV store is", () => {
    const store = stores(parse(image(true)).roots)[0] as UEFINode;
    for (const node of flattened(store)) expect(itemType(node), node.kind).toBe(ItemType.padding);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testABlockOnItsOwnIsABlock
  it("reads a block on its own as a block", () => {
    const block = testBlock({ generation: 3, key: 0x77, entries: [SERIAL] });
    const parsed = parse(block);
    const row = parsed.allNodes.find((node) => node.kind === "lenvBlock") as UEFINode;
    expect(nodeRange(row)).toEqual({ start: 0, end: 0x1000 });
    expect(row.subtype).toBeUndefined();
    expect(row.children.map((child) => child.name)).toEqual(["Baseboard serial number"]);
    expect(stores(parsed.roots)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/LenovoDMIStoreTests.swift#LenovoDMIStoreTests.testAStrayLDBGIsNotAStore
  it("does not take a stray LDBG for a store", () => {
    const bytes = image(false);
    bytes.set(
      Uint8Array.from([...testLog([], 0x77), ...new Array<number>(0x2000).fill(0x11)]),
      0x8000
    );
    const parsed = parse(bytes);
    expect(stores(parsed.roots)).toEqual([]);
    expect(parsed.allNodes.some((node) => node.kind === "lenvBlock")).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/GPNVStoreTests.swift#GPNVStoreTests.testTheStoreIsADMIStore
  it("is a DMI store, where the board's identity is", () => {
    expect(allDMIStores(parse(image(true)).roots)).toEqual([
      { kind: "lenovoDMIStore", range: { start: 0x8000, end: 0xc000 } },
    ]);
  });
});
