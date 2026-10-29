import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import {
  cpuStrapMaps,
  decodeStrapMaps,
  legacyStrapMaps,
  mipStrapMaps,
  pchStrapMaps,
  pmcStrapMaps,
  requiredStrapMap,
  sptCPUStrapMaps,
  sptStrapMaps,
  strapMapById,
  strapMapFailure,
} from "@/firmware/uefi/strapMapData";

/**
 * The binary strap tables: what the sources state, and what the reader refuses before
 * it interprets a byte.
 */

const bundled = () => fixtureBytes("src/firmware/mapData/data/StrapMaps.bin");
const expected = MAP_DATA_VERSIONS.strap.version;

function failureOf(read: () => unknown) {
  try {
    read();
  } catch (error) {
    if (error instanceof MapDataError) return error.failure;
    throw error;
  }
  throw new Error("expected a MapDataError");
}

describe("the strap map file", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(strapMapFailure()).toBeUndefined();
    const words = (maps: { words: number }[]) => maps.map((map) => map.words);
    expect(words(pchStrapMaps())).toEqual([69, 70, 74, 90, 101, 114, 115, 130]);
    expect(words(sptStrapMaps())).toEqual([66, 88, 90, 139]);
    expect(words(cpuStrapMaps())).toEqual([1, 3, 7, 10, 14, 15, 17, 18, 20, 21, 22, 25, 11]);
    expect(words(sptCPUStrapMaps())).toEqual([3]);
    expect(words(pmcStrapMaps())).toEqual([7, 20, 21, 22]);
    expect(words(mipStrapMaps())).toEqual([17, 20]);
    expect(words(legacyStrapMaps())).toEqual([16, 18, 21]);
    expect(strapMapById("pch115")?.words).toBe(115);
    expect(strapMapById("sptPch139")?.words).toBe(139);
    expect(strapMapById("cpu11")?.words).toBe(11);
  });

  // The field counts are the sources': a table that lost or gained entries in a rebuild
  // is a changed layout, not a smaller file.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testTheTablesCarryTheFieldsTheSourcesState
  it("carries the fields the sources state", () => {
    const counts: Record<string, number> = {
      pch69: 737,
      pch70: 759,
      pch74: 786,
      pch90: 755,
      pch101: 901,
      pch114: 1212,
      pch115: 1201,
      pch130: 1184,
      sptPch66: 559,
      sptPch88: 664,
      sptPch90: 733,
      sptPch139: 1155,
      cpu1: 2,
      cpu3: 20,
      cpu7: 26,
      cpu10: 27,
      cpu11: 78,
      cpu14: 109,
      cpu15: 113,
      cpu17: 19,
      cpu18: 5,
      cpu20: 81,
      cpu21: 8,
      cpu22: 10,
      cpu25: 10,
      sptCpu3: 27,
      pmc7: 135,
      pmc20: 194,
      pmc21: 230,
      pmc22: 232,
      mipCpu17: 110,
      mipCpu20: 73,
      pch16: 48,
      pch18: 54,
      pch21: 66,
    };
    for (const [id, count] of Object.entries(counts)) {
      expect(strapMapById(id)?.fields.length, id).toBe(count);
    }
  });

  // The labelled tables keep their labels and option words as text, not as numbers only.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testTheTablesKeepTheirLabelsAndOptions
  it("keeps the tables' labels and options", () => {
    for (const id of ["pch130", "pch18", "pch21", "mipCpu17"]) {
      const map = requiredStrapMap(id);
      const field = map.fields.find((one) => one.options !== undefined);
      expect(field?.label, map.name).toBeDefined();
      expect(field?.options?.size, map.name).toBeGreaterThan(0);
    }
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled().slice();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => decodeStrapMaps(new MapFile(data, expected)))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testAnotherFormatIsRefused
  it("refuses another format", () => {
    const data = bundled().slice();
    data[4] = 2;
    data[5] = 0;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled().slice();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapDataTests.swift#StrapMapDataTests.testATruncatedFileIsReported
  it("reports a truncated file", () => {
    expect(failureOf(() => new MapFile(bundled().slice(0, 10), expected)).kind).toBe("corrupt");
  });
});
