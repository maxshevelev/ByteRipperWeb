import { describe, expect, it } from "vitest";
import { tagBytes } from "@/firmware/me/bytes";
import {
  cpdChecksumValid,
  cpdEntries,
  cpdModuleContentEnd,
  decodeCpdHeader,
  findPrecedingCpd,
  trailingEmptyCpdEntries,
} from "@/firmware/me/partition/cpd";
import { cpdDirectory } from "@/firmware/me/testing/testMe";

/** The `$CPD` directory — upstream's `CPDParserTests`. */

describe("decodeCpdHeader", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testDecodesR1Header
  it("decodes a revision 1 header", () => {
    const bytes = cpdDirectory({ name: "FTPR", modules: [{ name: "$MN2" }, { name: "rbe" }] });
    const header = decodeCpdHeader(bytes, 0);

    expect(header).toMatchObject({
      base: 0,
      numModules: 2,
      headerVersion: 1,
      entryVersion: 1,
      headerLength: 0x10,
      partitionName: "FTPR",
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testDecodesR2HeaderWithCRCField
  it("decodes a revision 2 header with its checksum word", () => {
    const bytes = cpdDirectory({ name: "RBEP", headerVersion: 2 });
    const header = decodeCpdHeader(bytes, 0);

    expect(header?.headerVersion).toBe(2);
    expect(header?.headerLength).toBe(0x14);
    expect(header?.partitionName).toBe("RBEP");
    expect(header?.checksumField).not.toBe(0);
    expect(header !== undefined && cpdChecksumValid(bytes, header)).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testRejectsNonCPDAndMalformedHeaders
  it("refuses what is not a directory", () => {
    expect(decodeCpdHeader(new Uint8Array(0x30).fill(0xff), 0)).toBeUndefined();

    // The tag alone is not enough: the version byte has to be one this format
    // has, or every four matching bytes in a compressed module reads as one.
    const bogus = new Uint8Array(0x30);
    bogus.set(tagBytes("$CPD"));
    bogus[0x09] = 1;
    bogus[0x0a] = 0x10;
    expect(decodeCpdHeader(bogus, 0)).toBeUndefined(); // version 0
    bogus[0x08] = 9;
    expect(decodeCpdHeader(bogus, 0)).toBeUndefined(); // and 9 is not one either
    bogus[0x08] = 1;
    expect(decodeCpdHeader(bogus, 0)).toBeDefined();
  });
});

describe("cpdEntries", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testReadsEntries
  it("reads the entries", () => {
    const bytes = cpdDirectory({ name: "FTPR", modules: [{ name: "$MN2" }] });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    const entries = cpdEntries(bytes, header, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "$MN2", offset: 0, isHuffman: false });
  });

  it("reads the Huffman bit out of the offset word", () => {
    // The offset is twenty-five bits and bit 25 is the flag, which is the kind
    // of packing that reads as an enormous offset if it is missed.
    const bytes = cpdDirectory({
      name: "FTPR",
      modules: [{ name: "mod", offset: 0x0200_0000 | 0x1234 }],
    });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    expect(cpdEntries(bytes, header, 0)[0]).toMatchObject({
      offset: 0x1234,
      isHuffman: true,
    });
  });

  it("stops at the end of a truncated region", () => {
    const bytes = cpdDirectory({ name: "FTPR", modules: [{ name: "a" }, { name: "b" }] });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    expect(cpdEntries(bytes.subarray(0, 0x10 + 0x18), header, 0)).toHaveLength(1);
  });
});

describe("cpdChecksumValid", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testR1ChecksumValidation
  it("validates a revision 1 checksum, and notices a changed byte", () => {
    const bytes = cpdDirectory({ name: "FTPR", modules: [{ name: "$MN2" }, { name: "rbe" }] });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");
    expect(cpdChecksumValid(bytes, header)).toBe(true);

    const corrupted = Uint8Array.from(bytes);
    corrupted[0x10] = (corrupted[0x10] ?? 0) ^ 0xff; // a byte of an entry's name
    const bad = decodeCpdHeader(corrupted, 0);
    expect(bad !== undefined && cpdChecksumValid(corrupted, bad)).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testR2ChecksumValidation
  it("validates a revision 2 checksum, and notices a changed byte", () => {
    const bytes = cpdDirectory({ name: "RBEP", headerVersion: 2 });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");
    expect(cpdChecksumValid(bytes, header)).toBe(true);

    const corrupted = Uint8Array.from(bytes);
    corrupted[0x0c] = (corrupted[0x0c] ?? 0) ^ 0xff; // a byte of the partition name
    const bad = decodeCpdHeader(corrupted, 0);
    expect(bad !== undefined && cpdChecksumValid(corrupted, bad)).toBe(false);
  });

  it("says nothing when the region is too short to cover the directory", () => {
    const bytes = cpdDirectory({ name: "FTPR", modules: [{ name: "a" }, { name: "b" }] });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    expect(cpdChecksumValid(bytes.subarray(0, 0x20), header)).toBeUndefined();
  });
});

describe("trailingEmptyCpdEntries", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testTrailingEmptyEntryProbe
  it("counts the empty slots after the last declared entry", () => {
    // Some directories under-count themselves when the real table carries extra
    // empty entries. They are reported, and the module list stays as declared.
    const directory = cpdDirectory({ name: "FTPR", modules: [{ name: "$MN2" }, { name: "rbe" }] });
    const bytes = new Uint8Array(directory.length + 2 * 0x18);
    bytes.set(directory);
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    expect(trailingEmptyCpdEntries(bytes, header)).toBe(2);
    expect(cpdEntries(bytes, header, 0)).toHaveLength(2);
  });
});

describe("cpdModuleContentEnd", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testModuleContentEnd
  it("reaches the end of the furthest module's content", () => {
    const bytes = cpdDirectory({
      name: "FTPR",
      modules: [
        { name: "a", offset: 0x10, size: 0x30 },
        { name: "b", offset: 0x28, size: 0x20 },
      ],
    });
    const header = decodeCpdHeader(bytes, 0);
    if (header === undefined) throw new Error("the fixture should decode");

    expect(cpdModuleContentEnd(header, cpdEntries(bytes, header, 0))).toBe(0x28 + 0x20);
  });
});

describe("findPrecedingCpd", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testFindPrecedingCPDFindsNearestInWindow
  it("finds the one nearest the manifest, not the first in the window", () => {
    const ftpr = cpdDirectory({ name: "FTPR" });
    const rbep = cpdDirectory({ name: "RBEP" });
    const bytes = new Uint8Array(ftpr.length * 3);
    bytes.set(ftpr, 0);
    bytes.set(rbep, ftpr.length);
    bytes.set(ftpr, ftpr.length * 2);

    const found = findPrecedingCpd(bytes, ftpr.length * 3);
    expect(found?.offset).toBe(ftpr.length * 2);
    expect(found?.header.partitionName).toBe("FTPR");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPDTests.swift#CPDParserTests.testFindPrecedingCPDReturnsNilOutsideWindow
  it("does not reach past the window a directory can be in", () => {
    const directory = cpdDirectory({ name: "FTPR" });
    const bytes = new Uint8Array(directory.length + 0x3000);
    bytes.set(directory);

    expect(findPrecedingCpd(bytes, directory.length + 0x3000)).toBeUndefined();
  });
});
