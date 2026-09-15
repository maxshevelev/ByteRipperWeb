import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT, sizeInBytes, versionText } from "@/firmware/fit/fitEntry";
import { readFitTable, tableEntries, tableHeader } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";

/** Ported from `FITReaderTests.swift`: finding the table and reading it. */

const MICROCODE_AT = 0x2000;
const read = (image: Uint8Array, parsed?: UEFIImage) =>
  readFitTable(new ImageReader(sourceOver(image)), parsed);

const ordinaryImage = () =>
  Test.fitImage({
    rows: [{ type: FIT.microcodeType, target: MICROCODE_AT }],
    contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
  });

describe("finding the table", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testTheTableIsFoundThroughThePointer
  it("finds it through the pointer", () => {
    const report = read(ordinaryImage());

    expect(report.table?.range).toEqual({ start: 0x1000, end: 0x1020 });
    expect(report.table?.pointerOffset).toBe(0xffc0);
    expect(report.table?.pointerAddress).toBe(0xffff_1000);
    expect(report.table?.rows).toHaveLength(2);
    expect(tableEntries(report.table as never)).toHaveLength(1);
    expect(report.problems).toEqual([]);
  });

  // The header's `Size` counts entries, not bytes — the field everyone reads
  // wrong.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testTheHeaderCountsEntriesRatherThanBytes
  it("counts entries rather than bytes", () => {
    const report = read(
      Test.fitImage({
        rows: [
          { type: FIT.microcodeType, target: MICROCODE_AT },
          { type: FIT.startupACMType, target: 0x3000 },
        ],
        contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
      })
    );

    expect(tableHeader(report.table as never)?.size).toBe(3);
    expect((report.table?.range.end ?? 0) - (report.table?.range.start ?? 0)).toBe(3 * 16);
  });

  /**
   * The pointer lives at a physical address, and only in a full flash dump is
   * that the same as forty bytes before the end of the file. An image with
   * anything after its volume top file puts it somewhere else entirely.
   */
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testThePointerIsFoundByAddressAndNotFromTheEndOfTheFile
  it("finds the pointer by address and not from the end of the file", () => {
    const diff = 0xffff_1000; // a volume top file ending at 0xF000
    const image = Test.fitImage({
      rows: [{ type: FIT.microcodeType, target: MICROCODE_AT }],
      addressDiff: diff,
      contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
    });
    const parsed = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: diff });

    const report = read(image, parsed);

    expect(report.table?.pointerOffset).toBe(0xefc0);
    expect(report.table?.range).toEqual({ start: 0x1000, end: 0x1020 });
    expect(report.problems).toEqual([]);
  });
});

describe("the address mapping", () => {
  /**
   * Without a volume top file the image is taken to be mapped against the top
   * of the address space. That is true of a full flash dump and false of a
   * region cut out of one, so the reading says which it did — but as a caveat
   * about itself, not as a problem with the table.
   */
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAnAssumedAddressMappingIsSaidOutLoud
  it("says out loud when it was assumed", () => {
    const report = read(ordinaryImage());

    expect(report.addressDiffIsAssumed).toBe(true);
    expect(report.addressDiff).toBe(0xffff_0000);
    expect(report.problems).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAKnownAddressMappingIsUsedAsItIs
  it("uses a known mapping as it is", () => {
    const parsed = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 });

    const report = read(ordinaryImage(), parsed);

    expect(report.addressDiffIsAssumed).toBe(false);
    expect(report.problems).toEqual([]);
    expect(report.table?.range).toEqual({ start: 0x1000, end: 0x1020 });
  });
});

describe("a table the pointer does not lead to", () => {
  /**
   * Both sides of the link are worth checking: a pointer that leads nowhere
   * does not mean there is no table, and the one the scan finds is still worth
   * showing the user.
   */
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAPointerLeadingNowhereStillFindsTheTableByScanning
  it("is still found by scanning", () => {
    const image = Test.fitImage({
      rows: [{ type: FIT.microcodeType, target: MICROCODE_AT }],
      pointerAddress: 0xffff_5000,
      contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
    });

    const report = read(image);

    expect(report.table).toBeUndefined();
    expect(report.candidates).toEqual([0x1000]);
    expect(
      report.problems.some(
        (one) => one.detail.kind === "noTableAtThePointer" && one.detail.address === 0xffff_5000
      )
    ).toBe(true);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAPointerOutsideTheImageIsReported
  it("reports a pointer outside the image", () => {
    const image = Test.fitImage({
      rows: [{ type: FIT.microcodeType, target: MICROCODE_AT }],
      pointerAddress: 0x1000,
    });

    const report = read(image);

    expect(report.table).toBeUndefined();
    expect(
      report.problems.some(
        (one) => one.detail.kind === "pointerLeadsOutsideTheImage" && one.detail.address === 0x1000
      )
    ).toBe(true);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAnImageWithNoRoomForAPointerIsReported
  it("reports an image with no room for a pointer", () => {
    const report = read(new Uint8Array(0x20).fill(0xff));

    expect(report.table).toBeUndefined();
    expect(report.problems.some((one) => one.detail.kind === "imageHasNoPointer")).toBe(true);
  });
});

describe("a header that cannot be believed", () => {
  // A count of zero, believed, is a table of nothing.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testAHeaderWithNoEntriesIsReported
  it("reports a header with no entries", () => {
    const report = read(Test.fitImage({ rows: [], entryCount: 0 }));

    expect(report.table).toBeUndefined();
    expect(report.problems.some((one) => one.detail.kind === "tableHasNoEntries")).toBe(true);
  });

  // A count that runs past the end: read what is there, and say the rest is not.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testATableRunningPastTheEndIsCutAndReported
  it("cuts a table running past the end, and reports it", () => {
    const image = Test.fitImage({
      size: 0x1_0000,
      tableOffset: 0xffe0,
      rows: [{ type: FIT.microcodeType, target: MICROCODE_AT }],
      entryCount: 0x100,
      contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
    });

    const report = read(image);

    expect(report.table?.rows).toHaveLength(2);
    expect(
      report.problems.some(
        (one) => one.detail.kind === "tableRunsPastTheEnd" && one.detail.entries === 0x100
      )
    ).toBe(true);
  });
});

describe("a row", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testARowIsReadFieldByField
  it("is read field by field", () => {
    const image = Test.fitImage({
      rows: [
        { type: FIT.cseSecureBootType, target: 0x3000, size: 2, reserved: 8, version: 0x0100 },
      ],
      contents: new Map([[MICROCODE_AT, Test.fitMicrocode()]]),
    });

    const entry = tableEntries(read(image).table as never)[0]?.entry;

    expect(entry?.index).toBe(1);
    expect(entry?.offset).toBe(0x1010);
    expect(entry?.address).toBe(0xffff_3000);
    expect(entry?.size).toBe(2);
    expect(entry === undefined ? undefined : sizeInBytes(entry)).toBe(0x20);
    expect(entry?.reserved).toBe(8);
    expect(entry === undefined ? undefined : versionText(entry)).toBe("1.00");
    expect(entry?.type).toBe(FIT.cseSecureBootType);
    expect(entry?.checksumValid).toBe(false);
  });

  // The seven-bit type and the eighth bit that is not part of it.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITReaderTests.swift#FITReaderTests.testTheChecksumValidBitIsNotPartOfTheType
  it("keeps the checksum-valid bit out of the type", () => {
    const image = Test.fitImage({ rows: [], entryCount: 1, checksumValid: true });

    expect(tableHeader(read(image).table as never)?.type).toBe(FIT.headerType);
    expect(read(image).table?.checksumIsChecked).toBe(true);
  });
});
