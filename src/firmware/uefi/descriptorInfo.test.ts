import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { type DescriptorInfo, readDescriptorInfo } from "@/firmware/uefi/descriptorInfo";
import { JEDEC_COUNT, jedecName } from "@/firmware/uefi/jedecIds";

/**
 * Ported from `DescriptorInfoTests.swift`: what a flash descriptor says about
 * itself beyond its map.
 */

const info = (bytes: Uint8Array): DescriptorInfo =>
  readDescriptorInfo(0, new ImageReader(sourceOver(bytes))) as DescriptorInfo;
const bios = { type: "bios" as const, start: 0x1000, end: 0x40_0000 };

describe("a descriptor's own header", () => {
  // On a real board these bytes are the first instruction the chip executes, so
  // they are shown rather than skipped.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheReservedVectorIsReadWhole
  it("reads the reserved vector whole", () => {
    const vector = Uint8Array.of(
      0x11,
      0x00,
      0x00,
      0x9c,
      0x90,
      0x02,
      0x00,
      0xd6,
      0x00,
      0x00,
      0x00,
      0x05,
      0xff,
      0xff,
      0xff,
      0xff
    );
    const read = info(
      Test.descriptor({
        regions: [{ type: "bios", start: 0x60_0000, end: 0x100_0000 }],
        reservedVector: vector,
      })
    );

    expect([...read.reservedVector]).toEqual([...vector]);
  });

  // Every region the table declares, where it begins and where it ends — the
  // descriptor's own first, which the format states rather than stores.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testEachDeclaredRegionIsReadWithItsLimit
  it("reads each declared region with its limit", () => {
    const read = info(
      Test.descriptor({
        regions: [
          { type: "me", start: 0x1000, end: 0x60_0000 },
          { type: "bios", start: 0x60_0000, end: 0x100_0000 },
        ],
      })
    );

    expect(read.regions).toEqual([
      { type: "descriptor", base: 0, limit: 0xfff },
      { type: "bios", base: 0x60_0000, limit: 0xff_ffff },
      { type: "me", base: 0x1000, limit: 0x5f_ffff },
    ]);
  });

  // A region with a zero limit is not there at all, and is left out rather than
  // shown as an area at offset zero.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAnAbsentRegionIsNotListed
  it("leaves an absent region out", () => {
    const read = info(Test.descriptor({ regions: [bios] }));
    expect(read.regions.map((one) => one.type)).toEqual(["descriptor", "bios"]);
  });

  // The generation the layout is goes with the rest.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheGenerationIsRead
  it("reads the generation with the rest", () => {
    const alder = info(Test.descriptor({ regions: [bios] }));
    expect(alder.generation).toBe("alderPoint");
    expect(alder.isGenerationCertain).toBe(true);
    const cougar = info(Test.descriptor({ regions: [bios], version1: true }));
    expect(cougar.generation).toBe("cougarPoint");
  });
});

describe("the component section", () => {
  // Two chips of four-bit density, the clocks in Alder Point's codes, and eight
  // forbidden opcodes — `CSME 16`'s component section.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheComponentSectionOfAnAlderPointBoard
  it("reads an Alder Point board's two chips, clocks and eight opcodes", () => {
    const read = info(
      Test.descriptor({
        regions: [bios],
        component: { chips: 2, flcomp: 0x0930_f054, flill: 0xad60_4221, flill1: 0xc7c4_b9b7 },
      })
    );
    const component = read.component;

    expect(component?.chipSizes).toEqual([0x80_0000, 0x100_0000]); // 8 MB, then 16 MB
    expect(component?.readIDClock).toEqual({ code: 1, megahertz: [50] });
    expect(component?.writeEraseClock.megahertz).toEqual([50]);
    expect(component?.fastReadClock?.megahertz).toEqual([50]);
    expect(component?.invalidInstructions).toEqual([
      0x21, 0x42, 0x60, 0xad, 0xb7, 0xb9, 0xc4, 0xc7,
    ]);
  });

  // One chip whose density is three bits, Cougar Point's clock codes, and a
  // single word of opcodes — the next being the partition boundary.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheComponentSectionOfACougarPointBoard
  it("reads a Cougar Point board's one chip of three-bit density and one word of opcodes", () => {
    const read = info(
      Test.descriptor({
        regions: [bios],
        version1: true,
        component: { chips: 1, flcomp: 0x6490_0024, flill: 0, flill1: 0x1234_5678 },
      })
    );
    const component = read.component;

    // Code 4 in the low three bits; the second chip is not counted.
    expect(component?.chipSizes).toEqual([0x80_0000]);
    expect(component?.readIDClock.megahertz).toEqual([50]);
    expect(component?.fastReadClock?.megahertz).toEqual([50]);
    // No opcode is forbidden, and the boundary is not one.
    expect(component?.invalidInstructions).toEqual([]);
  });

  // Fast reads switched off have no clock; a code the generation reserves is
  // kept as the code; a density past the largest is no size.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testWhatAComponentSectionDoesNotSay
  it("keeps what a component section does not say as nothing", () => {
    // Density 0xE, read-ID code 2 (reserved on Alder Point), fast read off.
    const read = info(
      Test.descriptor({
        regions: [bios],
        component: { chips: 1, flcomp: 0x1100_000e, flill: 0, flill1: 0 },
      })
    );
    const component = read.component;

    expect(component?.chipSizes).toEqual([undefined]);
    expect(component?.readIDClock).toEqual({ code: 2, megahertz: undefined });
    expect(component?.fastReadClock).toBeUndefined();
  });

  // No component base, no section — not one read from offset zero.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testNoComponentBaseMeansNoComponentSection
  it("has no section where the map names no base", () => {
    expect(info(Test.descriptor({ regions: [bios] })).component).toBeUndefined();
  });
});

describe("the master section", () => {
  // A version 1 descriptor keeps a byte of read and a byte of write per master,
  // in records of four.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAVersion1DescriptorReadsItsThreeMastersAsBytes
  it("reads three masters as bytes on a version 1 descriptor", () => {
    const read = info(
      Test.descriptor({
        regions: [bios],
        version1: true,
        masters: [
          { read: 0xa0, write: 0x00 },
          { read: 0x40, write: 0x00 },
          { read: 0x80, write: 0x00 },
        ],
      })
    );

    expect(read.masters).toEqual([
      { name: "BIOS", read: 0xa0, write: 0x00 },
      { name: "ME", read: 0x40, write: 0x00 },
      { name: "GbE", read: 0x80, write: 0x00 },
    ]);
    expect(read.maskDigits).toBe(2); // a byte is two hex digits
  });

  // A version 2 descriptor packs twelve bits of each into one dword, and has an
  // EC master the older one does not.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAVersion2DescriptorReadsTwelveBitMasksAndTheECMaster
  it("reads twelve-bit masks and the EC master on a version 2", () => {
    const read = info(
      Test.descriptor({
        regions: [bios],
        masters: [
          { read: 0xfff, write: 0xfff },
          { read: 0x0d8, write: 0x0d8 },
          { read: 0x008, write: 0x008 },
          { read: 0x100, write: 0x100 },
        ],
      })
    );

    expect(read.masters.map((one) => one.name)).toEqual(["BIOS", "ME", "GbE", "EC"]);
    expect(read.masters[0]).toEqual({ name: "BIOS", read: 0xfff, write: 0xfff });
    expect(read.masters.at(-1)).toEqual({ name: "EC", read: 0x100, write: 0x100 });
    expect(read.maskDigits).toBe(3); // twelve bits is three
  });
});

/**
 * The table a bench actually reads: what the BIOS master may do to each region.
 * Its own region is stated rather than read — it owns it — and every other row
 * is a bit out of its two masks.
 */
describe("the BIOS access table", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheBiosAccessTableIsReadOffTheBiosMasksOwnBits
  it("is read off the BIOS master's own bits", () => {
    // Read: descriptor + BIOS + ME. Write: BIOS only.
    const read = info(
      Test.descriptor({
        regions: [bios],
        version1: true,
        masters: [
          { read: 0x07, write: 0x02 },
          { read: 0, write: 0 },
          { read: 0, write: 0 },
        ],
      })
    );

    expect(read.biosAccess).toEqual([
      { region: "Desc", read: true, write: false },
      { region: "BIOS", read: true, write: true },
      { region: "ME", read: true, write: false },
      { region: "GbE", read: false, write: false },
      { region: "PDR", read: false, write: false },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAVersion2AccessTableHasAnECRow
  it("has an EC row on a version 2 descriptor", () => {
    const read = info(Test.descriptor({ regions: [bios], masters: [{ read: 0x20, write: 0x20 }] }));

    expect(read.biosAccess.map((one) => one.region)).toEqual([
      "Desc",
      "BIOS",
      "ME",
      "GbE",
      "PDR",
      "EC",
    ]);
    expect(read.biosAccess.at(-1)).toEqual({ region: "EC", read: true, write: true });
  });
});

describe("the VSCC table", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheVsccTableIsReadAndItsChipsNamed
  it("names the chips the catalogue knows", () => {
    const read = info(Test.descriptor({ regions: [bios], chips: [0x1f4700, 0xef4019, 0x0a0b0c] }));

    expect(read.chips).toEqual([
      { jedecId: 0x1f4700, name: "Atmel AT25DF321" },
      { jedecId: 0xef4019, name: "Winbond W25Q256" },
      { jedecId: 0x0a0b0c, name: undefined },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAnErasedVsccEntryIsNotAChip
  it("does not make a chip out of an erased entry", () => {
    const read = info(Test.descriptor({ regions: [bios], chips: [0xef4019, 0xffffff, 0x000000] }));
    expect(read.chips.map((one) => one.jedecId)).toEqual([0xef4019]);
  });

  // A descriptor with no table at all says so by having none, rather than by
  // inventing one out of whatever is at the offset a zero base points to.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testNoVsccTableMeansNoChips
  it("has no chips when there is no table", () => {
    const read = info(Test.descriptor({ regions: [bios] }));
    expect(read.chips).toEqual([]);
    expect(read.masters).toEqual([]);
  });

  // The catalogue is the whole of upstream's table, not a truncated read of it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheChipCatalogueIsComplete
  it("carries the whole chip catalogue", () => {
    expect(JEDEC_COUNT).toBe(185);
    expect(jedecName(0x1c7018)).toBe("EON EN25QH128");
    expect(jedecName(0xc22019)).toBe("Macronix MX25L256");
    expect(jedecName(0x000000)).toBeUndefined();
  });
});
