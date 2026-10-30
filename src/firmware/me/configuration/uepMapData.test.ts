import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import { decodeUEPMaps, uepMapById, uepMapFailure } from "@/firmware/me/configuration/uepMapData";

/**
 * The binary UEP layouts: what the sources state, and what the reader refuses before it
 * interprets a byte.
 */

const bundled = () => fixtureBytes("src/firmware/mapData/data/UEPMaps.bin").slice();
const expected = MAP_DATA_VERSIONS.uep.version;

function failureOf(read: () => unknown) {
  try {
    read();
  } catch (error) {
    if (error instanceof MapDataError) return error.failure;
    throw error;
  }
  throw new Error("expected a MapDataError");
}

/** FNV-1a with the checksum field zeroed, as the compiler writes it. */
function resigned(bytes: Uint8Array): Uint8Array {
  bytes.fill(0, 20, 24);
  new DataView(bytes.buffer).setUint32(20, fnv1a32(bytes), true);
  return bytes;
}

function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

describe("the UEP map file", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapDataTests.swift#UEPMapDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(uepMapFailure()).toBeUndefined();
    const counts: [string, number, number, number][] = [
      ["csme12", 42, 8, 0x80],
      ["csme13", 43, 8, 0x80],
      ["csme14", 44, 8, 0x80],
      ["csme15", 56, 0x0c, 0],
      ["csme16", 76, 0x0c, 0],
      ["csme18", 41, 8, 0x80],
    ];
    for (const [id, settings, arrayStart, arraySize] of counts) {
      const map = uepMapById(id);
      expect(map?.settings.length, id).toBe(settings);
      expect(map?.arrayStart, id).toBe(arrayStart);
      expect(map?.arraySize, id).toBe(arraySize);
    }
  });

  // The parts a setting has beyond its place: the tool's label, section, help and option
  // words, and its array when it is not the first.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapDataTests.swift#UEPMapDataTests.testTheSettingsKeepTheirWordsAndPlaces
  it("keeps the settings' words and places", () => {
    const twelve = present(uepMapById("csme12"));
    const vendor = present(twelve.settings.find((one) => one.name === "OemVendorId"));
    expect(vendor.label).toBe("OEM Vendor ID");
    expect(vendor.section).toBe("OEMandPlatformIDs");
    expect(vendor.placement).toEqual({ array: 0, offset: 0x3c, bit: 0, count: 16 });
    const bsmm = present(twelve.settings.find((one) => one.name === "sb_bsmm_svn"));
    expect(bsmm.placement).toEqual({ array: 1, offset: 0x40, bit: 30, count: 15 });

    const eighteen = present(uepMapById("csme18"));
    const profile = present(eighteen.settings.find((one) => one.name === "BTG_PROFILE"));
    expect(profile.label).toBe("Boot Guard Profile");
    expect(profile.options).toEqual(
      new Map([
        [0, "Boot Guard Disabled"],
        [3, "Debug Profile"],
        [4, "Verified Boot"],
        [5, "Verified and Measured Boot"],
      ])
    );
    expect(eighteen.settings.find((one) => one.help !== undefined)).toBeDefined();

    const sixteen = present(uepMapById("csme16"));
    const rpMc = present(sixteen.settings.find((one) => one.name === "RpmcSupported"));
    expect(rpMc.label).toBe("RPMC Supported");
    expect(rpMc.section).toBe("RpmcConfiguration");
    expect(rpMc.placement).toEqual({ array: 0, offset: 0x74, bit: 4, count: 1 });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapDataTests.swift#UEPMapDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => decodeUEPMaps(new MapFile(data, expected)))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapDataTests.swift#UEPMapDataTests.testAnotherFormatAndKindAreRefused
  it("refuses another format and another kind", () => {
    const data = bundled();
    data[4] = 2;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
    const kind = bundled();
    kind[12] = 2;
    expect(failureOf(() => decodeUEPMaps(new MapFile(resigned(kind), expected)))).toEqual({
      kind: "wrongKind",
      mapKind: 2,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/UEPMapDataTests.swift#UEPMapDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });
});
