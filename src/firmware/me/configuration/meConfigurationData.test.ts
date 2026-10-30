import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import {
  configurationMapFailure,
  decodeConfigurationMaps,
  meConfigurationMapById,
} from "@/firmware/me/configuration/meConfigurationData";

/**
 * The binary configuration maps: what the sources state, and what the reader refuses
 * before it interprets a byte.
 */

const bundled = () => fixtureBytes("src/firmware/mapData/data/ConfigMaps.bin").slice();
const expected = MAP_DATA_VERSIONS.configuration.version;

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

function required(id: string) {
  const map = meConfigurationMapById(id);
  if (map === undefined) throw new Error(`no map ${id}`);
  return map;
}

describe("the configuration map file", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEConfigurationDataTests.swift#MEConfigurationDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(configurationMapFailure()).toBeUndefined();
    const counts: [string, number, number][] = [
      ["csme11", 43, 82],
      ["csme12", 25, 52],
      ["csme12Desktop", 31, 70],
      ["csme13", 31, 67],
      ["csme13Desktop", 27, 61],
      ["csme14", 31, 71],
      ["csme14Desktop", 27, 65],
      ["csme15", 38, 85],
      ["csme15Desktop", 35, 77],
      ["csme16", 40, 88],
      ["csme18", 32, 67],
    ];
    for (const [id, files, settings] of counts) {
      const map = meConfigurationMapById(id);
      expect(map?.files.length, id).toBe(files);
      expect(map?.files.flatMap((file) => file.settings).length, id).toBe(settings);
    }
  });

  // The parts a setting has beyond its place: the tool's label and help, its options,
  // the bit range, `Auto`, `hex`, `text` and the two conditional marks.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEConfigurationDataTests.swift#MEConfigurationDataTests.testTheSettingsKeepTheirMarks
  it("keeps the settings' marks", () => {
    const settings = required("csme11").files.flatMap((file) => file.settings);
    const withBits = settings.find((one) => one.bits !== undefined);
    expect(withBits?.length).toBeDefined();
    const withOptions = settings.find((one) => one.options !== undefined);
    expect(withOptions?.options?.size).toBeGreaterThan(0);
    expect(settings.find((one) => one.help !== undefined)?.label).toBeDefined();
    const everyMap = [
      "csme11",
      "csme12",
      "csme12Desktop",
      "csme13",
      "csme13Desktop",
      "csme14",
      "csme14Desktop",
      "csme15",
      "csme15Desktop",
      "csme18",
    ]
      .map((id) => meConfigurationMapById(id))
      .flatMap((map) => map?.files.flatMap((file) => file.settings) ?? []);
    expect(everyMap.find((one) => one.condition !== undefined)).toBeDefined();
    expect(everyMap.find((one) => one.disabledBy !== undefined)).toBeDefined();

    const hex = required("csme18")
      .files.flatMap((file) => file.settings)
      .find((one) => one.hex);
    expect(hex, "the 18 map's addresses are hex").toBeDefined();
    const auto = required("csme16")
      .files.flatMap((file) => file.settings)
      .find((one) => one.auto);
    expect(auto, "MFIT marks the settings it works out").toBeDefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEConfigurationDataTests.swift#MEConfigurationDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => decodeConfigurationMaps(new MapFile(data, expected)))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEConfigurationDataTests.swift#MEConfigurationDataTests.testAnotherFormatAndKindAreRefused
  it("refuses another format and another kind", () => {
    const data = bundled();
    data[4] = 2;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
    const kind = bundled();
    kind[12] = 1;
    expect(failureOf(() => decodeConfigurationMaps(new MapFile(resigned(kind), expected)))).toEqual(
      {
        kind: "wrongKind",
        mapKind: 1,
      }
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MEConfigurationDataTests.swift#MEConfigurationDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });
});
