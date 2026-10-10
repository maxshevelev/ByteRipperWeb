import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import {
  ACER_MOTHERBOARD_SERIAL,
  ACER_SERIAL,
  ACER_UUID,
  acerBlock,
  putText,
} from "@/firmware/testing/testAcerDMI";
import { flashDeviceMapBytes } from "@/firmware/testing/testFlashDeviceMap";
import { volume, volumeTopFile } from "@/firmware/testing/testImage";
import {
  ACER_DMI_SIGNATURE_OFFSET,
  ACER_DMI_SIZE,
  acerAssetTag,
  acerFindings,
  acerManufacturingCode,
  acerModel,
  acerMotherboardSerial,
  acerProductName,
  acerSystemSerial,
  acerUUID,
  acerUUIDText,
  foundAcerDMIArea,
} from "@/firmware/uefi/acerDmiStore";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { guid } from "@/firmware/uefi/efiGuid";
import { itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * Acer's DMI area (`acerDmiStore.ts`): an 8 KiB block of the machine's identity read out of
 * the padding it lies in. The format is read off the dumps it was surveyed from, so the
 * tests carry a synthetic block that holds the factory patterns.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests
 */

const SIZE = 0x10000;
/** The Insyde flash device map's name for the bytes it carves out of the padding. */
const UNUSED = guid("13C8B020-4F27-453B-8F80-1BFCA187380F");

/** A 64 KiB image with no descriptor: the block at `at`, and a volume ending in the Volume Top File. */
function image(at = 0x8000): Uint8Array {
  const bytes = new Uint8Array(SIZE).fill(0xff);
  bytes.set(acerBlock(), at);
  bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
  return bytes;
}

/** The image above with an Insyde flash device map at `0x4000` that names the block as an "Unused" region. */
function imageWithUnusedMap(at = 0x8000): Uint8Array {
  const bytes = image(at);
  bytes.set(
    flashDeviceMapBytes([{ type: UNUSED, offset: at, size: ACER_DMI_SIZE }], 0x1_0000_0000 - SIZE),
    0x4000
  );
  return bytes;
}

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const stores = (nodes: readonly UEFINode[]) =>
  nodes.flatMap((node) => flattened(node)).filter((node) => node.kind === "acerDMIStore");

describe("Acer's DMI area in the tree", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheBlockIsReadOutOfPadding
  it("reads the block out of the padding it lies in, in place, as one row", () => {
    const parsed = parse(image());
    const found = stores(parsed.roots);
    const store = found[0] as UEFINode;
    expect(found).toHaveLength(1);
    expect(nodeRange(store)).toEqual({ start: 0x8000, end: 0xa000 });
    expect(store.name).toBe("Acer DMI");
    expect(store.isFixed).toBe(true);
    expect(store.children).toEqual([]);
    const outer = (parsed.roots[0] as UEFINode).children.find(
      (node) => nodeRange(node).start <= 0x8000 && 0x8000 < nodeRange(node).end
    ) as UEFINode;
    expect(outer.kind).toBe("padding");
    expect(outer.children.map((child) => child.kind)).toEqual([
      "padding",
      "acerDMIStore",
      "padding",
    ]);
    expect(nodeRange(outer.children[0] as UEFINode).end).toBe(0x8000);
    expect(nodeRange(outer.children[2] as UEFINode).start).toBe(0xa000);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheBlockIsReadOutOfAMapRegion
  it("reads the block out of an Insyde map region that calls it Unused", () => {
    const parsed = parse(imageWithUnusedMap());
    const found = stores(parsed.roots);
    expect(found).toHaveLength(1);
    expect(nodeRange(found[0] as UEFINode)).toEqual({ start: 0x8000, end: 0xa000 });
    expect(found[0]?.name).toBe("Acer DMI");
    const region = parsed.allNodes.find(
      (node) =>
        node.kind === "flashDeviceMapRegion" &&
        nodeRange(node).start === 0x8000 &&
        nodeRange(node).end === 0xa000
    ) as UEFINode;
    expect(region.name).toBe("Unused");
    expect(region.children.map((child) => child.kind)).toEqual(["acerDMIStore"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testAStartNotEightKAlignedIsRead
  it("reads a start that is 4 KiB-aligned but not 8 KiB-aligned", () => {
    const store = stores(parse(image(0x9000)).roots)[0] as UEFINode;
    expect(nodeRange(store)).toEqual({ start: 0x9000, end: 0xb000 });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheStoreClassifiesAsPadding
  it("classifies the store as padding, as a GPNV store is", () => {
    const store = stores(parse(image()).roots)[0] as UEFINode;
    for (const node of flattened(store)) expect(itemType(node), node.kind).toBe(ItemType.padding);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheDMIStoresSeeTheBlock
  it("is seen by the DMI stores wherever it lies", () => {
    expect(allDMIStores(parse(image()).roots)).toEqual([
      { kind: "acerDMIStore", range: { start: 0x8000, end: 0xa000 } },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testAWipedBlockIsNotRead
  it("does not read a wiped block", () => {
    const bytes = image();
    bytes.fill(0xff, 0x8000, 0xa000);
    const parsed = parse(bytes);
    expect(stores(parsed.roots)).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testATamperedBlockIsNotRead
  it("does not read a block that fails one of the checks", () => {
    const mutated = (mutate: (bytes: Uint8Array) => void) => {
      const bytes = image();
      mutate(bytes);
      return stores(parse(bytes).roots);
    };
    const at = 0x8000;
    expect(
      mutated((bytes) => (bytes[at] = 0x58)),
      "the serial is not one"
    ).toEqual([]);
    expect(
      mutated((bytes) => putText(bytes, "MB2TE11000000000003400", at + 0x50)),
      "the motherboard serial is not one"
    ).toEqual([]);
    expect(stores(parse(image(0x9800)).roots), "the start is not aligned").toEqual([]);
    expect(
      mutated((bytes) => (bytes[at + 0x200] = 0x42)),
      "the block is not sparse"
    ).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testABlockThatOverrunsThePaddingIsNotRead
  it("does not read a block that overruns the padding", () => {
    const parsed = parse(image(0xe000));
    expect(stores(parsed.roots)).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("Acer's DMI area's fields", () => {
  const area = (bytes = acerBlock()) => foundAcerDMIArea(bytes, 0x8000);

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheFieldsAreReadOffTheBlock
  it("are read off the block", () => {
    const read = area();
    expect(read).toBeDefined();
    if (read === undefined) return;
    expect(acerSystemSerial(read)).toBe(ACER_SERIAL);
    expect(acerMotherboardSerial(read)).toBe(ACER_MOTHERBOARD_SERIAL);
    expect(Array.from(acerUUID(read))).toEqual([...ACER_UUID]);
    expect(acerUUIDText(read)).toBe("78563412-AB90-1788-89CD-EF0102030405");
    expect(acerModel(read)).toBe("TEST-1050");
    expect(acerProductName(read)).toBe("Test Model");
    expect(acerAssetTag(read)).toBeUndefined();
    expect(acerManufacturingCode(read)).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testTheAssetTagAndTheManufacturingCodeAreReadWhereWritten
  it("read the asset tag and the manufacturing code where written", () => {
    let bytes = acerBlock();
    putText(bytes, "Asset0001", 0xa0);
    putText(bytes, "1234567890123", 0x690);
    let read = area(bytes);
    expect(read && acerAssetTag(read)).toBe("Asset0001");
    expect(read && acerManufacturingCode(read)).toBe("1234567890123");
    bytes = acerBlock();
    putText(bytes, "12345678", 0x6a0); // the later of the two places
    read = area(bytes);
    expect(read && acerManufacturingCode(read)).toBe("12345678");
    bytes = acerBlock();
    putText(bytes, "123", 0x690); // too short to be one
    read = area(bytes);
    expect(read && acerManufacturingCode(read)).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testAFactoryBlockHasNoFindings
  it("has no findings on a factory block", () => {
    expect(acerFindings(area() as NonNullable<ReturnType<typeof area>>)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AcerDMIStoreTests.swift#AcerDMIStoreTests.testWhatAMutatedBlockFinds
  it("finds what a mutated block reads wrong", () => {
    const findings = (mutate: (bytes: Uint8Array) => void) => {
      const bytes = acerBlock();
      mutate(bytes);
      const read = area(bytes);
      if (read === undefined) throw new Error("not found");
      return acerFindings(read);
    };
    expect(findings((bytes) => (bytes[7] = 0x35))).toEqual(["serialPattern"]);
    expect(findings((bytes) => (bytes[0x50 + 5] = 0x32))).toEqual(["motherboardSerialPattern"]);
    expect(findings((bytes) => (bytes[0x70 + 6] = 0x47))).toEqual(["uuidVersion"]);
    expect(findings((bytes) => (bytes[0x70 + 8] = 0x09))).toEqual(["uuidVariant"]);
    expect(findings((bytes) => (bytes[0xf3] = 0x00))).toEqual(["constantWrong"]);
    expect(findings((bytes) => bytes.fill(0xaa, 0x130, 0x136))).toEqual(["tailCopyStale"]);
    expect(
      findings((bytes) => {
        bytes.fill(0xff, 0x128, 0x12e);
        bytes.fill(0xff, 0x130, 0x136);
      })
    ).toEqual(["tailCopyErased"]);
  });

  it("is not found where the signature is not", () => {
    const bytes = acerBlock();
    bytes[ACER_DMI_SIGNATURE_OFFSET] = 0x00;
    expect(area(bytes)).toBeUndefined();
  });
});
