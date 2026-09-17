import { describe, expect, it } from "vitest";
import { crc16_14 } from "@/firmware/me/crypto/checksum";
import {
  decodeConfigRecords,
  ftblFileIntegrity,
  homeDirectory,
  homeRecordSize,
  integrityTable,
  type MFSLowLevelFile,
  mfsState,
  parseMfs,
  reservedIntegrity,
  secHeaderSize,
  vfsStartsAtZero,
} from "@/firmware/me/fileSystem/mfs";

/**
 * The MFS volume decode. Ported from upstream's `MFSTests` and
 * `MFSStateDecoderTests`; the volume facts were cross-checked upstream against a
 * real CSME 12.0.3 MFS region.
 */

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const put16 = (bytes: Uint8Array, at: number, value: number) =>
  view(bytes).setUint16(at, value, true);
const put32 = (bytes: Uint8Array, at: number, value: number) =>
  view(bytes).setUint32(at, value >>> 0, true);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

const filled = (value: number, count: number) => new Uint8Array(count).fill(value);
const SYS_CHUNK_COUNT = Math.floor((0x2000 - 0x12 - 2) / (2 + 0x42));
const SYS_INDEX_BYTES = SYS_CHUNK_COUNT * 2 + 2;
const DATA_CHUNK_COUNT = Math.floor((0x2000 - 0x12) / (1 + 0x42));

/** A System page whose one used chunk (index 0) holds `volumeChunk`. */
function systemPage(volumeChunk: Uint8Array): Uint8Array {
  const page = filled(0xff, 0x2000);
  put32(page, 0, 0xaa55_7887);
  put32(page, 4, 1);
  put32(page, 8, 0);
  put16(page, 12, 2);
  put16(page, 14, 0);
  // Chunk 0's obfuscated index: Crc16_14(0) ^ 0.
  put16(page, 0x12, 0x0b5b);
  for (let slot = 1; slot <= SYS_CHUNK_COUNT; slot++) put16(page, 0x12 + slot * 2, 0xc000);
  page.set(volumeChunk, 0x12 + SYS_INDEX_BYTES);
  return page;
}

/** A System page with the volume chunk, and a Data page whose first chunk index is 1. */
function makeVolume(volumeChunk: Uint8Array): Uint8Array {
  const data = filled(0xff, 0x2000);
  put32(data, 0, 0xaa55_7887);
  put32(data, 4, 2);
  put16(data, 14, 1);
  return concat(systemPage(volumeChunk), data);
}

function volumeChunk(
  options: {
    dictionary?: number;
    platform?: number;
    reserved?: number;
    volumeSize?: number;
    fileRecords?: number;
    fatFirst?: number;
  } = {}
): Uint8Array {
  const chunk = new Uint8Array(0x40);
  put32(chunk, 0, 0x724f_6201);
  chunk[4] = options.dictionary ?? 0x0a;
  chunk[5] = options.platform ?? 0x01;
  put16(chunk, 6, options.reserved ?? 0xabcd);
  put32(chunk, 8, options.volumeSize ?? 0x1200);
  put16(chunk, 12, options.fileRecords ?? 7);
  put16(chunk, 0x0e, options.fatFirst ?? 0x0005);
  put16(chunk, 0x10, 0xffff);
  return chunk;
}

describe("the volume decode", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testParsesVolumeHeaderFromSystemChunkZero
  it("reads the volume header from System chunk 0", () => {
    const region = makeVolume(volumeChunk());
    const info = parseMfs(region, 0, region.length);
    expect(info).toMatchObject({
      systemPageCount: 1,
      dataPageCount: 1,
      volumeSignatureValid: true,
      volumeSize: 0x1200,
      fileRecordCount: 7,
      usedFileCount: 1,
      ftblDictionary: 0x0a,
      ftblPlatform: 0x01,
      ftblReserved: 0xabcd,
      usesFTBL: true,
      computedVolumeSize: (1 + 122) * 0x40,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testLegacyVolumeWithoutFTBLFlags
  it("reads the legacy (1, 0, 0) layout as no file table", () => {
    const region = makeVolume(volumeChunk({ dictionary: 1, platform: 0, reserved: 0 }));
    const info = parseMfs(region, 0, region.length);
    expect(info?.usesFTBL).toBe(false);
    expect(info?.ftblDictionary).toBe(1);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testBadVolumeSignatureReportedNotThrown
  it("reports a bad volume signature rather than failing", () => {
    const chunk = volumeChunk();
    put32(chunk, 0, 0xdead_beef);
    const region = makeVolume(chunk);
    const info = parseMfs(region, 0, region.length);
    expect(info?.volumeSignatureValid).toBe(false);
    expect(info?.fileRecordCount).toBe(0);
  });
});

describe("detection", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testNoMFSPagesYieldsNil
  it("finds nothing without MFS pages", () => {
    const blank = filled(0xff, 0x2000);
    expect(parseMfs(blank, 0, blank.length)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testOffsetsOutOfBoundsYieldNil
  it("finds nothing out of bounds", () => {
    const region = makeVolume(volumeChunk());
    expect(parseMfs(region, region.length, 0x2000)).toBeUndefined();
    expect(parseMfs(region, -1, 0x2000)).toBeUndefined();
    expect(parseMfs(region, 0, 0x100)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testCRC16_14TransformVector
  it("de-obfuscates with the CRC-16/14 transform", () => {
    expect(crc16_14(0)).toBe(0x0b5b);
  });
});

/**
 * A volume whose System chunk 0 carries a header for `fileRecords` records and
 * a FAT, and whose Data page (first chunk index 2) holds `dataSlotContents`.
 * FAT data slot `f` is Data page slot `f − fileRecords`.
 */
function makeFileVolume(options: {
  fileRecords: number;
  fat: Readonly<Record<number, number>>;
  dataSlotContents: readonly Uint8Array[];
  dictionary?: number;
  platform?: number;
  reserved?: number;
}): Uint8Array {
  const volume = new Uint8Array(0x40);
  put32(volume, 0, 0x724f_6201);
  volume[4] = options.dictionary ?? 0x0a;
  volume[5] = options.platform ?? 0x01;
  put16(volume, 6, options.reserved ?? 0);
  put32(volume, 8, 0x1200);
  put16(volume, 12, options.fileRecords);
  for (let record = 0; record < options.fileRecords; record++) {
    const at = 0x0e + record * 2;
    if (at + 2 <= 0x40) put16(volume, at, 0xffff);
  }
  for (const [slot, value] of Object.entries(options.fat))
    put16(volume, 0x0e + Number(slot) * 2, value);
  const system = systemPage(volume);
  put16(system, 12, 0);

  const data = filled(0xff, 0x2000);
  put32(data, 0, 0xaa55_7887);
  put32(data, 4, 2);
  put16(data, 14, 2);
  options.dataSlotContents.forEach((content, slot) => {
    data[0x12 + slot] = 0x00;
    data.set(content, 0x12 + DATA_CHUNK_COUNT + slot * 0x42);
  });
  return concat(system, data);
}

describe("the low-level file walk", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testWalksLowLevelFileChainsAcrossFAT
  it("walks chains across the FAT to their end markers", () => {
    const region = makeFileVolume({
      fileRecords: 20,
      fat: { 0: 20, 1: 21, 20: 6, 21: 4 },
      dataSlotContents: [filled(0x41, 0x40), filled(0x42, 0x40)],
    });
    const info = parseMfs(region, 0, region.length);
    expect(info?.usedFileCount).toBe(2);
    expect(info?.fileChainsIntact).toBe(true);
    expect(info?.files.map((one) => one.index)).toEqual([0, 1]);
    expect(info?.files[0]?.content).toEqual(filled(0x41, 6));
    expect(info?.files[1]?.content).toEqual(filled(0x42, 4));
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testUsedButCorruptChainIsNonFatalAndFlagged
  it("flags a corrupt chain without failing", () => {
    const region = makeFileVolume({ fileRecords: 20, fat: { 0: 60 }, dataSlotContents: [] });
    const info = parseMfs(region, 0, region.length);
    expect(info?.usedFileCount).toBe(1);
    expect(info?.fileChainsIntact).toBe(false);
    expect(info?.files).toHaveLength(1);
    expect(info?.files[0]?.content).toHaveLength(0);
  });
});

function configStream(
  records: readonly {
    name: string;
    accessMode: number;
    deployOptions: number;
    size: number;
    offset: number;
  }[]
): Uint8Array {
  const out = new Uint8Array(4 + records.length * 0x1c);
  put32(out, 0, records.length);
  records.forEach((record, index) => {
    const base = 4 + index * 0x1c;
    out.set(
      Uint8Array.from(record.name.slice(0, 12), (one) => one.charCodeAt(0)),
      base
    );
    put16(out, base + 0x0e, record.accessMode);
    put16(out, base + 0x10, record.deployOptions);
    put16(out, base + 0x12, record.size);
    put32(out, base + 0x18, record.offset);
  });
  return out;
}

const HOME = { name: "home", accessMode: 0x116d, deployOptions: 0, size: 0, offset: 0 };
const HW_BINDING = {
  name: "hw_binding",
  accessMode: 0x03a0,
  deployOptions: 0x11,
  size: 1,
  offset: 0x10a4,
};

describe("the legacy configuration streams", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testLegacyConfigurationStreamDecodesRecordFields
  it("decode the record fields", () => {
    const stream = configStream([HOME, HW_BINDING]);
    const region = makeFileVolume({
      fileRecords: 20,
      fat: { 6: 20, 20: stream.length },
      dataSlotContents: [stream],
      dictionary: 1,
      platform: 0,
      reserved: 0,
    });
    const info = parseMfs(region, 0, region.length);
    expect(info?.usesFTBL).toBe(false);
    expect(info?.configurations).toHaveLength(1);
    expect(info?.configurations[0]?.owningFile).toBe(6);
    const [home, binding] = info?.configurations[0]?.records ?? [];
    expect(home).toMatchObject({
      name: "home",
      isFolder: true,
      unixRights: 365,
      size: 0,
      offset: 0,
      integrity: false,
      encryption: false,
      antiReplay: false,
      oemConfigurable: false,
      mcaConfigurable: false,
    });
    expect(binding).toMatchObject({
      name: "hw_binding",
      isFolder: false,
      unixRights: 416,
      integrity: true,
      encryption: false,
      antiReplay: false,
      oemConfigurable: true,
      mcaConfigurable: false,
      size: 1,
      offset: 0x10a4,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testFTBLVolumeDoesNotDecodeConfigurationStream
  it("are not decoded on a file-table volume", () => {
    const stream = configStream([HOME]);
    const region = makeFileVolume({
      fileRecords: 20,
      fat: { 6: 20, 20: stream.length },
      dataSlotContents: [stream],
    });
    const info = parseMfs(region, 0, region.length);
    expect(info?.usesFTBL).toBe(true);
    expect(info?.files.map((one) => one.index)).toEqual([6]);
    expect(info?.configurations).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testLegacyVolumeWithoutConfigFilesHasEmptyConfigurations
  it("are absent when the volume has no files 6 or 7", () => {
    const region = makeFileVolume({
      fileRecords: 20,
      fat: { 0: 20, 20: 4 },
      dataSlotContents: [Uint8Array.of(0xab)],
      dictionary: 1,
      platform: 0,
      reserved: 0,
    });
    const info = parseMfs(region, 0, region.length);
    expect(info?.usesFTBL).toBe(false);
    expect(info?.configurations).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testConfigStreamTruncatedBeforeItsDeclaredCountDecodesWhatFits
  it("decode what fits of a truncated stream", () => {
    const cut = configStream([HOME, HW_BINDING]).subarray(0, 4 + 0x1c);
    const records = decodeConfigRecords(cut);
    expect(records).toHaveLength(1);
    expect(records?.[0]?.name).toBe("home");
    expect(decodeConfigRecords(Uint8Array.of(1, 2, 3))).toBeUndefined();
    expect(decodeConfigRecords(new Uint8Array(0))).toBeUndefined();
  });
});

function homeRow(
  name: string,
  options: {
    fileIndex?: number;
    folder?: boolean;
    integrity?: boolean;
    recordSize?: number;
    salt?: readonly number[];
  } = {}
): Uint8Array {
  const recordSize = options.recordSize ?? 0x1c;
  const salt = options.salt ?? (recordSize === 0x1c ? [0x1111, 0x2222, 0x3333] : [0x1111]);
  const row = new Uint8Array(recordSize);
  put32(row, 0, ((options.fileIndex ?? 8) & 0xfff) | (0x1234 << 12) | (1 << 28));
  let access = 0x1ed;
  if (options.integrity === true) access |= 1 << 9;
  access |= 1 << 13;
  if (options.folder === true) access |= 1 << 14;
  put16(row, 4, access);
  put16(row, 6, 0x00aa);
  put16(row, 8, 0x00bb);
  for (const [index, word] of salt.entries()) put16(row, 0x0a + index * 2, word);
  row.set(
    Uint8Array.from(name.slice(0, 12), (one) => one.charCodeAt(0)),
    recordSize - 12
  );
  return row;
}

function integrityFixture(options: {
  size: number;
  flags: number;
  hmac: Uint8Array;
  nonce: Uint8Array;
  arRandom?: number;
  arCounter?: number;
}): Uint8Array {
  const out = new Uint8Array(options.size);
  out.set(options.hmac.subarray(0, options.size));
  if (options.size === 0x28) {
    put32(out, 0x10, options.flags);
    out.set(options.nonce, 0x1c);
    put32(out, 0x14, options.arRandom ?? 0);
    put32(out, 0x18, options.arCounter ?? 0);
  } else {
    put32(out, 0x20, options.flags);
    out.set(options.nonce, 0x24);
    put32(out, 0x24, options.arRandom ?? 0);
    put32(out, 0x28, options.arCounter ?? 0);
  }
  return out;
}

const TABLE28 = () =>
  integrityFixture({ size: 0x28, flags: 0, hmac: filled(0x5a, 16), nonce: filled(0x6b, 12) });

describe("the layout selectors", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testSecHeaderSizeLayoutSelectors
  it("choose the integrity table size", () => {
    expect(secHeaderSize("CSME", 14, 5, 0)).toBe(0x34);
    expect(secHeaderSize("CSSPS", 4, 4, 0)).toBe(0x28);
    expect(secHeaderSize("CSSPS", 5, 9, 10)).toBe(0x28);
    expect(secHeaderSize("CSSPS", 5, 9, 9)).toBe(0x34);
    expect(secHeaderSize("CSME", 11, 8, 0)).toBe(0x34);
    expect(secHeaderSize("CSTXE", 3, 0, 0)).toBe(0x34);
    expect(secHeaderSize("CSME", 12, 0, 0)).toBe(0x28);
    expect(secHeaderSize("CSME", 15, 0, 0)).toBe(0x28);
    expect(secHeaderSize("CSME", 13, 30, 0)).toBe(0x28);
    expect(secHeaderSize("GSC", 1, 0, 0)).toBe(0x28);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testVfsStartsAtZeroLayoutSelectors
  it("say whether the files start at zero", () => {
    expect(vfsStartsAtZero("CSME", 13, 30)).toBe(true);
    expect(vfsStartsAtZero("CSME", 15, 40)).toBe(true);
    expect(vfsStartsAtZero("CSME", 16, 0)).toBe(true);
    expect(vfsStartsAtZero("CSME", 11, 8)).toBe(false);
    expect(vfsStartsAtZero("CSME", 12, 0)).toBe(false);
    expect(vfsStartsAtZero("CSME", 13, 29)).toBe(false);
    expect(vfsStartsAtZero("CSSPS", 6, 0)).toBe(false);
    expect(vfsStartsAtZero("GSC", 1, 0)).toBe(true);
  });
});

describe("the integrity table", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testIntegrityTable028DecodesFields
  it("decodes the 0x28 layout", () => {
    const flags = 0x2 | 0x8 | (5 << 11) | (3 << 22);
    const table = integrityTable(
      integrityFixture({
        size: 0x28,
        flags,
        hmac: Uint8Array.from({ length: 16 }, (_, i) => i),
        nonce: filled(0xab, 12),
        arRandom: 0x1122_3344,
        arCounter: 0x5566_7788,
      })
    );
    expect(table).toEqual({
      size: 0x28,
      hmacHex: "000102030405060708090A0B0C0D0E0F",
      flagsRaw: 0xc0280a,
      antiReplayProtection: true,
      encryptionProtection: true,
      antiReplayIndex: 5,
      securityVersion: 3,
      arRandom: 0x1122_3344,
      arCounter: 0x5566_7788,
      nonceHex: "ABABABABABABABABABABABAB",
    });
    const idle = integrityTable(TABLE28());
    expect(idle).toMatchObject({
      antiReplayProtection: false,
      encryptionProtection: false,
      antiReplayIndex: 0,
      securityVersion: 0,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testIntegrityTable034DecodesFields
  it("decodes the 0x34 layout", () => {
    const flags = 0x2 | 0x4 | (7 << 10) | (4 << 21);
    const table = integrityTable(
      integrityFixture({
        size: 0x34,
        flags,
        hmac: Uint8Array.from({ length: 32 }, (_, i) => i),
        nonce: filled(0x11, 16),
        arRandom: 0xdead_beef,
        arCounter: 0xcafe_babe,
      })
    );
    expect(table).toMatchObject({
      size: 0x34,
      hmacHex: "000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F",
      flagsRaw: 0x801c06,
      antiReplayProtection: true,
      encryptionProtection: true,
      antiReplayIndex: 7,
      securityVersion: 4,
      arRandom: 0xdead_beef,
      arCounter: 0xcafe_babe,
      nonceHex: "EFBEADDEBEBAFECA1111111111111111",
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testIntegrityTableRejectsOtherLengths
  it("rejects any other length", () => {
    expect(integrityTable(new Uint8Array(0x2c))).toBeUndefined();
    expect(integrityTable(new Uint8Array(0))).toBeUndefined();
  });
});

describe("the home record size", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeRecordSizeDetectedFromMarkerPair
  it("comes from the marker pair", () => {
    expect(
      homeRecordSize(
        concat(homeRow(".", { recordSize: 0x18 }), homeRow("..", { recordSize: 0x18 }))
      )
    ).toBe(0x18);
    expect(homeRecordSize(concat(homeRow("."), homeRow("..")))).toBe(0x1c);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeRecordSizeNilWithoutTwoMarkers
  it("is nothing without two markers", () => {
    expect(homeRecordSize(homeRow("."))).toBeUndefined();
    expect(homeRecordSize(new Uint8Array(0))).toBeUndefined();
    expect(homeRecordSize(filled(0x2e, 32))).toBeUndefined();
  });
});

const file = (index: number, content: Uint8Array): MFSLowLevelFile => ({ index, content });

describe("the reserved files' integrity", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testReservedIntegrityCSME12IncludesQuotaFile
  it("includes Quota Storage on CSME 12", () => {
    const table = integrityFixture({
      size: 0x28,
      flags: 0x2,
      hmac: filled(0x5a, 16),
      nonce: filled(0x6b, 12),
    });
    const result = reservedIntegrity({
      files: [
        file(1, new Uint8Array(0x10)),
        file(2, concat(filled(0x22, 0xc4), table)),
        file(3, concat(filled(0x33, 0xc4), table)),
        file(5, concat(filled(0x55, 0x208), table)),
      ],
      variant: "CSME",
      major: 12,
      minor: 0,
      platform: 0,
      isAFS: false,
    });
    expect(result.map((one) => one.fileIndex)).toEqual([2, 3, 5]);
    expect(result.map((one) => one.contentSize)).toEqual([0xc4, 0xc4, 0x208]);
    expect(result.map((one) => one.integrity.size)).toEqual([0x28, 0x28, 0x28]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testReservedIntegrityHonorsRoleExemptions
  it("honours the role exemptions", () => {
    const table = integrityFixture({
      size: 0x34,
      flags: 0,
      hmac: filled(0xa5, 32),
      nonce: filled(0x0f, 16),
    });
    const files = [
      file(2, concat(filled(0x22, 0xc4), table)),
      file(4, concat(filled(0x44, 0x80), table)),
      file(5, concat(filled(0x55, 0x208), table)),
    ];
    const common = { files, variant: "CSME", major: 11, minor: 8, platform: 0 };
    expect(reservedIntegrity({ ...common, isAFS: true }).map((one) => one.fileIndex)).toEqual([2]);
    expect(reservedIntegrity({ ...common, isAFS: false }).map((one) => one.fileIndex)).toEqual([
      2, 4,
    ]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testReservedIntegritySkipsFilesOutsideOneToFive
  it("skips files outside 1–5", () => {
    const result = reservedIntegrity({
      files: [
        file(8, concat(filled(0xab, 0x40), TABLE28())),
        file(9, concat(filled(0xcd, 0x40), TABLE28())),
      ],
      variant: "CSME",
      major: 12,
      minor: 0,
      platform: 0,
      isAFS: false,
    });
    expect(result).toEqual([]);
  });
});

const csme12 = { variant: "CSME", major: 12, minor: 0, platform: 0 };

describe("an FTBL volume's file integrity", () => {
  const csme15 = { variant: "CSME", major: 15, minor: 0, platform: 4 };

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testTheFTBLSplitFollowsTheTablesFlag
  it("follows the table's flag", () => {
    const table = integrityFixture({
      size: 0x28,
      flags: 0x2,
      hmac: filled(0xaa, 16),
      nonce: filled(0xbb, 12),
      arRandom: 0x1234,
      arCounter: 7,
    });
    const splits = ftblFileIntegrity({
      files: [file(5, concat(filled(0x55, 0x100), table)), file(6, filled(0x66, 0x100))],
      protectedIndices: new Set([5]),
      ...csme15,
    });

    expect(splits.map((one) => one.fileIndex)).toEqual([5]);
    expect(splits[0]?.contentSize).toBe(0x100);
    expect(splits[0]?.tableSize).toBe(0x28);
    expect(splits[0]?.integrity.size).toBe(0x28);
    expect(splits[0]?.integrity.arCounter).toBe(7);
    expect(splits[0]?.integrity.antiReplayProtection).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testAnAbsurdCounterMeansTheTableSitsTenBytesEarlier
  it("reads the table 0x10 earlier when the counter is absurd", () => {
    const real = integrityFixture({
      size: 0x28,
      flags: 0x2,
      hmac: filled(0xcc, 16),
      nonce: filled(0xdd, 12),
      arRandom: 0x99,
      arCounter: 3,
    });
    // The file ends with the table *and* 0x10 of unknown bytes, so a plain 0x28
    // read off the end lands in the middle of both and comes out with a counter
    // no Anti-Replay index would ever hold.
    const splits = ftblFileIntegrity({
      files: [file(9, concat(filled(0x77, 0x80), real, filled(0xee, 0x10)))],
      protectedIndices: new Set([9]),
      ...csme15,
    });

    expect(splits[0]?.tableSize).toBe(0x38);
    expect(splits[0]?.contentSize).toBe(0x80);
    expect(splits[0]?.integrity.arCounter).toBe(3);
    expect(splits[0]?.integrity.hmacHex.slice(0, 4)).toBe("CCCC");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testThe0x34LayoutIsSplitAtItsOwnSize
  it("splits the 0x34 layout at its own size", () => {
    const table = integrityFixture({
      size: 0x34,
      flags: 0x2,
      hmac: filled(0x11, 32),
      nonce: filled(0x22, 16),
      arRandom: 0xffffff,
      arCounter: 0xffffff,
    });
    const splits = ftblFileIntegrity({
      files: [file(3, concat(filled(0x33, 0x40), table))],
      protectedIndices: new Set([3]),
      variant: "CSME",
      major: 14,
      minor: 5,
      platform: 4,
    });
    expect(splits[0]?.tableSize).toBe(0x34);
    expect(splits[0]?.contentSize).toBe(0x40);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testAFileTooShortForItsTableIsNotSplit
  it("does not split a file too short for its table", () => {
    const splits = ftblFileIntegrity({
      files: [file(2, filled(0x22, 0x10))],
      protectedIndices: new Set([2]),
      ...csme15,
    });
    expect(splits).toEqual([]);
  });
});

describe("the home directory", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeDirectoryRecursesIntoFolderFiles
  it("recurses into folder files", () => {
    const file3 = concat(filled(0x44, 5), TABLE28());
    const file6 = concat(filled(0x49, 3), TABLE28());
    const file4 = concat(
      homeRow(".", { fileIndex: 8, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow("inner", { fileIndex: 6, integrity: true }),
      TABLE28()
    );
    const file8 = concat(
      homeRow(".", { fileIndex: 8, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow("data0", { fileIndex: 3, integrity: true }),
      homeRow("folder", { fileIndex: 4, folder: true, integrity: true }),
      TABLE28()
    );
    const home = homeDirectory({
      files: [file(3, file3), file(4, file4), file(6, file6), file(8, file8)],
      ...csme12,
    });
    expect(home?.homeRecordSize).toBe(0x1c);
    expect(home?.rootRecordCount).toBe(4);
    expect(home?.integrity?.size).toBe(0x28);
    expect(home?.entries).toHaveLength(2);

    const [data0, folder] = home?.entries ?? [];
    expect(data0).toMatchObject({
      name: "data0",
      fileIndex: 3,
      isFolder: false,
      integrityProtection: true,
      size: 5,
    });
    expect(data0?.integrity?.size).toBe(0x28);
    expect(folder).toMatchObject({ name: "folder", fileIndex: 4, isFolder: true });
    expect(folder?.children).toHaveLength(1);
    expect(folder?.children[0]).toMatchObject({ name: "inner", fileIndex: 6, size: 3 });
    expect(folder?.children[0]?.integrity?.size).toBe(0x28);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeDirectorySurfacesUnknownSalt
  it("surfaces the unknown salt", () => {
    const file8 = concat(homeRow("."), homeRow(".."), homeRow("salt", { fileIndex: 3 }), TABLE28());
    const home = homeDirectory({ files: [file(3, new Uint8Array(4)), file(8, file8)], ...csme12 });
    expect(home?.entries[0]?.name).toBe("salt");
    expect(home?.entries[0]?.unknownSalt).toBe(0x3333_2222_1111);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeFolderSelfReferenceTerminatesWithEmptyChildren
  it("stops a folder that refers to itself", () => {
    const file30 = concat(
      homeRow(".", { fileIndex: 30, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow("self", { fileIndex: 30, folder: true, integrity: true }),
      TABLE28()
    );
    const file8 = concat(
      homeRow(".", { fileIndex: 8, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow("outer", { fileIndex: 30, folder: true, integrity: true }),
      TABLE28()
    );
    const home = homeDirectory({ files: [file(8, file8), file(30, file30)], ...csme12 });
    const outer = home?.entries[0];
    expect(outer?.name).toBe("outer");
    expect(outer?.children).toHaveLength(1);
    expect(outer?.children[0]?.name).toBe("self");
    expect(outer?.children[0]?.isFolder).toBe(true);
    expect(outer?.children[0]?.children).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testNulPrefixDirtyMarkerIsTruncatedAndSkipped
  it("treats a NUL-prefixed dirty marker as the marker it is", () => {
    const file8 = concat(
      homeRow(".", { fileIndex: 8, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow(". faults", { fileIndex: 25, folder: true }),
      homeRow("bup", { fileIndex: 3 }),
      TABLE28()
    );
    const file25 = concat(
      homeRow(".", { fileIndex: 25, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      homeRow(". faults", { fileIndex: 25, folder: true }),
      TABLE28()
    );
    const home = homeDirectory({
      files: [file(3, filled(0x42, 2)), file(25, file25), file(8, file8)],
      ...csme12,
    });
    expect(home?.entries).toHaveLength(1);
    expect(home?.entries[0]?.name).toBe("bup");
    expect(home?.entries[0]?.size).toBe(2);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSTests.testHomeDirectoryNilCases
  it("is nothing where there is no home to read", () => {
    const file8 = concat(
      homeRow(".", { fileIndex: 8, folder: true }),
      homeRow("..", { fileIndex: 0 }),
      TABLE28()
    );
    expect(
      homeDirectory({ files: [file(8, file8)], variant: "CSME", major: 15, minor: 40, platform: 0 })
    ).toBeUndefined();
    expect(homeDirectory({ files: [file(3, Uint8Array.of(0))], ...csme12 })).toBeUndefined();
    expect(
      homeDirectory({ files: [file(8, homeRow(".", { fileIndex: 8, folder: true }))], ...csme12 })
    ).toBeUndefined();
  });
});

describe("the File System State", () => {
  const state = (
    presentFileIndices: readonly number[],
    usesFTBL = false,
    hasConfiguration = false
  ) => mfsState({ usesFTBL, presentFileIndices, hasConfiguration });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testLegacyIndexSetMapsToInitialized
  it("is Initialized for any reserved file", () => {
    for (const index of [0, 1, 2, 3, 4, 5, 8]) expect(state([index])).toBe("initialized");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testConfiguredWhenOnlyFaultOrBackupPresent
  it("is Configured for the fault log or backup alone", () => {
    expect(state([7])).toBe("configured");
    expect(state([9])).toBe("configured");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testInitializedWinsOverConfigured
  it("prefers Initialized", () => {
    expect(state([8, 9])).toBe("initialized");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testEmptyVolumeStaysUnconfigured
  it("stays Unconfigured on an empty volume", () => {
    expect(state([])).toBe("unconfigured");
    expect(state([10])).toBe("unconfigured");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testAConfigurationPartitionRaisesAnUnconfiguredVolume
  it("is raised to Configured by a configuration partition, and no further", () => {
    expect(state([], false, true)).toBe("configured");
    expect(state([0, 1, 2], true, true)).toBe("configured");
    expect(state([8], false, true)).toBe("initialized");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MFSTests.swift#MFSStateDecoderTests.testFTBLVolumeWithoutConfigurationStaysUnconfigured
  it("reads no index on a file-table volume", () => {
    expect(state([8], true)).toBe("unconfigured");
    expect(state([7, 9], true)).toBe("unconfigured");
  });
});
