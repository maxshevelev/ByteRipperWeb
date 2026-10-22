import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { volume, volumeTopFile } from "@/firmware/testing/testImage";
import {
  le16,
  le32,
  PANASONIC_KEY,
  PANASONIC_SERIAL,
  panasonicBlock,
  type TestPanasonicRecord,
} from "@/firmware/testing/testPanasonicDMI";
import { dmiFieldTextOf } from "@/firmware/uefi/dmiField";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { itemType } from "@/firmware/uefi/itemClassification";
import {
  panasonicAssetTag,
  panasonicDirectoryChecksum,
  panasonicDirectoryChecksumIsValid,
  panasonicModel,
  panasonicModelCode,
  panasonicProductKey,
  panasonicRecord,
  panasonicRecordChecksumIsValid,
  panasonicSerial,
  readPanasonicDMIArea,
} from "@/firmware/uefi/panasonicDmiStore";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { flattened, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * Panasonic's DMI area (`panasonicDmiStore.ts`): a header, a directory and the records it lists,
 * read out of the padding it lies in. The format is read off dumps of an FZ-55 mk2, a CF-53 mk1
 * and a CF-AX2, so the tests carry a synthetic block of the same shape: short and long record
 * headers, records back to back and with a gap, every part summing to 0, and no real serial or
 * key.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests
 */

const SIZE = 0x10000;
/** Where a 64 KiB chip's file offset 0 is in the CPU's view of it. */
const BASE = 0xffff_0000;

const RECORDS: readonly TestPanasonicRecord[] = [
  { id: 0x02, at: 0x100, length: 0x80, long: false },
  { id: 0x03, at: 0x180, length: 0x40, long: false },
  // Ends at 0x2C8, the next starts at 0x2D0.
  { id: 0x15, at: 0x1c0, length: 0x108, long: true },
  // The next starts right after it.
  { id: 0x16, at: 0x2d0, length: 0x39, long: true },
  { id: 0x1f, at: 0x309, length: 0x107, long: true },
];
const AREA_LENGTH = 0x410;

/** A 64 KiB image with no descriptor: the block at `offset`, and a volume ending in the Volume Top File. */
function image(offset = 0x8000): Uint8Array {
  const bytes = new Uint8Array(SIZE).fill(0xff);
  bytes.set(
    panasonicBlock({
      length: AREA_LENGTH,
      records: RECORDS,
      address: (at) => (BASE + offset + at) >>> 0,
    }),
    offset
  );
  bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
  return bytes;
}

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const stores = (nodes: readonly UEFINode[]) =>
  nodes.flatMap((node) => flattened(node)).filter((node) => node.kind === "panasonicDMIStore");
const areaIn = (bytes: Uint8Array) =>
  readPanasonicDMIArea(0x8000, 0xf000, new ImageReader(sourceOver(bytes)));

describe("Panasonic's DMI area in the tree", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testTheBlockIsReadOutOfPadding
  it("reads the block out of the padding it lies in, in place, as one row", () => {
    const parsed = parse(image());
    const found = stores(parsed.roots);
    const store = found[0] as UEFINode;
    expect(found).toHaveLength(1);
    expect(nodeRange(store)).toEqual({ start: 0x8000, end: 0x8000 + AREA_LENGTH });
    expect(store.name).toBe("Panasonic DMI");
    expect(store.isFixed).toBe(true);
    expect(store.children.map((child) => child.name)).toEqual([
      "Model",
      "Model code",
      "Record 0x02",
      "Record 0x03",
      "Record 0x15",
      "Record 0x16",
      "Record 0x1F",
    ]);
    const records = store.children.filter((child) => child.kind === "panasonicDMIRecord");
    expect(records.map((record) => record.subtype)).toEqual([0x02, 0x03, 0x15, 0x16, 0x1f]);
    expect(records.map((record) => record.header)).toEqual([
      { start: 0x8100, end: 0x8103 },
      { start: 0x8180, end: 0x8183 },
      { start: 0x81c0, end: 0x81c8 },
      { start: 0x82d0, end: 0x82d8 },
      { start: 0x8309, end: 0x8311 },
    ]);
    expect(records.map((record) => nodeRange(record).end)).toEqual([
      0x8180, 0x81c0, 0x82c8, 0x8309, 0x8410,
    ]);
    expect(records.map((record) => record.children.map((child) => child.name))).toEqual([
      ["Asset tag"],
      ["Serial"],
      [],
      ["Windows product key"],
      [],
    ]);
    const outer = (parsed.roots[0] as UEFINode).children.find((child) => {
      const range = nodeRange(child);
      return range.start <= 0x8000 && 0x8000 < range.end;
    }) as UEFINode;
    expect(outer.children.map((child) => child.kind)).toEqual([
      "padding",
      "panasonicDMIStore",
      "padding",
    ]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testTheFieldsAreRead
  it("reads the fields", () => {
    const bytes = image();
    const area = areaIn(bytes);
    if (area === undefined) throw new Error("no area");
    expect(panasonicModel(area)).toBe("FZ55-2");
    expect(panasonicModelCode(area)).toBe("FZ55FZ-52M4");
    expect(panasonicAssetTag(area)).toBe("No Asset Tag");
    expect(panasonicSerial(area), "to the line end").toBe(PANASONIC_SERIAL);
    expect(panasonicProductKey(area)).toBe(PANASONIC_KEY);
    expect(area.records.map((record) => record.headerSize)).toEqual([3, 3, 8, 8, 8]);
    expect(area.headerChecksumIsValid).toBe(true);
    expect(panasonicDirectoryChecksumIsValid(area)).toBe(true);
    expect(area.records.every(panasonicRecordChecksumIsValid)).toBe(true);
    const source = sourceOver(bytes);
    const reader = new ImageReader(source);
    const values = parseUefiImage(source)
      .allNodes.filter((node) => node.kind === "dmiField")
      .map((node) => dmiFieldTextOf(node, reader));
    expect(values).toEqual([
      "FZ55-2",
      "FZ55FZ-52M4",
      "No Asset Tag",
      PANASONIC_SERIAL,
      PANASONIC_KEY,
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testTheStoreClassifiesAsPadding
  it("classifies the store as padding, as UEFITool does", () => {
    const store = stores(parse(image()).roots)[0] as UEFINode;
    for (const node of flattened(store)) expect(itemType(node), node.kind).toBe(ItemType.padding);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testTheDMIStoresSeeTheBlock
  it("is seen by the DMI stores", () => {
    expect(allDMIStores(parse(image()).roots)).toEqual([
      { kind: "panasonicDMIStore", range: { start: 0x8000, end: 0x8000 + AREA_LENGTH } },
    ]);
  });
});

describe("what is not a Panasonic DMI area", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testABrokenChainIsNotRead
  it("does not read a directory whose records do not chain, and leaves no diagnostic", () => {
    const parseWith = (mutate: (bytes: Uint8Array) => void) => {
      const bytes = image();
      mutate(bytes);
      return parse(bytes);
    };
    let parsed = parseWith((bytes) => {
      bytes[0x8180] = 0x50; // record 0x03's length overruns the next
    });
    expect(stores(parsed.roots), "a length that does not end where the next starts").toEqual([]);
    parsed = parseWith((bytes) => bytes.set(le32((BASE + 0x8100) >>> 0), 0x8094));
    expect(stores(parsed.roots), "addresses that do not rise").toEqual([]);
    parsed = parseWith((bytes) => bytes.set(le16(2), 0x8080));
    expect(stores(parsed.roots), "a directory of one").toEqual([]);
    parsed = parseWith((bytes) => {
      bytes[0x8000] = 0x4e; // "NEI_"
    });
    expect(stores(parsed.roots), "no signature").toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testAnUnalignedStartIsNotRead
  it("does not read a start off a 4 KiB boundary", () => {
    expect(stores(parse(image(0x8800)).roots)).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testAKeyThatIsNotOneIsNotAField
  it("does not show a key that does not read as one, but keeps its record", () => {
    const bytes = image();
    bytes[0x82ec + 5] = 0x41; // the first dash
    const area = areaIn(bytes);
    expect(area && panasonicProductKey(area)).toBeUndefined();
    expect(area?.records).toHaveLength(5);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PanasonicDMIStoreTests.swift#PanasonicDMIStoreTests.testAFailingChecksumIsReadAndSaid
  it("reads a block whose checksum fails, and says which and what the byte should be", () => {
    const bytes = image();
    bytes[0x8183 + 1] = 0x58; // the serial's first character, its sum left as it was
    bytes[0x8084] = 0x01; // the directory's reserved word, its sum left as it was
    const area = areaIn(bytes);
    if (area === undefined) throw new Error("no area");
    expect(area.headerChecksumIsValid).toBe(true);
    expect(panasonicDirectoryChecksumIsValid(area)).toBe(false);
    expect(area.expectedDirectoryChecksum).toBe((panasonicDirectoryChecksum(area) - 1) & 0xff);
    const serial = panasonicRecord(area, 0x03);
    if (serial === undefined) throw new Error("no serial");
    expect(panasonicRecordChecksumIsValid(serial)).toBe(false);
    expect(serial.expectedChecksum).toBe((serial.checksum - (0x58 - 0x54)) & 0xff);
    expect(
      area.records.filter((record) => !panasonicRecordChecksumIsValid(record)).map((r) => r.id)
    ).toEqual([0x03]);
  });
});
