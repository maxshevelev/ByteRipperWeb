import { describe, expect, it } from "vitest";
import {
  UEP_FIRST_ARRAY_OFFSET,
  type UEPMap,
  type UEPPlacement,
  type UEPSetting,
  uepMapForME,
  uepReadings,
} from "@/firmware/me/configuration/uepMap";

/**
 * The FPF/UEP settings: the tool's own layout of the `$UEP` area's bit arrays, and
 * reading an image's area through it.
 */

function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

const placement = (array: number, offset: number, bit: number, count: number): UEPPlacement => ({
  array,
  offset,
  bit,
  count,
});

/** A setting as upstream's initialiser defaults it: no words of the tool's own. */
const setting = (name: string, place: UEPPlacement): UEPSetting => ({
  name,
  placement: place,
  label: undefined,
  section: undefined,
  help: undefined,
  options: undefined,
});

/** A map as upstream's initialiser defaults it: the 15/16 array start, no array size. */
const testMap = (
  settings: readonly UEPSetting[],
  arrayStart = UEP_FIRST_ARRAY_OFFSET,
  arraySize = 0
): UEPMap => ({ name: "test", settings, arrayStart, arraySize });

const named = (map: UEPMap, name: string) =>
  present(
    map.settings.find((one) => one.name === name),
    name
  );

/** `$UEP`, the CRC-16 and reserved word, and `arrays` arrays of 0x80 bytes. */
function uepArea(arrays: number): Uint8Array {
  const area = new Uint8Array(8 + arrays * 0x80);
  area.set([0x24, 0x55, 0x45, 0x50]);
  return area;
}

const readingOf = (
  readings: readonly { name: string; value: number }[] | undefined,
  name: string
) => readings?.find((one) => one.name === name)?.value;

describe("the UEP map", () => {
  // The map is the tool's: identifiers, its own names and sections, and the places in the
  // first array — the array the engine reads.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheMapIsTheToolsOwnLayoutOfTheFirstArray
  it("is the tool's own layout of the first array", () => {
    const map = present(uepMapForME(16));
    const rpMc = named(map, "RpmcSupported");
    expect(rpMc.label).toBe("RPMC Supported");
    expect(rpMc.section).toBe("RpmcConfiguration");
    expect(rpMc.placement).toEqual(placement(0, 0x74, 4, 1));
    expect(
      map.settings.every((one) => one.placement.array === 0),
      "a setting the tool places only elsewhere is not in the map"
    ).toBe(true);
    expect(map.settings.length, "16.1.42's first array").toBe(76);
    // What 16.1.42 adds to the array.
    for (const name of [
      "CPU_AAB_ENABLED",
      "PCH_AAB_ENABLED",
      "OEM_CIM_ARB_EN",
      "OEM_PIM_ARB_EN",
      "RpmcOverEc",
    ]) {
      expect(
        map.settings.find((one) => one.name === name),
        name
      ).toBeDefined();
    }

    // Flash Image Tool 15 names the same bits by their identifiers alone.
    const fit = present(uepMapForME(15));
    expect(fit.settings.length).toBeGreaterThan(50);
    expect(fit.settings[0]?.label).toBeUndefined();
    // 12, 13 and 14 have maps too — each FIT build's own platform document — although
    // the profile itself is still a record there.
    expect(uepMapForME(12)).toBeDefined();
    expect(uepMapForME(13)).toBeDefined();
    expect(uepMapForME(14)).toBeDefined();
    expect(uepMapForME(17)).toBeUndefined();
  });

  // CSME 18's map is the tool's rewritten `UEPs_Data`, read from the array that follows
  // its own 8-byte `$UEP` header.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME18MapFollowsTheRewrittenDatabase
  it("follows the rewritten database for CSME 18", () => {
    const map = present(uepMapForME(18));
    expect(map.arrayStart, "the tool's header is signature + CRC-16 + reserved").toBe(8);
    expect(map.arraySize).toBe(0x80);
    expect(map.settings.length).toBe(41);
    const profile = named(map, "BTG_PROFILE");
    expect(profile.placement).toEqual(placement(0, 0x48, 30, 3));
    expect(profile.label).toBe("Boot Guard Profile");
    expect(profile.section).toBe("BootGuardConfiguration");
    expect(profile.options).toEqual(
      new Map([
        [0, "Boot Guard Disabled"],
        [3, "Debug Profile"],
        [4, "Verified Boot"],
        [5, "Verified and Measured Boot"],
      ])
    );
    const kmID = named(map, "KM_ID");
    expect(kmID.placement).toEqual(placement(0, 0x48, 23, 4));
    // The tool's validity bits are named by their identifiers and carry no UI words of
    // their own.
    const idSet = named(map, "OEM_ID_V");
    expect(idSet.label).toBeUndefined();
    expect(idSet.placement).toEqual(placement(0, 0x4c, 6, 1));
    // The tool places some settings in the second array; the map says so rather than
    // dropping them.
    const platformID = named(map, "PLAT_ID");
    expect(platformID.placement).toEqual(placement(1, 0x4, 0, 16));
    expect(platformID.label).toBe("DnX OEM Platform ID");
    expect(map.settings.find((one) => one.name === "ESE_ROM_SVN_EN")).toBeDefined();
    // 15/16 keep to the first array, so size 0 leaves the place as the tool's own
    // offset.
    expect(uepMapForME(16)?.arraySize).toBe(0);
    // The 15/16 array start is the measured one, not a header size.
    expect(uepMapForME(16)?.arrayStart).toBe(UEP_FIRST_ARRAY_OFFSET);
    expect(uepMapForME(17)).toBeUndefined();
  });

  // CSME 12's map is Flash Image Tool 12's CNP `Uep` class: four arrays after its own
  // 8-byte header, with the tool's labels and value words.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME12MapFollowsFlashImageToolsClassDocuments
  it("follows Flash Image Tool's class documents for CSME 12", () => {
    const map = present(uepMapForME(12));
    expect(map.arrayStart, "signature + CRC-16 + reserved").toBe(8);
    expect(map.arraySize).toBe(0x80);
    expect(map.settings.length).toBe(42);
    const vendor = named(map, "OemVendorId");
    expect(vendor.placement).toEqual(placement(0, 0x3c, 0, 16));
    expect(vendor.label).toBe("OEM Vendor ID");
    expect(vendor.section).toBe("OEMandPlatformIDs");
    // The Boot Guard profile proper is a record on this generation; the array holds its
    // individual bits.
    const verified = named(map, "VerifiedBoot");
    expect(verified.placement).toEqual(placement(0, 0x44, 5, 1));
    expect(verified.options).toEqual(
      new Map([
        [0, "false"],
        [1, "true"],
      ])
    );
    // A value class's words: `SupportedFpfValues` is 0xC "No", 0xF "Yes".
    const ptt = named(map, "PttSupportedFpf");
    expect(ptt.options).toEqual(
      new Map([
        [12, "No"],
        [15, "Yes"],
      ])
    );
    // What only a later array holds is kept, once.
    const bsmm = named(map, "sb_bsmm_svn");
    expect(bsmm.placement).toEqual(placement(1, 0x40, 30, 15));
    expect(map.settings.filter((one) => one.name === "sb_bsmm_svn").length).toBe(1);
    // The 256-bit key hash is not a row the reader could fill.
    expect(map.settings.find((one) => one.name === "OemPublicKeyHash")).toBeUndefined();
  });

  // CSME 12's first array reads where the tool places its bits: the word the CSME 12
  // dump carries at array 0 +0x40 is 0x0058E080 — FW_TYPE 3 with its valid bit, and the
  // ID validity bits set.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME12ArrayReadsWhereTheToolPlacesItsBits
  it("reads CSME 12's array where the tool places its bits", () => {
    const map = present(uepMapForME(12));
    const area = uepArea(4); // arrays_count 4
    const word = map.arrayStart + 0x40;
    area[word] = 0x80;
    area[word + 1] = 0xe0;
    area[word + 2] = 0x58;
    const readings = present(uepReadings(area, map));
    expect(readingOf(readings, "lo_id_v")).toBe(1);
    expect(readingOf(readings, "oem_id_v")).toBe(1);
    expect(readingOf(readings, "plat_id_v")).toBe(1);
    expect(readingOf(readings, "fw_type")).toBe(3);
    expect(readingOf(readings, "fw_type_v")).toBe(1);
    expect(readingOf(readings, "OemVendorId")).toBe(0);

    // And the same area as a slice of a larger buffer reads the same.
    const buffer = new Uint8Array(0x100 + area.length).fill(0xa5);
    buffer.set(area, 0x100);
    const fromSlice = present(uepReadings(buffer.subarray(0x100), map));
    expect(fromSlice).toEqual(readings);
  });

  // CSME 13 and 14's maps are their FIT builds' Ice Lake and Comet Lake `Uep` documents,
  // with the profile bits where the four builds of each generation put profiles 0, 3, 4
  // and 5.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME13And14MapsAreTheirPlatformsDocuments
  it("reads CSME 13 and 14 through their platforms' documents", () => {
    const thirteen = present(uepMapForME(13));
    expect(thirteen.settings.length).toBe(43);
    expect(thirteen.arrayStart, "signature + CRC-16 + reserved").toBe(8);
    expect(thirteen.arraySize).toBe(0x80);
    const verified13 = named(thirteen, "VerifiedBoot");
    expect(verified13.placement).toEqual(placement(0, 0x5c, 5, 1));
    expect(verified13.section).toBe("BootGuardProfileSettings");
    expect(verified13.options).toEqual(
      new Map([
        [0, "false"],
        [1, "true"],
      ])
    );
    expect(named(thirteen, "fw_type").placement).toEqual(placement(0, 0x58, 19, 3));

    const fourteen = present(uepMapForME(14));
    expect(fourteen.settings.length).toBe(44);
    const verified14 = named(fourteen, "VerifiedBoot");
    expect(verified14.placement).toEqual(placement(0, 0x44, 5, 1));
    expect(named(fourteen, "fw_type").placement).toEqual(placement(0, 0x40, 19, 3));
  });

  // The four FIT builds of CSME 13's dump differ exactly where the tool says the profile
  // lives: array 0 +0x5C reads 0x40, 0x78, 0x69 and 0x79 — profiles 0, 3, 4 and 5 in the
  // bits the map names.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME13ProfileBitsReadTheBuilds
  it("reads the builds' profile bits for CSME 13", () => {
    const map = present(uepMapForME(13));
    const readings = (byte: number) => {
      const area = uepArea(6); // six arrays
      area[map.arrayStart + 0x5c] = byte;
      return new Map((uepReadings(area, map) ?? []).map((one) => [one.name, one.value]));
    };
    expect(readings(0x40).get("VerifiedBoot")).toBe(0);
    expect(readings(0x40).get("MeasuredBoot")).toBe(0);
    expect(readings(0x78).get("VerifiedBoot")).toBe(1);
    expect(readings(0x78).get("MeasuredBoot")).toBe(1);
    expect(readings(0x69).get("VerifiedBoot")).toBe(1);
    expect(readings(0x69).get("MeasuredBoot")).toBe(0);
    expect(readings(0x79).get("VerifiedBoot")).toBe(1);
    expect(readings(0x79).get("MeasuredBoot")).toBe(1);
    expect(readings(0x79).get("ProtectBiosEnvironment")).toBe(1);
  });

  // The CSME 18 arrays start after the tool's 8-byte header: the profile's bits 30–32 at
  // offset 0x48 read the value the HP dump carries (5), and a setting the tool places in
  // the second array reads the word the dump carries there.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheCSME18ArrayStartsAfterTheToolsHeader
  it("starts CSME 18's arrays after the tool's header", () => {
    const map = present(uepMapForME(18));
    const area = uepArea(4); // arrays_count 4
    const word = map.arrayStart + 0x48;
    area[word + 3] = 0x40; // (5 << 30) little-endian
    area[word + 4] = 0x01;
    // PLAT_ID | DNX | RPMC_RB | PLAT_ID_V | CSE_BOOTSTRAP_SVN_EN | CSE_FW_SVN_EN at
    // array 1, offset 4 — the HP dump's 0x001D0000.
    const second = map.arrayStart + map.arraySize + 0x4;
    area[second + 2] = 0x1d;
    const readings = present(uepReadings(area, map));
    expect(readingOf(readings, "BTG_PROFILE")).toBe(5);
    expect(readingOf(readings, "PLAT_ID")).toBe(0);
    expect(readingOf(readings, "DNX")).toBe(1);
    expect(readingOf(readings, "RPMC_RB")).toBe(0);
    expect(readingOf(readings, "PLAT_ID_V")).toBe(1);
    expect(readingOf(readings, "CSE_BOOTSTRAP_SVN_EN")).toBe(1);
    expect(readingOf(readings, "CSE_FW_SVN_EN")).toBe(1);
    expect(readingOf(readings, "ESE_ROM_SVN_EN")).toBe(0);
    // Read at the 15/16 array start the same bytes are another setting's (and not the
    // profile): the placement is the tool's, not a guess.
    const atTwelve = testMap(map.settings, 0x0c);
    expect(readingOf(uepReadings(area, atTwelve), "BTG_PROFILE")).not.toBe(5);
  });

  // A setting's bits are read little-endian from its offset in the array, which begins
  // 0x0C bytes past the container's signature — where the Boot Guard word sits, too —
  // and a field may run past the word it starts in.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testTheAreasBitsAreReadWhereTheToolPlacesThem
  it("reads the area's bits where the tool places them", () => {
    const area = new Uint8Array(0x0c + 0x20); // the first array after the container
    area.set([0x24, 0x55, 0x45, 0x50]);
    const array = UEP_FIRST_ARRAY_OFFSET;
    // offset 4, bit 4: the word at array+4 = 0x10
    area[array + 4] = 0x10;
    // offset 0, bits 8–11: the word at array = 0x0A00
    area[array] = 0x00;
    area[array + 1] = 0x0a;
    // A field that runs past its word — `sb_bsmm_svn` is 15 bits from bit 30 — is read
    // on across the next byte: 0b1011 from bits 30–33.
    area[array + 3] = 0xc0;
    area[array + 4] = 0x12; // 0x02 for the field
    const map = testMap([
      setting("One", placement(0, 4, 4, 1)),
      setting("Four", placement(0, 0, 8, 4)),
      setting("Pad", placement(0, 2, 0, 1)),
      setting("Across", placement(0, 0, 30, 4)),
    ]);
    expect(uepReadings(area, map)).toEqual([
      { name: "One", value: 1 },
      { name: "Four", value: 0xa },
      { name: "Pad", value: 0 },
      { name: "Across", value: 0b1011 },
    ]);
  });

  // No container, or one too short for a setting's bytes: nothing is claimed, rather
  // than zeros read past the area.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapTests.swift#UEPMapTests.testAnAreaWithoutAContainerAnswersNothing
  it("answers nothing for an area without a container", () => {
    const map = testMap([setting("One", placement(0, 4, 4, 1))]);
    expect(uepReadings(new Uint8Array(0x40).fill(0xff), map)).toBeUndefined();
    const short = new Uint8Array(5 + 0x0c);
    short.set([0x24, 0x55, 0x45, 0x50, 0x43]); // "$UEPC"
    const past = testMap([setting("Past", placement(0, 8, 0, 8))]);
    expect(uepReadings(short, past)).toBeUndefined();
  });
});
