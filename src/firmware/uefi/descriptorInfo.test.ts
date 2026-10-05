import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { meDisableBit, strapFields } from "@/firmware/uefi/descriptorGeneration";
import {
  type DescriptorInfo,
  isProtectedRangeOn,
  readDescriptorInfo,
} from "@/firmware/uefi/descriptorInfo";
import { JEDEC_COUNT, jedecChip, jedecCount, jedecName } from "@/firmware/uefi/jedecIds";

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
  it("names the chips the catalogue knows, with their size and source", () => {
    const read = info(Test.descriptor({ regions: [bios], chips: [0x1f4700, 0xef4019, 0x0a0b0c] }));

    expect(read.chips).toEqual([
      { jedecId: 0x1f4700, name: "Atmel AT25DF321", sizeKB: 4096, source: "uefiTool" },
      { jedecId: 0xef4019, name: "Winbond W25Q256", sizeKB: 32768, source: "uefiTool" },
      { jedecId: 0x0a0b0c, name: undefined },
    ]);
  });

  // An id the catalogue does not know still names its maker, from the first
  // byte; a code nobody here knows names nothing, and a named chip carries no
  // vendor of its own.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAnUnlistedChipIsNamedByItsVendor
  it("names an unlisted chip by its vendor", () => {
    const read = info(Test.descriptor({ regions: [bios], chips: [0xef0000, 0xef4019, 0x0a0b0c] }));

    expect(read.chips).toEqual([
      { jedecId: 0xef0000, name: undefined, vendor: "Winbond" },
      { jedecId: 0xef4019, name: "Winbond W25Q256", sizeKB: 32768, source: "uefiTool" },
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

  // The catalogue is the whole of upstream's table, not a truncated read of it:
  // the converter refuses under a hundred, and these are the counts it produced.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheChipCatalogueIsComplete
  it("carries the whole chip catalogue", () => {
    expect(jedecCount("uefiTool")).toBe(185);
    expect(jedecCount("linux")).toBeGreaterThan(50);
    expect(jedecCount("flashrom")).toBeGreaterThan(100);
    expect(JEDEC_COUNT).toBe(429);
    expect(jedecName(0x1c7018)).toBe("EON EN25QH128");
    expect(jedecName(0xc22019)).toBe("Macronix MX25L256");
    expect(jedecName(0x000000)).toBeUndefined();
  });

  // Where several sources know an id, the first names it (UEFITool, Linux,
  // flashrom) and the size is the first any lists, also for an entry named by
  // UEFITool; an id only one source lists carries that source.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheCatalogueKeepsEachEntrysSourceAndSize
  it("keeps each entry's source and size", () => {
    expect(jedecChip(0xef4019)).toEqual({
      name: "Winbond W25Q256",
      sizeKB: 32768,
      source: "uefiTool",
    });
    expect(jedecChip(0xc84017)?.sizeKB).toBe(8192);
    expect(jedecChip(0x207017)).toEqual({
      name: "XMC XM25QH64A",
      sizeKB: 8192,
      source: "linux",
    });
  });
});

describe("the PCH straps", () => {
  // The PCH straps are every word the map counts — `0x73` on this Alder Point layout —
  // read where the map puts them, and HAP is bit 16 of the first.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheStrapsOfAnAlderPointBoardAndItsHAPBit
  it("reads the straps of an Alder Point board and its HAP bit", () => {
    const read = info(Test.descriptor({ regions: [bios], straps: [0x0001_0000, 0x1234_5678] }));
    const straps = read.straps;

    expect(straps?.base).toBe(0x200);
    expect(straps?.words).toHaveLength(0x73);
    expect(straps?.words.slice(0, 3)).toEqual([0x0001_0000, 0x1234_5678, 0xffff_ffff]);
    expect(straps?.meDisable).toEqual({ name: "HAP", word: 0, bit: 16, isSet: true });
  });

  // From Ibex Peak to Wildcat Point the bit is AltMeDisable, bit 7 of the eleventh word —
  // and a first word with bit 16 set says nothing there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testACougarPointBoardsBitIsAltMeDisable
  it("takes AltMeDisable as a Cougar Point board's bit", () => {
    const words = new Array<number>(11).fill(0);
    words[0] = 0x0001_0000;
    const clear = info(Test.descriptor({ regions: [bios], version1: true, straps: words })).straps;
    expect(clear?.words).toHaveLength(0x12);
    expect(clear?.meDisable).toEqual({ name: "AltMeDisable", word: 10, bit: 7, isSet: false });

    words[10] = 0x80;
    const set = info(Test.descriptor({ regions: [bios], version1: true, straps: words })).straps;
    expect(set?.meDisable?.isSet).toBe(true);
  });

  // Which bit, generation by generation: ifdtool's and me_cleaner's, and none where
  // neither names one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheMEDisableBitByGeneration
  it("names the ME disable bit by generation", () => {
    expect(meDisableBit("ich9")?.name).toBe("ICH_MeDisable");
    expect(meDisableBit("ich9")?.bit).toBe(0);
    expect(meDisableBit("lynxPoint")?.word).toBe(10);
    expect(meDisableBit("sunrisePoint")?.name).toBe("HAP");
    expect(meDisableBit("apolloLake")?.name).toBe("HAP");
    expect(meDisableBit("bayTrail")).toBeUndefined();
    expect(meDisableBit("emmitsburg")).toBeUndefined();
  });

  // No strap base, no section — the bytes at offset zero are not straps.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testNoStrapBaseMeansNoStraps
  it("has none without a strap base", () => {
    expect(info(Test.descriptor({ regions: [bios] })).straps).toBeUndefined();
  });

  // A length that runs past the descriptor is cut where the descriptor ends: what
  // follows is the next region, not straps.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheStrapsStopAtTheDescriptorsEnd
  it("stops the straps at the descriptor's end", () => {
    const head = Test.descriptor({ regions: [bios] });
    const bytes = new Uint8Array(head.length + 0x1000);
    bytes.set(head, 0);
    bytes[0x1a] = 0xe0; // FPSBA: 0xE00
    bytes[0x1b] = 0xff; // 255 words claimed
    const straps = info(bytes).straps;

    // 0x200 bytes to the end, four a word.
    expect(straps?.words).toHaveLength(0x80);
  });

  // The seventy-word layout of Tiger and Alder Point mobile: the eSPI clock in bits 3–5
  // of word 22, and GPR0 in word 21 — here as `ifdtool -p adl --gpr0-enable` writes it
  // into `clean_me`: the ME region to the end of its FITC, writes refused.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheESPIClockAndGPR0OfAMobileAlderPointLayout
  it("reads the eSPI clock and GPR0 of a mobile Alder Point layout", () => {
    const words = new Array<number>(23).fill(0);
    words[21] = 0x829b_0001;
    words[22] = 0x0058_0e20;
    const straps = info(Test.descriptor({ regions: [bios], straps: words, strapCount: 70 })).straps;

    expect(straps?.espiClock).toEqual({ word: 22, clock: { code: 4, megahertz: [60] } });
    expect(straps?.gpr0).toEqual({
      word: 21,
      start: 0x1000,
      end: 0x29_bfff,
      readProtected: false,
      writeProtected: true,
    });
    expect(straps?.gpr0 === undefined ? undefined : isProtectedRangeOn(straps.gpr0)).toBe(true);
  });

  // A GPRD of zero is no protection, and a clock code ifdtool's table has no entry for is
  // a code without a clock.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAZeroGPR0IsOffAndAnUnlistedClockIsUnknown
  it("takes a zero GPR0 for off and an unlisted clock for unknown", () => {
    const words = new Array<number>(23).fill(0);
    words[22] = 6 << 3;
    const straps = info(Test.descriptor({ regions: [bios], straps: words, strapCount: 70 })).straps;

    expect(straps?.gpr0 === undefined ? undefined : isProtectedRangeOn(straps.gpr0)).toBe(false);
    expect(straps?.espiClock?.clock).toEqual({ code: 6, megahertz: undefined });
  });

  // The desktop layout puts other fields in the same words, so nothing is read from them:
  // Alder Point S's 115 words have no eSPI clock or GPR0.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheDesktopLayoutReadsNeither
  it("reads neither field on the desktop layout", () => {
    const words = new Array<number>(23).fill(0);
    words[21] = 0x2222_2222;
    const straps = info(Test.descriptor({ regions: [bios], straps: words })).straps;

    expect(straps?.words).toHaveLength(0x73);
    expect(straps?.espiClock).toBeUndefined();
    expect(straps?.gpr0).toBeUndefined();
  });

  // Which layouts the two fields are read on: generation and length both.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheStrapFieldsAreKeyedByGenerationAndLength
  it("keys the strap fields by generation and length", () => {
    expect(strapFields("tigerPoint", 70)?.gpr0Word).toBe(21);
    expect(strapFields("alderPoint", 70)?.espiClockWord).toBe(22);
    expect(strapFields("tigerPoint", 101)).toBeUndefined(); // Tiger Point H
    expect(strapFields("alderPoint", 115)).toBeUndefined(); // Alder Point S
    expect(strapFields("cannonPoint", 69)).toBeUndefined(); // GPR0 is in the ME region's FITC
  });
});
