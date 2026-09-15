import { describe, expect, it } from "vitest";
import { tagBytes } from "@/firmware/me/bytes";
import { crc32 } from "@/firmware/me/crypto/checksum";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import { bpdtTable, detectLayoutTable, findBpdt, layoutTable } from "@/firmware/me/layout/ifwi";
import { putU32 } from "@/firmware/me/testing/testMe";

/**
 * The CSE Layout Table, the Boot Partition Descriptor Tables and the Flash
 * Descriptor read that anchors them — upstream's `IFWITests`, built from the
 * layouts its three real oracles confirmed: a 1.6 table on CSME 12, a 1.7 table
 * on CSME 15, and neither on pre-IFWI CSME 11.
 */

const FPT = tagBytes("$FPT");
const BPDT_SIG = Uint8Array.of(0xaa, 0x55, 0x00, 0x00);

/**
 * An erased buffer with a 1.6 Layout Table at 0 whose Data partition starts at
 * 0x1000 and whose first boot partition starts at 0x1100.
 */
function table16(): Uint8Array {
  const bytes = new Uint8Array(0x2000).fill(0xff);
  putU32(bytes, 0x10, 0x1000); // DataOffset
  putU32(bytes, 0x18, 0x1100); // BP1Offset
  bytes.set(FPT, 0x1000);
  bytes.set(BPDT_SIG, 0x1100);
  return bytes;
}

describe("detectLayoutTable", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDetectsIFWI16Table
  it("detects a 1.6 table", () => {
    expect(detectLayoutTable(table16(), 0)).toBe(0x16);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDetectsIFWI17Table
  it("detects a 1.7 table", () => {
    const bytes = table16();
    bytes[0x10] = 0x40; // a 1.7 size field, not a 1.6 DataOffset
    bytes[0x11] = 0x00;
    putU32(bytes, 0x18, 0x1000); // 1.7 puts DataOffset here
    putU32(bytes, 0x20, 0x1100); // and BP1Offset here
    // Reading these bytes as a 1.6 table has to fail first — its DataOffset
    // would be 0x40, which is not a `$FPT` — so detection lands on 1.7.
    expect(detectLayoutTable(bytes, 0)).toBe(0x17);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testNoTableWhenPaddingNotErased
  it("finds no table when the padding is not erased", () => {
    const bytes = table16();
    bytes[0x48] = 0x00; // a real byte in what should be erased padding
    expect(detectLayoutTable(bytes, 0)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testBPDTHeaderIsNotATable
  it("does not take a Boot Partition Descriptor header for a table", () => {
    const bytes = new Uint8Array(0x1000).fill(0xff);
    bytes.set(BPDT_SIG, 0);
    expect(detectLayoutTable(bytes, 0)).toBeUndefined();
  });
});

describe("meRegion", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testMEBaseFromFlashDescriptor
  it("reads the Engine region out of a Flash Descriptor", () => {
    const bytes = new Uint8Array(0x10_0000).fill(0x00);
    bytes.set([0x5a, 0xa5, 0xf0, 0x0f], 0x10);
    bytes[0x14] = 0x03;
    bytes.fill(0xff, 0xc0, 0xd0);
    bytes[0x48] = 0x10; // FLREG2 base 0x10 blocks
    bytes[0x4a] = 0x12; // limit 0x12 blocks

    expect(meRegion(bytes)).toEqual({ base: 0x1_0000, size: 0x3000 });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testNoMEBaseWithoutDescriptor
  it("reads none from something that is not a descriptor", () => {
    expect(meRegion(new Uint8Array(0x1000).fill(0xff))).toBeUndefined();
  });
});

describe("layoutTable", () => {
  /**
   * A 1.6 table whose Data partition is at 0x1000 and whose first boot
   * partition is at 0x1200; the rest of the slots stay erased, which reads as
   * absent.
   */
  function inventory16(): Uint8Array {
    const bytes = new Uint8Array(0x2000).fill(0xff);
    putU32(bytes, 0x10, 0x1000);
    putU32(bytes, 0x14, 0x100);
    putU32(bytes, 0x18, 0x1200);
    putU32(bytes, 0x1c, 0x80);
    bytes.set(FPT, 0x1000);
    bytes.set(BPDT_SIG, 0x1200);
    return bytes;
  }

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDecodesIFWI16Inventory
  it("decodes a 1.6 inventory", () => {
    const layout = layoutTable(inventory16(), 0);

    expect(layout?.version).toBe(0x16);
    expect(layout?.base).toBe(0);
    expect(layout?.redundancy).toBe(false); // 1.6 has no such flag
    expect(layout?.checksumValid).toBeUndefined(); // nor a comparable checksum

    expect(layout?.slots[0]).toMatchObject({
      name: "Data",
      offset: 0x1000,
      size: 0x100,
      empty: false,
    });
    expect(layout?.slots[1]).toMatchObject({ name: "Boot 1", offset: 0x1200, empty: false });
    // The unused slots are still listed — an inventory that hid them would not
    // say how many boot partitions this table has room for.
    expect(layout?.slots.map((one) => one.name)).toEqual([
      "Data",
      "Boot 1",
      "Boot 2",
      "Boot 3",
      "Boot 4",
      "Boot 5",
    ]);
    expect(layout?.slots.slice(2).every((one) => one.empty)).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDecodesIFWI16PartitionOnRegionOffset
  it("measures a table that is not at the region's start from its own base", () => {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(inventory16(), 0x1000);
    const layout = layoutTable(bytes, 0x1000);

    expect(layout?.base).toBe(0x1000);
    expect(layout?.slots[0]).toMatchObject({ offset: 0x2000, empty: false });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testNoLayoutTableWhenNonePresent
  it("finds no table where there is none", () => {
    expect(layoutTable(new Uint8Array(0x2000).fill(0xff), 0)).toBeUndefined();
    expect(layoutTable(new Uint8Array(0x2000).fill(0x00), 0)).toBeUndefined();
  });

  /**
   * A 1.7 table: a size of 0x48, so ELog is declared; the redundancy bit set;
   * and a real checksum over the window the format describes.
   */
  function inventory17(corrupt = false): Uint8Array {
    const bytes = new Uint8Array(0x2000).fill(0xff);
    bytes[0x10] = 0x48; // Size
    bytes[0x11] = 0x00;
    bytes[0x12] = 0x01; // Flags: redundancy
    bytes[0x13] = 0x00;
    putU32(bytes, 0x18, 0x1000);
    putU32(bytes, 0x1c, 0x100);
    putU32(bytes, 0x20, 0x1200);
    putU32(bytes, 0x24, 0x80);
    bytes.set(FPT, 0x1000);
    bytes.set(BPDT_SIG, 0x1200);

    const tail = 0x10 + 0x48 - 0x18;
    const window = new Uint8Array(8 + tail);
    window.set(bytes.subarray(0x10, 0x14));
    window.set(bytes.subarray(0x18, 0x18 + tail), 8);
    putU32(bytes, 0x14, crc32(window) ^ (corrupt ? 1 : 0));
    return bytes;
  }

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDecodesIFWI17InventoryWithChecksum
  it("decodes a 1.7 inventory with its checksum", () => {
    const layout = layoutTable(inventory17(), 0);

    expect(layout?.version).toBe(0x17);
    expect(layout?.redundancy).toBe(true);
    expect(layout?.checksumValid).toBe(true);
    expect(layout?.slots.map((one) => one.name)).toEqual([
      "Data",
      "Boot 1",
      "Boot 2",
      "Boot 3",
      "Boot 4",
      "Boot 5",
      "Temp",
      "ELog",
    ]);
    expect(layout?.slots[0]?.empty).toBe(false);
    expect(layout?.slots[1]?.empty).toBe(false);
    expect(layout?.slots[6]?.empty).toBe(true);
    expect(layout?.slots[7]?.empty).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testReportsInvalidIFWI17Checksum
  it("reports a 1.7 checksum that does not check out", () => {
    const layout = layoutTable(inventory17(true), 0);

    expect(layout?.version).toBe(0x17);
    expect(layout?.checksumValid).toBe(false);
  });
});

describe("the Boot Partition Descriptor Tables", () => {
  /** A 1.7 table: three entries, a real checksum, the redundancy bit set. */
  function bpdt17(corrupt = false): Uint8Array {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(BPDT_SIG, 0);
    bytes[0x04] = 0x03; // three entries
    bytes[0x05] = 0x00;
    bytes[0x06] = 0x02; // version 2, which is IFWI 1.7
    bytes[0x07] = 0x01; // and its redundancy bit
    putU32(bytes, 0x0c, 0);
    putU32(bytes, 0x10, 15); // FitMajor
    putU32(bytes, 0x12, 0);
    putU32(bytes, 0x14, 0x1e);
    putU32(bytes, 0x16, 0x06b4);
    putU32(bytes, 0x18, 1);
    putU32(bytes, 0x1c, 0x1000);
    putU32(bytes, 0x20, 0x100); // RBEP
    putU32(bytes, 0x24, 33);
    putU32(bytes, 0x28, 0x2000);
    putU32(bytes, 0x2c, 0x100); // ISIF
    putU32(bytes, 0x30, 32);
    putU32(bytes, 0x34, 0);
    putU32(bytes, 0x38, 0); // PCHC, absent
    bytes.set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88], 0x1000);
    bytes.set([0xaa, 0x55, 0x00, 0x00, 1, 0, 0, 0], 0x2000);

    const end = 0x18 + 3 * 0x0c;
    const window = new Uint8Array(8 + (end - 0x0c));
    window.set(bytes.subarray(0x04, 0x08));
    window.set(bytes.subarray(0x0c, end), 8);
    putU32(bytes, 0x08, crc32(window) ^ (corrupt ? 1 : 0));
    return bytes;
  }

  /** A 1.6 or 2.0 table: two entries, one of them absent. */
  function bpdt16(): Uint8Array {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(BPDT_SIG, 0);
    bytes[0x04] = 0x02;
    bytes[0x05] = 0x00;
    bytes[0x06] = 0x01; // version 1
    bytes[0x07] = 0x00;
    putU32(bytes, 0x10, 12);
    putU32(bytes, 0x12, 0);
    putU32(bytes, 0x14, 3);
    putU32(bytes, 0x16, 1091);
    putU32(bytes, 0x18, 2);
    putU32(bytes, 0x1c, 0x1000);
    putU32(bytes, 0x20, 0x100); // FTPR
    putU32(bytes, 0x24, 1);
    putU32(bytes, 0x28, 0);
    putU32(bytes, 0x2c, 0); // RBEP, absent
    bytes.fill(0x00, 0x1000, 0x1008);
    return bytes;
  }

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testFirstBpdtFindsHeader
  it("finds a header in a window", () => {
    const bytes = new Uint8Array(0x4000).fill(0xff);
    bytes.set(bpdt17().subarray(0, 0x3c), 0x500);

    expect(findBpdt(bytes, 0, 0x1000)).toBe(0x500);
    expect(findBpdt(new Uint8Array(0x1000).fill(0xff), 0, 0x1000)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDecodesIFWI17BPDT
  it("decodes a 1.7 table", () => {
    const info = bpdtTable(bpdt17(), 0, "Boot 1");

    expect(info?.partitionName).toBe("Boot 1");
    expect(info?.version).toBe(2);
    expect(info?.redundancy).toBe(true);
    expect(info?.checksumValid).toBe(true);
    // The header's own FIT words survive the decode.
    expect(info?.fitMajor).toBe(15);
    expect(info?.fitMinor).toBe(0);
    expect(info?.fitHotfix).toBe(0x1e);
    expect(info?.fitBuild).toBe(0x06b4);
    expect(info?.slots.map((one) => one.name)).toEqual(["RBEP", "ISIF", "PCHC"]);
    expect(info?.slots[0]).toMatchObject({ type: 1, offset: 0x1000, size: 0x100, empty: false });
    expect(info?.slots[1]?.empty).toBe(false);
    expect(info?.slots[2]?.empty).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testReportsInvalidIFWI17BPDTChecksum
  it("reports a 1.7 checksum that does not check out", () => {
    expect(bpdtTable(bpdt17(true), 0, "Boot 1")?.checksumValid).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testDecodesIFWI16BPDT
  it("decodes a 1.6 table", () => {
    const info = bpdtTable(bpdt16(), 0, "Boot 1");

    expect(info?.version).toBe(1);
    expect(info?.redundancy).toBe(false); // there is no config byte on version 1
    expect(info?.checksumValid).toBeUndefined(); // its checksum field is an XOR value
    expect(info?.fitMajor).toBe(12);
    expect(info?.fitMinor).toBe(0);
    expect(info?.fitHotfix).toBe(3);
    expect(info?.fitBuild).toBe(1091);
    expect(info?.slots.map((one) => one.name)).toEqual(["FTPR", "RBEP"]);
    expect(info?.slots[0]).toMatchObject({ offset: 0x1000, empty: false });
    expect(info?.slots[1]?.empty).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testNoFITWhenHeaderFITErased
  it("reads erased FIT words as no FIT at all", () => {
    // The whole quartet goes absent rather than reading back a bogus 65535.
    const bytes = bpdt16();
    bytes.fill(0xff, 0x10, 0x18);
    const info = bpdtTable(bytes, 0, "Boot 1");

    expect(info?.fitMajor).toBeUndefined();
    expect(info?.fitMinor).toBeUndefined();
    expect(info?.fitHotfix).toBeUndefined();
    expect(info?.fitBuild).toBeUndefined();
    expect(info?.version).toBe(1); // and the rest still decodes
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IFWITests.swift#IFWITests.testNoBPDTOnErasedOrTruncated
  it("decodes none from erased bytes or a count that overruns", () => {
    expect(bpdtTable(new Uint8Array(0x4000).fill(0xff), 0, "Boot 1")).toBeUndefined();

    const bytes = bpdt16();
    expect(bpdtTable(bytes, 0, "Boot 1")).toBeDefined();
    bytes[0x04] = 0xff;
    bytes[0x05] = 0xff;
    expect(bpdtTable(bytes, 0, "Boot 1")).toBeUndefined();
  });
});
