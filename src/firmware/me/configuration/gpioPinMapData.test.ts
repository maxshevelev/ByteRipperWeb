import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import {
  decodeGPIOPinMaps,
  gpioPinMapById,
  gpioPinMapFailure,
} from "@/firmware/me/configuration/gpioPinMapData";

/**
 * The binary GPIO pin dictionaries: what the sources state, and what the reader refuses
 * before it interprets a byte.
 */

const bundled = () => fixtureBytes("src/firmware/mapData/data/GPIOMaps.bin").slice();
const expected = MAP_DATA_VERSIONS.gpio.version;

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

describe("the GPIO pin map file", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinMapDataTests.swift#GPIOPinMapDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(gpioPinMapFailure()).toBeUndefined();
    const counts: [string, number, number, number, number, number][] = [
      ["csme11", 0, 14, 4, 5, 11],
      ["csme12", 5, 18, 4, 5, 12],
      ["csme13", 5, 18, 4, 5, 12],
      ["csme14", 5, 18, 4, 5, 12],
      ["csme15", 6, 44, 4, 5, 12],
    ];
    for (const [id, features, usages, ownerships, padModes, groups] of counts) {
      const map = gpioPinMapById(id);
      expect(map?.features.size, id).toBe(features);
      expect(map?.usages.size, id).toBe(usages);
      expect(map?.ownerships.size, id).toBe(ownerships);
      expect(map?.padModes.size, id).toBe(padModes);
      expect(map?.groups.size, id).toBe(groups);
    }
  });

  // The words the maps are asked for, and the numbers the tool's documents disagree
  // about — kept absent rather than guessed at.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinMapDataTests.swift#GPIOPinMapDataTests.testTheDictionariesKeepTheToolsWords
  it("keeps the tool's words in the dictionaries", () => {
    const eleven = present(gpioPinMapById("csme11"));
    expect(eleven.usages.get(0)).toBe("NFC_RST");
    expect(eleven.usages.get(8)).toBe("FWUPDATE");
    expect(eleven.ownerships.get(1)).toBe("CSME_MODE");
    expect(eleven.padModes.get(4)).toBe("DEFAULT_MODE");
    expect(eleven.groups.get(4)).toBe("GPP_E");
    expect(eleven.groups.get(0xff)).toBe("NONE");

    const twelve = present(gpioPinMapById("csme12"));
    expect(twelve.features.get(1)).toBe("GPIO_TOUCH_FEATURE_ID");
    expect(twelve.usages.get(5)).toBe("CPU_DETECTION");
    expect(twelve.usages.get(12)).toBe("SMT_SMLINK1_CLK");
    expect(twelve.groups.get(9), "GPP_J and GPD both take 9").toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinMapDataTests.swift#GPIOPinMapDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => decodeGPIOPinMaps(new MapFile(data, expected)))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinMapDataTests.swift#GPIOPinMapDataTests.testAnotherFormatAndKindAreRefused
  it("refuses another format and another kind", () => {
    const data = bundled();
    data[4] = 2;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
    const kind = bundled();
    kind[12] = 1;
    expect(failureOf(() => decodeGPIOPinMaps(new MapFile(resigned(kind), expected)))).toEqual({
      kind: "wrongKind",
      mapKind: 1,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GPIOPinMapDataTests.swift#GPIOPinMapDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });
});
