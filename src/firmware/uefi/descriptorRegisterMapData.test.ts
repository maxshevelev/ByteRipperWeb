import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import {
  decodeRegisterMaps,
  registerMapById,
  registerMapFailure,
} from "@/firmware/uefi/descriptorRegisterMapData";

/**
 * The binary register maps: what the sources state, and what the reader refuses before
 * it interprets a byte.
 */

const bundled = () => fixtureBytes("src/firmware/mapData/data/RegisterMaps.bin").slice();
const expected = MAP_DATA_VERSIONS.register.version;

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

describe("the register map file", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(registerMapFailure()).toBeUndefined();
    const expectedCounts: [string, number, number][] = [
      ["sunrisePoint", 2, 9],
      ["cannonPoint", 4, 34],
      ["tigerPoint", 6, 42],
      ["elkhartLake", 6, 42],
      ["jasperLake", 4, 35],
      ["csme18", 8, 74],
    ];
    for (const [id, registers, fields] of expectedCounts) {
      const map = registerMapById(id);
      expect(map?.registers.length, id).toBe(registers);
      expect(map?.registers.flatMap((one) => one.fields).length, id).toBe(fields);
    }
  });

  // A register's place is the tool's: absolute in the descriptor, at the flash component
  // base or at the flash master base.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testTheRegistersKeepTheirPlaces
  it("keeps the registers' places", () => {
    const eighteen = registerMapById("csme18");
    const named = (name: string) => eighteen?.registers.find((one) => one.name === name);
    expect(named("FLMAP0")?.place).toEqual({ kind: "absolute", offset: 0x14 });
    expect(named("FLMSTR")?.place).toEqual({ kind: "flashMaster", offset: 0 });
    expect(named("FLMSTR")?.words).toBe(6);
    expect(named("FLCOMP")?.place).toEqual({ kind: "flashComponent", offset: 0 });
    const flmap2 = registerMapById("tigerPoint")?.registers.find((one) => one.name === "FLMAP2");
    expect(flmap2?.place).toEqual({ kind: "absolute", offset: 0x1c });
  });

  // Labels and option words are the tool's and survive as text.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testTheFieldsKeepTheirLabelsAndOptions
  it("keeps the fields' labels and options", () => {
    const field = registerMapById("cannonPoint")
      ?.registers.flatMap((one) => one.fields)
      .find((one) => one.options !== undefined);
    expect(field?.label).toBeDefined();
    expect(field?.options?.size).toBeGreaterThan(0);
    const component = registerMapById("csme18")
      ?.registers.flatMap((one) => one.fields)
      .find((one) => one.name === "FLMAP0_Flash_Component_Base_Address");
    expect(component?.bitOffset).toBe(0);
    expect(component?.count).toBe(8);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testAnotherFormatAndKindAreRefused
  it("refuses another format and another kind", () => {
    const data = bundled();
    data[4] = 2;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
    const kind = bundled();
    kind[12] = 1;
    expect(failureOf(() => decodeRegisterMaps(new MapFile(resigned(kind), expected)))).toEqual({
      kind: "wrongKind",
      mapKind: 1,
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DescriptorRegisterMapDataTests.swift#DescriptorRegisterMapDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });
});
