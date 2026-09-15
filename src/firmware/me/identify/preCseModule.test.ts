import { describe, expect, it } from "vitest";
import { decodeMmeDirectory } from "@/firmware/me/identify/preCseModule";

/**
 * The classic ME `$MME` directory and its `$MCP`. Ported from upstream's
 * `PreCSEModuleDecodeTests`; sizes and offsets mirror a real Lenovo T450 ME 10
 * directory where noted.
 */

const ascii = (text: string, width: number) => {
  const bytes = new Uint8Array(width);
  bytes.set(Uint8Array.from(text.slice(0, width), (one) => one.charCodeAt(0)));
  return bytes;
};

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.u32 */
function putU32(bytes: Uint8Array, at: number, value: number) {
  new DataView(bytes.buffer).setUint32(at, value, true);
}

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.u16 */
function putU16(bytes: Uint8Array, at: number, value: number) {
  new DataView(bytes.buffer).setUint16(at, value, true);
}

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.fixed */
const filled = (value: number, count: number) => new Uint8Array(count).fill(value);

/**
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.newRow
 */
function newRow(options: {
  name: string;
  hash: Uint8Array;
  modBase: number;
  offsetMN2: number;
  sizeUncomp: number;
  sizeComp: number;
  memory?: number;
  preUma?: number;
  entryPoint?: number;
  flags?: number;
}): Uint8Array {
  const row = new Uint8Array(0x60);
  row.set(ascii("$MME", 4));
  row.set(ascii(options.name, 16), 0x04);
  row.set(options.hash.subarray(0, 32), 0x14);
  putU32(row, 0x34, options.modBase);
  putU32(row, 0x38, options.offsetMN2);
  putU32(row, 0x3c, options.sizeUncomp);
  putU32(row, 0x40, options.sizeComp);
  putU32(row, 0x44, options.memory ?? 0);
  putU32(row, 0x48, options.preUma ?? 0);
  putU32(row, 0x4c, options.entryPoint ?? 0);
  putU32(row, 0x50, options.flags ?? 0);
  return row;
}

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.oldRow */
function oldRow(options: {
  name: string;
  guid: Uint8Array;
  version: readonly [number, number, number, number];
  hash: Uint8Array;
  size: number;
  flags?: number;
}): Uint8Array {
  const row = new Uint8Array(0x50);
  row.set(ascii("$MME", 4));
  row.set(options.guid.subarray(0, 16), 0x04);
  for (const [index, word] of options.version.entries()) putU16(row, 0x14 + index * 2, word);
  row.set(ascii(options.name, 16), 0x1c);
  row.set(options.hash.subarray(0, 20), 0x2c);
  putU32(row, 0x40, options.size);
  putU32(row, 0x44, options.flags ?? 0);
  return row;
}

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.mcp */
function mcp(codeSize: number, offCodeMN2: number, offPartFPT: number, hash: Uint8Array) {
  const header = new Uint8Array(0x44);
  header.set(ascii("$MCP", 4));
  putU32(header, 0x04, 0x11);
  putU32(header, 0x08, codeSize);
  putU32(header, 0x0c, offCodeMN2);
  putU32(header, 0x10, offPartFPT);
  header.set(hash.subarray(0, 32), 0x14);
  return header;
}

/**
 * The directory at the canonical head 0x290 — an R0 manifest at base 0 fills
 * 0x284, then the 0xC gap. `declared` strides are filled; a `$MCP` follows one
 * more stride of padding.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#MMEFixture.directoryRegion
 */
function directoryRegion(
  declared: number,
  rows: readonly Uint8Array[],
  stride: number,
  trailer?: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(0x290)];
  for (let index = 0; index < declared; index++) parts.push(rows[index] ?? new Uint8Array(stride));
  if (trailer !== undefined) parts.push(new Uint8Array(stride), trailer);
  const bytes = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    bytes.set(one, at);
    at += one.length;
  }
  return bytes;
}

const decode = (bytes: Uint8Array, declared: number, manifestTag = "$MN2", baseOffset = 0) =>
  decodeMmeDirectory({
    bytes,
    manifestBase: 0,
    headerLengthBytes: 0x284,
    manifestTag,
    declaredModules: declared,
    baseOffset,
  });

describe("decodeMmeDirectory", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleDecodeTests.testDecodesNewHeaderDirectoryWithMCP
  it("decodes a new-header directory and its $MCP", () => {
    const hash = filled(0xab, 32);
    const rows = [
      newRow({
        name: "UPDATE",
        hash,
        modBase: 0x2000,
        offsetMN2: 0x6e04d,
        sizeUncomp: 0x1000,
        sizeComp: 0x1ab,
      }),
      newRow({
        name: "BUP",
        hash,
        modBase: 0x2000,
        offsetMN2: 0x940,
        sizeUncomp: 0x1d000,
        sizeComp: 0x15700,
        memory: 0x1d000,
        preUma: 0x1d000,
        entryPoint: 0x3fc0,
      }),
      newRow({
        name: "KERNEL",
        hash,
        modBase: 0x2000,
        offsetMN2: 0x940,
        sizeUncomp: 0x56000,
        sizeComp: 0x3c59d,
      }),
    ];
    const bytes = directoryRegion(3, rows, 0x60, mcp(0xaf6f4, 0x90c, 0x160000, hash));

    const directory = decode(bytes, 3);
    expect(directory?.offset).toBe(0x290);
    expect(directory?.manifestTag).toBe("$MN2");
    expect(directory?.declaredModules).toBe(3);
    expect(directory?.modules.map((one) => one.name)).toEqual(["UPDATE", "BUP", "KERNEL"]);

    const bup = directory?.modules[1];
    expect(bup).toMatchObject({
      offsetMN2: 0x940,
      sizeUncompressed: 0x1d000,
      sizeCompressed: 0x15700,
      memorySize: 0x1d000,
      preUmaSize: 0x1d000,
      entryPoint: 0x3fc0,
      modBase: 0x2000,
      flags: 0,
      hashHex: "AB".repeat(32),
    });
    expect(bup?.guidHex).toBeUndefined();
    expect(bup?.majorVersion).toBeUndefined();
    expect(bup?.size).toBeUndefined();

    expect(directory?.mcp).toMatchObject({
      offset: 0x290 + 3 * 0x60 + 0x60,
      headerSize: 0x11,
      codeSize: 0xaf6f4,
      offsetCodeMN2: 0x90c,
      offsetPartFPT: 0x160000,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleDecodeTests.testBaseOffsetAdjustsReportedAnchors
  it("reports its anchors at the caller's offsets", () => {
    const bytes = directoryRegion(
      1,
      [
        newRow({
          name: "ROMP",
          hash: filled(0x11, 32),
          modBase: 0,
          offsetMN2: 0x940,
          sizeUncomp: 0x1000,
          sizeComp: 0x3c2,
        }),
      ],
      0x60
    );
    const directory = decode(bytes, 1, "$MN2", 0x1000);
    expect(directory?.offset).toBe(0x1290);
    expect(directory?.mcp).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleDecodeTests.testDecodesOldHeaderDirectoryWithoutMCP
  it("decodes an old-header directory and never looks for a $MCP", () => {
    const hash = filled(0x22, 20);
    const rows = [
      oldRow({
        name: "ROMP",
        guid: filled(0x01, 16),
        version: [4, 1, 0, 1052],
        hash,
        size: 0x1000,
        flags: 0x3,
      }),
      oldRow({
        name: "BUP",
        guid: filled(0x02, 16),
        version: [4, 1, 0, 1052],
        hash,
        size: 0x2a000,
      }),
    ];
    const directory = decode(directoryRegion(2, rows, 0x50), 2, "$MAN");
    expect(directory?.manifestTag).toBe("$MAN");
    expect(directory?.modules.map((one) => one.name)).toEqual(["ROMP", "BUP"]);
    expect(directory?.mcp).toBeUndefined();

    const romp = directory?.modules[0];
    expect(romp).toMatchObject({
      majorVersion: 4,
      minorVersion: 1,
      hotfixVersion: 0,
      buildVersion: 1052,
      size: 0x1000,
      flags: 0x3,
      guidHex: "01".repeat(16),
      hashHex: "22".repeat(20),
    });
    expect(romp?.modBase).toBeUndefined();
    expect(romp?.offsetMN2).toBeUndefined();
    expect(romp?.sizeCompressed).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleDecodeTests.testStopsAtDeclaredCountBeyondActualRows
  it("stops at the first row that is not $MME", () => {
    const rows = [
      newRow({
        name: "A",
        hash: filled(0xaa, 32),
        modBase: 0,
        offsetMN2: 0x100,
        sizeUncomp: 1,
        sizeComp: 1,
      }),
      newRow({
        name: "B",
        hash: filled(0xbb, 32),
        modBase: 0,
        offsetMN2: 0x200,
        sizeUncomp: 1,
        sizeComp: 1,
      }),
    ];
    const directory = decode(directoryRegion(4, rows, 0x60), 4);
    expect(directory?.declaredModules).toBe(4);
    expect(directory?.modules).toHaveLength(2);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/PreCSEModuleTests.swift#PreCSEModuleDecodeTests.testReturnsNilWhenNoPlausibleDirectory
  it("finds nothing where there is no plausible directory", () => {
    const bogus = new Uint8Array(0x290 + 0x60);
    bogus.fill(0xff, 0x290);
    expect(decode(bogus, 4)).toBeUndefined();
    expect(decode(directoryRegion(0, [], 0x60), 0)).toBeUndefined();
    expect(decode(new Uint8Array(0x10), 2)).toBeUndefined();
  });
});
