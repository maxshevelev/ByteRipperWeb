import { describe, expect, it } from "vitest";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile, MapKind, MapSection } from "@/firmware/mapData/mapFile";
import { type MapFamily, mapFileOf } from "@/firmware/mapData/mapResources";

/**
 * A header with no sections, a given version and kind, and a correct checksum.
 * The record readers are exercised by the modules that own them; this pins the
 * envelope's refusals.
 */
function header({ version = 1, kind = 1, format = 1 } = {}): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x42, 0x52, 0x4d, 0x31]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, format, true);
  view.setUint16(6, 32, true);
  view.setUint32(8, version, true);
  view.setUint16(12, kind, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, fnv1a32(bytes), true);
  return bytes;
}

function failureOf(read: () => unknown) {
  try {
    read();
  } catch (error) {
    if (error instanceof MapDataError) return error.failure;
    throw error;
  }
  throw new Error("expected a MapDataError");
}

describe("the map file envelope", () => {
  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testAWellFormedHeaderLoads
  it("loads a well-formed header", () => {
    const file = new MapFile(header({ version: 7 }), 7);
    expect(file.kind).toBe(MapKind.strap);
    expect(file.version).toBe(7);
    expect(file.section(MapSection.strings)).toBeUndefined();
  });

  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testAVersionTheCodeDoesNotReadIsRefused
  it("refuses a version the code does not read", () => {
    expect(failureOf(() => new MapFile(header({ version: 2 }), 1))).toEqual({
      kind: "versionMismatch",
      file: 2,
      code: 1,
    });
  });

  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testAnotherFormatIsRefused
  it("refuses another format", () => {
    expect(failureOf(() => new MapFile(header({ format: 2 }), 1))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
  });

  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testBadMagicAndUnknownKindAreRefused
  it("refuses a bad magic and an unknown kind", () => {
    const bytes = header();
    bytes[0] = 0x58;
    expect(failureOf(() => new MapFile(bytes, 1))).toEqual({ kind: "badMagic" });
    expect(failureOf(() => new MapFile(header({ kind: 99 }), 1))).toEqual({
      kind: "wrongKind",
      mapKind: 99,
    });
  });

  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testAnEditedByteFailsTheChecksum
  it("fails the checksum on an edited byte", () => {
    const bytes = header();
    bytes[31] = (bytes[31] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(bytes, 1)).kind).toBe("corrupt");
  });

  // @upstream Packages/MapData/Tests/MapDataTests/MapFileTests.swift#MapFileTests.testATruncatedHeaderIsRefused
  it("refuses a truncated header", () => {
    expect(failureOf(() => new MapFile(new Uint8Array([0, 1, 2]), 1)).kind).toBe("corrupt");
  });

  // The binaries brought across from upstream read with the marks they were compiled with.
  it("reads every shipped family with the version it was marked with", () => {
    const kinds: Record<MapFamily, MapKind> = {
      strap: MapKind.strap,
      register: MapKind.register,
      configuration: MapKind.configuration,
      uep: MapKind.uep,
      gpio: MapKind.gpio,
      layout: MapKind.layout,
    };
    for (const family of Object.keys(MAP_DATA_VERSIONS) as MapFamily[]) {
      const file = mapFileOf(family);
      expect(file.kind).toBe(kinds[family]);
      expect(file.version).toBe(MAP_DATA_VERSIONS[family].version);
      expect(file.requireSection(MapSection.strings).length).toBeGreaterThan(0);
    }
  });
});
