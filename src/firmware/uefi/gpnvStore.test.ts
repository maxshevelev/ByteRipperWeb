import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { guid } from "@/firmware/uefi/efiGuid";
import { gpnvProductKey, gpnvTexts, readGPNVRecord } from "@/firmware/uefi/gpnvStore";
import { itemType } from "@/firmware/uefi/itemClassification";
import { supersededCopies } from "@/firmware/uefi/nvramVariableHistory";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * AMI's GPNV store (`GPNVRecord`): read where ASUS puts it — after the free space of a
 * volume of its own, and in padding — as a row with a row per record, and nowhere else.
 */

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** A record as the dumps lay one out: 0x100 bytes of data, FF where nothing is written. */
function record(
  name: string,
  current: boolean,
  data: Uint8Array = new Uint8Array(0),
  length = 0x10c
) {
  const bytes = new Uint8Array(length).fill(0xff);
  bytes.set(ascii("GPNV"), 0);
  bytes[4] = length & 0xff;
  bytes[5] = length >> 8;
  bytes[6] = current ? 1 : 0;
  bytes.set(ascii(name), 7);
  bytes[11] = 0;
  bytes.set(data, 12);
  return bytes;
}

function msdm(key: string): Uint8Array {
  const bytes = new Uint8Array(0x14 + key.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(8, 1, true);
  view.setUint32(0x10, key.length, true);
  bytes.set(ascii(key), 0x14);
  return bytes;
}

const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const records = () =>
  concat(
    record("MFG0", false, ascii("M8NRKD00311031C")),
    record("OA30", true, msdm("AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")),
    record("MFG0", true, ascii("M8NRKD00311031C"))
  );

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));

describe("a GPNV store", () => {
  // The AMD board's layout: a volume holding no files, free space where the first file
  // would be, and the store after it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/GPNVStoreTests.swift#GPNVStoreTests.testAStoreAfterAVolumesFreeSpaceIsItsData
  it("after a volume's free space is its data", () => {
    const gpnv = Test.volume({
      length: 0x1000,
      extendedHeader: guid("3F8E4F19-8523-407F-8ACB-C562F5A36D35"),
      trailing: concat(new Uint8Array(0x78 - 0x5c).fill(0xff), records()),
    });
    const parsed = parse(gpnv);

    const store = parsed.allNodes.find((node) => node.kind === "gpnvStore");
    expect(store && [store.header.start, store.body.end]).toEqual([0x78, 0x78 + 3 * 0x10c]);
    expect(store && itemType(store)).toBe(ItemType.padding);
    expect(store?.children.map((node) => node.name)).toEqual(["MFG0", "OA30", "MFG0"]);
    // The record in force, and the one it replaced.
    expect(store?.children.map((node) => node.subtype)).toEqual([0, 1, 1]);
    expect(store?.children[0]?.header).toEqual({ start: 0x78, end: 0x84 });
    expect(store?.children[0]?.body).toEqual({ start: 0x84, end: 0x184 });
    expect(
      parsed.allNodes.some(
        (node) => node.kind === "nonUEFIData" && node.children.includes(store as never)
      )
    ).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The Intel board's: in the padding after NVRAM, on a 4 KiB boundary.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/GPNVStoreTests.swift#GPNVStoreTests.testAStoreInPaddingIsReadOutOfIt
  it("in padding is read out of it", () => {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(Test.volume({ length: 0x1000 }), 0);
    bytes.set(records(), 0x2000);
    const parsed = parse(bytes);

    const store = parsed.allNodes.find((node) => node.kind === "gpnvStore");
    expect(store && [store.header.start, store.body.end]).toEqual([0x2000, 0x2000 + 3 * 0x10c]);
    const padding = parsed.allNodes.find(
      (node) => node.kind === "padding" && node.children.some((child) => child.kind === "gpnvStore")
    );
    expect(padding && [padding.header.start, padding.body.end]).toEqual([0x1000, 0x4000]);
    expect(padding?.children.map((node) => node.kind)).toEqual(["padding", "gpnvStore", "padding"]);
  });

  // A header that is nearly one — a state that is neither, a length past the end — is not
  // a store, and nothing is said about it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/GPNVStoreTests.swift#GPNVStoreTests.testANearMissIsNoStore
  it("is none when the header is nearly one", () => {
    const state = record("MFG0", true);
    state[6] = 2;
    const long = record("MFG0", true);
    const over = (bytes: Uint8Array, limit: number) =>
      readGPNVRecord(0, limit, new ImageReader(sourceOver(bytes)));
    expect(over(state, state.length)).toBeUndefined();
    expect(over(long, long.length - 1)).toBeUndefined();
    const image = new Uint8Array(0x4000).fill(0xff);
    image.set(Test.volume({ length: 0x1000 }), 0);
    image.set(state, 0x2000);
    expect(parse(image).allNodes.some((node) => node.kind === "gpnvStore")).toBe(false);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/GPNVStoreTests.swift#GPNVStoreTests.testTheWindowsKeyAndTheTextsAreRead
  it("reads the Windows key and the texts", () => {
    expect(gpnvProductKey(msdm("AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"))).toBe(
      "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"
    );
    expect(gpnvProductKey(new Uint8Array(0x100).fill(0xff))).toBeUndefined();

    const body = concat(
      ascii("M8NRKD"),
      Uint8Array.of(0xff, 0xff, 0x41, 0xff),
      ascii("90NR0551 "),
      Uint8Array.of(0)
    );
    expect(gpnvTexts(body).map((one) => one.offset)).toEqual([0, 10]);
    expect(gpnvTexts(body).map((one) => one.text)).toEqual(["M8NRKD", "90NR0551"]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/GPNVDisplayTests.swift#GPNVDisplayTests.testASupersededRecordIsACopyTheTreeCanLeaveOut
  it("has a superseded record that is a copy the tree can leave out", () => {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(records(), 0);
    const parsed = parse(bytes);
    const store = parsed.allNodes.find((node) => node.kind === "gpnvStore");
    const reader = new ImageReader(sourceOver(bytes));
    const hidden = store === undefined ? undefined : supersededCopies(store, reader);
    expect(store && hidden?.get((store.children[0]?.id ?? []).join("."))).toEqual(
      store?.children[2]?.id
    );
  });
});
