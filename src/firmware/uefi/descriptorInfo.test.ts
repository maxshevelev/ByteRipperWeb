import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { meDisableBit } from "@/firmware/uefi/descriptorGeneration";
import {
  type DescriptorInfo,
  isProtectedRangeOn,
  mipDbcStraps,
  readDescriptorInfo,
} from "@/firmware/uefi/descriptorInfo";
import { registerMapForGeneration, registerReadings } from "@/firmware/uefi/descriptorRegisterMap";
import { JEDEC_COUNT, jedecChip, jedecCount, jedecName } from "@/firmware/uefi/jedecIds";
import {
  allStrapMaps,
  type DescriptorStrapMap,
  espiClockField,
  isStrapSet,
  legacyStrapTables,
  pmcStrapMap,
  processorStrapMap,
  protectedRangeField,
  sharedStrapMap,
  strapMapForSection,
  strapReadings,
} from "@/firmware/uefi/strapMap";
import { requiredStrapMap } from "@/firmware/uefi/strapMapData";

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
    expect(JEDEC_COUNT).toBe(430);
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

  // The desktop layout puts the two fields in words of its own: Alder Point S's 115-word
  // section keeps the eSPI clock in word 29 and GPR0 in word 28, and what the mobile
  // layout calls GPR0 — word 21 — is neither.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheDesktopLayoutReadsItsOwnWords
  it("reads the desktop layout's own words", () => {
    const words = new Array<number>(115).fill(0);
    words[21] = 0x2222_2222;
    words[28] = 0x001f_8001; // 0x1000–0x1FFFF, both refused
    words[29] = 4 << 3;
    const straps = info(Test.descriptor({ regions: [bios], straps: words })).straps;

    expect(straps?.words).toHaveLength(115);
    expect(straps?.espiClock?.word).toBe(29);
    expect(straps?.espiClock?.clock).toEqual({ code: 4, megahertz: [60] });
    expect(straps?.gpr0?.word).toBe(28);
    expect(straps?.gpr0?.start).toBe(0x1000);
    expect(straps?.gpr0?.end).toBe(0x1_ffff);
    expect(straps?.gpr0 === undefined ? undefined : isProtectedRangeOn(straps.gpr0)).toBe(true);
  });

  // Which layouts the two fields are read on: the length of the section, which is what an
  // image states about it. Tiger Point H's 101 words and Alder Point S's desktop 114 and
  // 115 are layouts of their own.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheStrapFieldsAreKeyedByTheSectionsLength
  it("keys the strap fields by the section's length", () => {
    const clockWord = (words: number) => {
      const map = sharedStrapMap(words);
      return map === undefined ? undefined : espiClockField(map)?.word;
    };
    const rangeWord = (words: number) => {
      const map = sharedStrapMap(words);
      return map === undefined ? undefined : protectedRangeField(map)?.word;
    };
    expect([clockWord(70), rangeWord(70)]).toEqual([22, 21]);
    expect([clockWord(101), rangeWord(101)]).toEqual([20, 19]);
    expect([clockWord(115), rangeWord(115)]).toEqual([29, 28]);
    expect([clockWord(114), rangeWord(114)]).toEqual([26, 25]);
    expect(sharedStrapMap(6)).toBeUndefined();
    // Meteor Lake's 130-word section is the SoC soft-strap block, laid out by MFIT 18's
    // `SoC` document — byte-addressed, so a field's place is the bit range
    // `offset*8 + bit_low … + bit_high`.
    const soc = sharedStrapMap(130) as DescriptorStrapMap;
    expect(soc.fields).toHaveLength(1184);
    const laneReverse = soc.fields.find((field) => field.name === "SoC_Strap_PCIE2_LNREV");
    expect(laneReverse?.word).toBe(6);
    expect([laneReverse?.low, laneReverse?.high]).toEqual([0, 0]);
    expect(laneReverse?.label).toBe("PCIe Controller 3 (Port 9-12)");
    expect(laneReverse?.options).toEqual(
      new Map([
        [0, "1x4"],
        [1, "1x4 Lane Reversed"],
      ])
    );
    expect(laneReverse?.defaultValue).toBeUndefined(); // the SoC values are per reference platform
    expect(espiClockField(soc)).toBeDefined();
    expect(protectedRangeField(soc)).toBeDefined();
  });

  // The section as its fields: every field of the layout, with what this image holds
  // there, in the table's order — and each saying whether the image leaves it at the
  // value Flash Image Tool builds with.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheStrapsAreReadAsTheLayoutsFields
  it("reads the straps as the layout's fields", () => {
    const words = new Array<number>(70).fill(0);
    words[22] = 3 << 3;
    const straps = info(Test.descriptor({ regions: [bios], straps: words, strapCount: 70 })).straps;
    const fields = straps?.fields ?? [];

    const clock = fields.find((one) => one.field.name === "PCH_Strap_SPI_ec_max_freq");
    expect(clock?.value).toBe(3);
    expect([clock?.field.low, clock?.field.high]).toEqual([3, 5]);
    expect(clock === undefined ? undefined : isStrapSet(clock)).toBe(true); // the tool builds this one at 0
    const range = fields.find((one) => one.field.name === "PCH_Strap_SPI_GLOBAL_PROTECTED_RNG_DEF");
    expect(range === undefined ? undefined : isStrapSet(range)).toBe(false); // zero is what the tool builds
    // Every field of the layout is read, not only the ones set, and every word of the
    // section holds fields of the layout.
    expect(fields).toHaveLength(requiredStrapMap("pch70").fields.length);
    expect(new Set(fields.map((one) => one.field.word)).size).toBe(70);
  });

  // The 130-word SoC section reads through its layout: the field names are the tool's,
  // and the values are the image's own.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheSoCStrapSectionIsReadThroughItsLayout
  it("reads the SoC strap section through its layout", () => {
    const words = new Array<number>(130).fill(0);
    words[6] = 1; // PCIe Controller 3, lanes reversed
    words[65] = 3 << 3; // eSPI / EC bus frequency, 50 MHz
    const straps = info(
      Test.descriptor({ regions: [bios], straps: words, strapCount: 130 })
    ).straps;
    const fields = straps?.fields ?? [];
    expect(fields.find((one) => one.field.name === "SoC_Strap_PCIE2_LNREV")?.value).toBe(1);
    expect(fields.find((one) => one.field.name === "SoC_Strap_SPI_ec_max_freq")?.value).toBe(3);
    expect(fields).toHaveLength(requiredStrapMap("pch130").fields.length);
  });

  // A section shorter than the table names the fields still inside it and claims nothing
  // about the words past its end.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAFieldPastTheEndOfASectionIsNotRead
  it("does not read a field past the end of a section", () => {
    const map = requiredStrapMap("pch70");
    const cut = new Array<number>(4).fill(0x1234_5678);
    const readings = strapReadings(map, cut);
    expect(Math.max(...readings.map((one) => one.field.word))).toBe(3);
    expect(readings).toHaveLength(map.fields.filter((field) => field.word < 4).length);
  });

  // What the tables have to be: a name apiece, every field inside the word it belongs
  // to, and no word of the section left unnamed — which is what makes a word's meaning a
  // list of fields rather than a guess.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testEveryStrapWordIsNamedByItsOwnFields
  it("names every strap word by its own fields", () => {
    expect(allStrapMaps().length).toBeGreaterThan(0);
    for (const map of allStrapMaps()) {
      const names = new Set<string>();
      const words = new Set<number>();
      for (const field of map.fields) {
        expect(field.word, field.name).toBeLessThan(map.words);
        expect(field.high, field.name).toBeLessThan(32);
        expect(field.low, field.name).toBeLessThanOrEqual(field.high);
        expect(names.has(field.name), `${field.name} is in one table twice`).toBe(false);
        names.add(field.name);
        words.add(field.word);
      }
      // The SoC block states three 32-bit CSME SMT IDs across a word boundary; FIT 11's
      // 139-word desktop table states no field at all for two of its words.
      const crossing = map.words === 130 ? [41, 46, 51] : map.words === 139 ? [14, 57] : [];
      const unnamed = [...Array(map.words).keys()].filter((word) => !words.has(word));
      expect(unnamed, `every word of the ${map.words}-word section holds fields`).toEqual(crossing);
    }
  });

  // SPT's straps read through FIT 11's tables on a Sunrise Point board and the shared ones
  // elsewhere: 90 words is a PCH section in both sets, and 3 words a processor section in
  // both, without being the same section.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testSPTsTablesAreReadOnItsOwnGeneration
  it("reads SPT's tables on its own generation", () => {
    expect(strapMapForSection(66, "sunrisePoint")?.name).toBe(requiredStrapMap("sptPch66").name);
    expect(strapMapForSection(90, "sunrisePoint")?.name).toBe(requiredStrapMap("sptPch90").name);
    expect(strapMapForSection(90, "cannonPoint")?.name).toBe(requiredStrapMap("pch90").name);
    expect(strapMapForSection(69, "sunrisePoint")).toBeUndefined();
    // A length both sets have is nobody's on an uncertain generation.
    expect(strapMapForSection(90, "cannonPoint", false)).toBeUndefined();
    // An SPT table is read on Sunrise Point alone.
    expect(strapMapForSection(66, "cannonPoint")).toBeUndefined();

    const sptCPU = processorStrapMap(3, "sunrisePoint");
    expect(sptCPU?.name).toBe(requiredStrapMap("sptCpu3").name);
    expect(sptCPU?.fields.some((field) => field.name === "CpuStrapFlexRatio")).toBe(true);
    const sharedCPU = processorStrapMap(3, "cannonPoint");
    expect(sharedCPU?.fields.some((field) => field.name === "CPU_Strap_FlexRatio")).toBe(true);
  });

  // The generations before FIT's documents read the tables written from Intel's SPI
  // Programming Guides: 16 words on Ibex Peak, 18 on Cougar Point and 21 on Lynx Point.
  // The length is only theirs on the generation that states it, and an uncertain
  // generation claims nothing.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheLegacyTablesAreReadOnTheirOwnGenerations
  it("reads the legacy tables on their own generations", () => {
    expect(strapMapForSection(16, "ibexPeak")?.name).toBe(requiredStrapMap("pch16").name);
    expect(strapMapForSection(18, "cougarPoint")?.name).toBe(requiredStrapMap("pch18").name);
    expect(strapMapForSection(21, "lynxPoint")?.name).toBe(requiredStrapMap("pch21").name);
    expect(strapMapForSection(18, "cannonPoint")).toBeUndefined();
    expect(strapMapForSection(18, "cougarPoint", false)).toBeUndefined();
    expect(sharedStrapMap(18)).toBeUndefined();
  });

  // The legacy tables state the guide's fields at the guide's bits, and a word the guide
  // calls reserved is left unnamed rather than guessed at. Lynx Point's own guide is not
  // public: its table carries the Cougar Point fields for the first 18 of its 21 words.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheLegacyTablesNameTheFieldsTheGuidesName
  it("names the fields the guides name in the legacy tables", () => {
    for (const map of legacyStrapTables()) {
      const names = new Set<string>();
      for (const field of map.fields) {
        expect(field.word, field.name).toBeLessThan(map.words);
        expect(field.high, field.name).toBeLessThan(32);
        expect(names.has(field.name), field.name).toBe(false);
        names.add(field.name);
      }
    }
    const cougar = strapMapForSection(18, "cougarPoint") as DescriptorStrapMap;
    const named = (name: string) => cougar.fields.find((field) => field.name === name);
    const smb = named("PCHSTRP0_SMB_EN");
    expect([smb?.low, smb?.high, smb?.options?.get(1), smb?.defaultValue]).toEqual([
      7,
      7,
      "Enabled",
      1,
    ]);
    const bbbs = named("PCHSTRP0_BBBS");
    expect([bbbs?.low, bbbs?.high, bbbs?.options?.get(0), bbbs?.defaultValue]).toEqual([
      29,
      30,
      "64 KB",
      0,
    ]);
    const deepSx = named("PCHSTRP10_Deep_SX_EN");
    expect([deepSx?.word, deepSx?.low, deepSx?.high, deepSx?.defaultValue]).toEqual([
      10, 23, 23, 1,
    ]);
    const profile = named("PCHSTRP10_ICC_PRO_SEL");
    expect([profile?.low, profile?.high, profile?.options?.get(1), profile?.defaultValue]).toEqual([
      22,
      22,
      "Soft strap",
      1,
    ]);
    const cougarWords = new Set(cougar.fields.map((field) => field.word));
    expect([...Array(cougar.words).keys()].filter((word) => !cougarWords.has(word))).toEqual([
      3, 5, 6, 8, 12, 13, 14, 16,
    ]);

    const ibex = requiredStrapMap("pch16");
    expect(ibex.words).toBe(16);
    expect(ibex.fields.some((field) => field.name === "PCHSTRP10_VE_EN")).toBe(true);
    expect(ibex.fields.some((field) => field.name === "PCHSTRP10_Deep_SX_EN")).toBe(false);

    const lynx = requiredStrapMap("pch21");
    expect(lynx.words).toBe(21);
    expect(lynx.fields.some((field) => field.word === 18)).toBe(false);
    expect(lynx.fields.some((field) => field.word === 20)).toBe(false);
    expect(lynx.fields.some((field) => field.name === "PCHSTRP0_SMB_EN")).toBe(true);
    const lynxNamed = (name: string) => lynx.fields.find((field) => field.name === name);
    const lane = lynxNamed("PCHSTRP14_PciePortConfigStrap3");
    expect([lane?.word, lane?.low, lane?.high, lane?.defaultValue]).toEqual([14, 12, 13, 3]);
    const sata3 = lynxNamed("PCHSTRP14_Sata3PcieP6L0Mode");
    expect([sata3?.low, sata3?.high, sata3?.defaultValue]).toEqual([2, 3, 2]);
    const sataMphy = lynxNamed("PCHSTRP19_SataMphyPowerControlDefault");
    expect([sataMphy?.word, sataMphy?.low, sataMphy?.high, sataMphy?.defaultValue]).toEqual([
      19, 1, 1, 0,
    ]);
    const usb3Mphy = lynxNamed("PCHSTRP19_Usb3MphyPowerControlDefault");
    expect([usb3Mphy?.low, usb3Mphy?.high]).toEqual([0, 0]);
  });

  // Three boards' strap words through the tables, as the guide reads them: the MacBook
  // Pro 15 2010 (Ibex Peak), the MacBook Pro 15 2011 (Cougar Point) and the MacBook Air
  // 13 (Lynx Point, 21 words).
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheOldBoardsStrapsReadAsTheGuideSays
  it("reads the old boards' straps as the guide says", () => {
    const values = (map: DescriptorStrapMap | undefined, words: number[]) =>
      new Map(
        strapReadings(map as DescriptorStrapMap, words).map((one) => [one.field.name, one.value])
      );
    const mpb2010 = values(
      strapMapForSection(16, "ibexPeak"),
      [
        0x00205682, 0x0000000f, 0, 0, 0x00c8e000, 0, 0, 0, 0, 0x0000050c, 0x00010044, 0x00000091, 0,
        0, 0x00030000, 0x00000318,
      ]
    );
    expect(mpb2010.get("PCHSTRP0_SMB_EN")).toBe(1);
    expect(mpb2010.get("PCHSTRP0_SML1_EN")).toBe(1);
    expect(mpb2010.get("PCHSTRP0_SMB0FRQ")).toBe(1);
    expect(mpb2010.get("PCHSTRP0_BBBS")).toBe(0);
    expect(mpb2010.get("PCHSTRP4_PHYCON")).toBe(0);
    expect(mpb2010.get("PCHSTRP4_GBEMAC_SMBUS_ADDR")).toBe(0x70);
    expect(mpb2010.get("PCHSTRP4_GBEPHY_SMBUS_ADDR")).toBe(0x64);

    const mpb2011 = values(
      strapMapForSection(18, "cougarPoint"),
      [
        0x0920d682, 0x0000010f, 0, 0, 0x00c8e000, 0, 0, 0, 0, 0x0000058c, 0x00810044, 0x87000089, 0,
        0, 0, 0x0000833e, 0, 2,
      ]
    );
    expect(mpb2011.get("PCHSTRP0_SMB_EN")).toBe(1);
    expect(mpb2011.get("PCHSTRP0_SML0_EN")).toBe(0);
    expect(mpb2011.get("PCHSTRP0_SML1_EN")).toBe(1);
    expect(mpb2011.get("PCHSTRP0_LINKSEC_DIS")).toBe(1);
    expect(mpb2011.get("PCHSTRP0_DMI_REQID_DIS")).toBe(1);
    expect(mpb2011.get("PCHSTRP10_Deep_SX_EN")).toBe(1);
    expect(mpb2011.get("PCHSTRP10_ICC_PRO_SEL")).toBe(0);
    expect(mpb2011.get("PCHSTRP10_ME_BOOT_FLASH")).toBe(0);

    const air2013 = values(
      strapMapForSection(21, "lynxPoint"),
      [
        0x2030d7a0, 0x040001ff, 0, 0, 0x00c8e000, 0, 0, 0, 0, 0x30444480, 0x00c00004, 0x00000089, 0,
        0, 0x592a3d55, 0x0018433e, 0, 2, 0, 0, 0,
      ]
    );
    expect(air2013.get("PCHSTRP0_SMB_EN")).toBe(1);
    expect(air2013.get("PCHSTRP0_SML0_EN")).toBe(1);
    expect(air2013.get("PCHSTRP0_SML1_EN")).toBe(1);
    expect(air2013.get("PCHSTRP0_BBBS")).toBe(1); // 128 KB boot block
    expect(air2013.get("PCHSTRP0_LANPHYPC_GP12_SEL")).toBe(1);
    expect(air2013.get("PCHSTRP10_ICC_PRO_SEL")).toBe(1);
    expect(air2013.get("PCHSTRP10_Deep_SX_EN")).toBe(1);
    // The template's word 14: this board routes all four SATA ports to PCIe port 6
    // lanes, keeps 1x4 port configurations, and leaves the power controls clear.
    expect(air2013.get("PCHSTRP14_PciePortConfigStrap3")).toBe(3);
    expect(air2013.get("PCHSTRP14_PciePortConfigStrap2")).toBe(3);
    expect(air2013.get("PCHSTRP14_Sata0PcieP6L3Mode")).toBe(1);
    expect(air2013.get("PCHSTRP14_Sata1PcieP6L2Mode")).toBe(1);
    expect(air2013.get("PCHSTRP14_Sata2PcieP6L1Mode")).toBe(1);
    expect(air2013.get("PCHSTRP14_Sata3PcieP6L0Mode")).toBe(1);
    expect(air2013.get("PCHSTRP14_PcieNandSelect")).toBe(1);
    expect(air2013.get("PCHSTRP19_SataMphyPowerControlDefault")).toBe(0);
    expect(air2013.get("PCHSTRP19_Usb3MphyPowerControlDefault")).toBe(0);
  });
});

describe("the processor straps, the MIP table and the OEM section", () => {
  // The processor strap section, where the descriptor still holds it: the third map
  // word's base and count, up to Cannon Point.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheProcessorStrapsOfACannonPointBoard
  it("reads the processor straps of a Cannon Point board", () => {
    const read = info(
      Test.descriptor({
        regions: [bios],
        version1: true,
        processorStraps: [0x0000_1000, 0x0010_8002, 0x0800_0210],
      })
    );
    const straps = read.processorStraps;
    expect(straps?.base).toBe(0x300);
    expect(straps?.words).toEqual([0x0000_1000, 0x0010_8002, 0x0800_0210]);
    const boot = straps?.fields?.find(
      (one) => one.field.name === "CPU_Strap_Processor_max_frequency_boot"
    );
    expect(boot?.value).toBe(1);
    // The tool builds this section with the bit set.
    expect(boot === undefined ? undefined : isStrapSet(boot)).toBe(false);
    expect(
      straps?.fields?.find((one) => one.field.name === "CPU_Strap_SaPowerPlaneTopology")?.value
    ).toBe(2);
  });

  // The 11-word processor section is the Ice Lake LP table FIT 12 to 15 carry as
  // `cnp_lp_rvp.xml`.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheElevenWordProcessorSectionHasATable
  it("has a table for the eleven-word processor section", () => {
    const map = processorStrapMap(11);
    expect(map?.words).toBe(11);
    expect(map?.fields).toHaveLength(78);
    expect(map?.fields.some((field) => field.name === "CPU_Strap_FlexRatio")).toBe(true);
    expect(map?.fields.find((field) => field.name === "CPU_Strap_Fast_wakeup")?.defaultValue).toBe(
      1
    );
    expect(processorStrapMap(12)).toBeUndefined(); // no tool at hand states a 12-word section
  });

  // From Tiger Point on the straps are the message in the descriptor's MIP area: at
  // `0xC00` plus the offset the third map word states (`FLMAP2[2:11]`), as many words as
  // `FLMAP2[16:23]` says.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheProcessorStrapsOfATigerPointBoardAreTheMIPMessage
  it("reads a Tiger Point board's processor straps as the MIP message", () => {
    const bytes = Test.descriptor({ regions: [bios], map2: 0x0011_01a0 });
    const base = 0xc00 + 0x68;
    new DataView(bytes.buffer).setUint32(base, 0x0000_1000, true);
    new DataView(bytes.buffer).setUint32(base + 4, 0x0000_0001, true);
    const read = info(bytes);

    expect(read.generation).toBe("tigerPoint");
    expect(read.isGenerationCertain).toBe(true);
    const straps = read.processorStraps;
    expect(straps?.base).toBe(base);
    expect(straps?.words).toHaveLength(17);
    expect(straps?.words[0]).toBe(0x0000_1000);
    const boot = straps?.fields?.find((one) => one.field.name === "CPU_Strap_Fast_wakeup");
    expect(boot?.value).toBe(1);
    expect(boot?.field.label).toBe("Processor Boot at P1 Frequency");
    expect(boot?.field.options?.get(1)).toBe("Yes");
    expect(boot?.field.defaultValue).toBeUndefined(); // the message states no defaults
    expect(boot === undefined ? undefined : isStrapSet(boot)).toBe(false);
  });

  // Cannon Point put a block table in the MIP area: a count, the area's size, then one
  // type/offset/length/reserved entry per block, whose payload follows the table.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheMIPTableNamesItsBlocksAndTheDbCWords
  it("names the MIP table's blocks and the DbC words", () => {
    const bytes = Test.descriptor({ regions: [bios], version1: false });
    const table = 0xc00;
    const view = new DataView(bytes.buffer);
    const put = (value: number, at: number) => view.setUint16(at, value, true);
    put(2, table); // NumberOfDescriptors
    put(0x44, table + 2); // SizeOfMip
    put(1, table + 4); // block 0: PMC and CPU soft straps
    put(0x14, table + 6);
    put(0x28, table + 8);
    put(0, table + 10);
    put(0, table + 12); // block 1: CSE DbC configuration
    put(0x3c, table + 14);
    put(8, table + 16);
    put(0, table + 18);
    // The DbC block's second word: the CSME 12 dump's own, USB3 ports 2, 5 and 6 enabled.
    put(0x0002, table + 0x3c);
    put(0x0002, table + 0x3e);
    put(0x6400, table + 0x40);
    put(0x0000, table + 0x42);

    const read = info(bytes);
    expect(read.generation).toBe("alderPoint");
    const mip = read.mip;
    expect(mip?.base).toBe(table);
    expect(mip?.count).toBe(2);
    expect(mip?.size).toBe(0x44);
    expect(mip?.blocks.map((block) => block.type)).toEqual([1, 0]);
    expect(mip?.blocks.map((block) => block.length)).toEqual([0x28, 8]);
    expect(mip?.blocks[0]?.words).toHaveLength(10);

    const dbc = mip === undefined ? undefined : mipDbcStraps(mip);
    expect(dbc?.base).toBe(table + 0x3c);
    expect(dbc?.words).toEqual([0x0002_0002, 0x0000_6400]);
    const value = (name: string) => dbc?.fields.find((one) => one.field.name.includes(name))?.value;
    expect(value("USB2_DbC_port_enable")).toBe(0);
    expect(value("USB3_DbC_port_enable")).toBe(0x64);
    expect(value("Early_USB_DbC_ME_Boot_Stall_Enable")).toBe(0);
  });

  // The PMC soft straps are the MIP block's leading words: its length less the CPU
  // message `FLMAP2` states. Tiger Point states the message's length in bits 16–23; here
  // 17 words of a 24-word block leave 7 for the PMC section.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testThePMCStrapsAreTheMIPBlockBeforeItsCPUWords
  it("reads the PMC straps as the MIP block before its CPU words", () => {
    const bytes = Test.descriptor({ regions: [bios], map2: 0x0011_01a0 });
    const table = 0xc00;
    const view = new DataView(bytes.buffer);
    const put = (value: number, at: number) => view.setUint16(at, value, true);
    const block1Words = 24; // 17 CPU + 7 PMC
    put(2, table);
    put(124, table + 2);
    put(0, table + 4); // block 0: DbC, 8 bytes
    put(20, table + 6);
    put(8, table + 8);
    put(0, table + 10);
    put(1, table + 12); // block 1: PMC + CPU
    put(28, table + 14);
    put(block1Words * 4, table + 16);
    put(0, table + 18);

    const read = info(bytes);
    expect(read.generation).toBe("tigerPoint");
    expect(read.pmcStraps?.base).toBe(table + 28);
    expect(read.pmcStraps?.words).toHaveLength(7);
    expect(read.pmcStraps?.fields).toHaveLength(135);
    expect(pmcStrapMap(21)).toBeDefined();
    expect(pmcStrapMap(99)).toBeUndefined();
  });

  // The MIP area is erased on Meteor Lake and later, where the map word's high byte means
  // the SoC soft straps: the erased words are no table.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAMeteorLakeDescriptorCarriesNoMIPTable
  it("finds no MIP table on a Meteor Lake descriptor", () => {
    const read = info(Test.descriptor({ regions: [bios], map2: 0x0003_01c0 }));
    expect(read.generation).toBe("meteorLake");
    expect(read.mip).toBeUndefined();
  });

  // From Meteor Lake the descriptor no longer carries the CPU straps: they moved into the
  // FITC partition's MIP table, and the map-word bits that name a Tiger Point message mean
  // the SoC soft straps there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testAMeteorLakeDescriptorCarriesNoProcessorStraps
  it("finds no processor straps on a Meteor Lake descriptor", () => {
    const read = info(Test.descriptor({ regions: [bios], map2: 0x0003_01c0 }));
    expect(read.generation).toBe("meteorLake");
    expect(read.isGenerationCertain).toBe(true);
    expect(read.processorStraps).toBeUndefined();
  });

  // The descriptor's own registers, through Flash Image Tool's layout: the map words at
  // 0x14, the component's at `FCBA << 4`, the recovery policy and the VSCC/MIP map.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheDescriptorRegistersAreReadThroughTheToolsLayout
  it("reads the descriptor registers through the tool's layout", () => {
    const component = { chips: 1, flcomp: 0, flill: 0, flill1: 0 };
    const read = info(Test.descriptor({ regions: [bios], component, map2: 0x0003_01c0 }));
    expect(read.generation).toBe("meteorLake");
    // FLMSTR is absent: the test's master base is 0xFF, out of range.
    expect(read.registerReadings.map((one) => one.register.name)).toEqual([
      "FLMAP0",
      "FLMAP1",
      "FLMAP2",
      "FLCOMP",
      "FLIL",
      "FLDRPLCY",
      "FLUMAP1",
    ]);
    const map0 = read.registerReadings[0];
    expect(map0?.base).toBe(0x14);
    expect(map0?.words).toEqual([0x0004_0003]);
    const fields = new Map(
      (map0 === undefined ? [] : registerReadings(map0)).map((one) => [one.field.name, one.value])
    );
    expect(fields.get("FLMAP0_Flash_Component_Base_Address")).toBe(3);
    expect(fields.get("FLMAP0_Flash_Region_Base_Address")).toBe(4);
    // FLCOMP sits at FCBA << 4, which the map word states.
    expect(read.registerReadings.find((one) => one.register.name === "FLCOMP")?.base).toBe(0x30);
    // The map on an Alder Point descriptor is not this tool's.
    expect(info(Test.descriptor({ regions: [bios] })).registerReadings).toEqual([]);
  });

  // The older generations' maps are the FIT builds' own platform documents, and partial
  // where those documents are. A generation no build states answers nothing rather than
  // another one's bits.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheOlderGenerationsReadTheirFITBuildsRegisters
  it("reads the older generations' registers from their FIT builds", () => {
    const component = { chips: 1, flcomp: 0, flill: 0, flill1: 0 };
    const tiger = info(Test.descriptor({ regions: [bios], component, map2: 0x0011_01a0 }));
    expect(tiger.generation).toBe("tigerPoint");
    // FLMSTR3/5 are absent: the test's master base is 0xFF.
    expect(tiger.registerReadings.map((one) => one.register.name)).toEqual([
      "FLMAP0",
      "FLMAP1",
      "FLMAP2",
      "FLCOMP",
    ]);
    expect(tiger.registerReadings.at(-1)?.base).toBe(0x30); // FLCOMP sits at FCBA << 4
    const map1 = tiger.registerReadings.find((one) => one.register.name === "FLMAP1");
    expect(map1?.base).toBe(0x18);
    const fields = new Map(
      (map1 === undefined ? [] : registerReadings(map1)).map((one) => [one.field.name, one.value])
    );
    expect(fields.get("Flmap1_PCH_Strap_Length")).toBe(0x73);
    expect(fields.get("Flmap1_Flash_Master_Base_Address")).toBe(0xff);

    // The four registers FIT 12–15's CNP documents state.
    expect(registerMapForGeneration("cannonPoint")?.registers.map((one) => one.name)).toEqual([
      "FLMAP0",
      "FLMAP1",
      "FLMAP2",
      "FLCOMP",
    ]);
    expect(registerMapForGeneration("sunrisePoint")?.registers.map((one) => one.name)).toEqual([
      "FLMAP1",
      "FLMAP2",
    ]);
    expect(registerMapForGeneration("alderPoint")).toBeUndefined();
  });

  // The OEM section is the fixed `0x100` bytes at `0xF00`, whatever a board wrote there.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testTheOEMSectionIsTheFixedHundredBytes
  it("reads the OEM section as the fixed 0x100 bytes", () => {
    const bytes = Test.descriptor({ regions: [bios] });
    bytes[0xf00] = 0x4e;
    bytes[0xfff] = 0x45;
    const read = info(bytes);
    expect(read.oemSection).toHaveLength(0x100);
    expect(read.oemSection[0]).toBe(0x4e);
    expect(read.oemSection[0xff]).toBe(0x45);
  });

  // A count of zero, or a base no descriptor has, is no section.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorInfoTests.swift#DescriptorInfoTests.testNoProcessorStrapCountMeansNoSection
  it("has no processor section without a count or a base", () => {
    expect(
      info(Test.descriptor({ regions: [bios], map2: 0x0021_0000 })).processorStraps
    ).toBeUndefined();
    expect(
      info(Test.descriptor({ regions: [bios], map2: 0x0021_01f1 })).processorStraps
    ).toBeUndefined();
  });
});
