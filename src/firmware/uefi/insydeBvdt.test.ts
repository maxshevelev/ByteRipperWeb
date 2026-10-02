import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { ascii, BVDT_COMPILER_AND_ESRT, bvdtTable } from "@/firmware/testing/testInsyde";
import { guidText } from "@/firmware/uefi/efiGuid";
import { readInsydeBvdt } from "@/firmware/uefi/insydeBvdt";

/**
 * Ported from `InsydeBVDTTests.swift`: Insyde's `$BVDT$` table
 * (`UEFI_IMAGE_FORMAT.md` §9), laid out the way the dumps at hand lay it out.
 */

const read = (bytes: Uint8Array) =>
  readInsydeBvdt({ start: 0, end: bytes.length }, new ImageReader(sourceOver(bytes)));

describe("an Insyde BVDT table", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testTheStringsAndTheDateAreRead
  it("reads the strings and the date", () => {
    expect(read(bvdtTable())).toEqual({
      biosVersion: "J2CN57WW",
      productName: "Legion 570 Series Intel",
      kernelVersion: "05.43.44",
      releaseDate: "2024-01-08",
      compilerVersion: undefined,
      esrtVersion: undefined,
      esrtClass: undefined,
      listedRanges: [
        { start: 0xaa000, end: 0xab000 },
        { start: 0xc4_0000, end: 0xd0_0000 },
      ],
    });
  });

  // The compiler the firmware was built with, and the board's ESRT entry: the
  // version, then the firmware class Windows Update knows it by.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testTheCompilerAndTheESRTEntryAreRead
  it("reads the compiler and the ESRT entry", () => {
    const table = read(bvdtTable({ records: BVDT_COMPILER_AND_ESRT }));
    expect(table?.compilerVersion).toBe(1600);
    expect(table?.esrtVersion).toBe(0x7022_4057);
    expect(table?.esrtClass === undefined ? undefined : guidText(table.esrtClass)).toBe(
      "94F9614C-E5F2-4692-81AE-20E9C61A8664"
    );
  });

  // Three pairs fill the record, and the next record follows them; an erased
  // slot, or a list cut short with no `$`, ends it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testTheListedRangesStopAtAnErasedSlotOrAMissingSeparator
  it("stops the listed ranges at an erased slot or a missing separator", () => {
    const three = [
      0x00, 0x80, 0x48, 0x00, 0x00, 0x10, 0x00, 0x00, 0x24, 0x00, 0x00, 0x56, 0x00, 0x00, 0x00,
      0x0a, 0x00, 0x24, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0xff,
    ];
    expect(read(bvdtTable({ ranges: three }))?.listedRanges).toEqual([
      { start: 0x48_8000, end: 0x48_9000 },
      { start: 0x56_0000, end: 0x60_0000 },
      { start: 0x2_0000, end: 0x3_0000 },
    ]);
    const one = [...three.slice(0, 8), 0xff];
    expect(read(bvdtTable({ ranges: one }))?.listedRanges).toEqual([
      { start: 0x48_8000, end: 0x48_9000 },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testWithoutTheSignatureThereIsNoTable
  it("is no table without the signature", () => {
    const bytes = bvdtTable();
    bytes[1] = 0x58; // X
    expect(read(bytes)).toBeUndefined();
  });

  // A field whose `$` is not where the layout puts it, or that is empty, is not
  // guessed at.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testAFieldOutOfPlaceOrEmptyIsAbsent
  it("leaves a field out of place or empty absent", () => {
    const bytes = bvdtTable({ kernel: "" });
    bytes[0x26] = 0;
    const table = read(bytes);
    expect(table?.biosVersion).toBe("J2CN57WW");
    expect(table?.productName).toBeUndefined();
    expect(table?.kernelVersion).toBeUndefined();
  });

  // Three bytes that are not a BCD date are not one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testADateThatIsNotBCDIsAbsent
  it("leaves a date that is not BCD absent", () => {
    const table = read(bvdtTable({ records: [...ascii("$RDATE"), 0x24, 0x1a, 0x08] }));
    expect(table).toBeDefined();
    expect(table?.releaseDate).toBeUndefined();
  });

  // The records end at `$ENDOFBVDT`; a tag after it is not the table's.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/InsydeBVDTTests.swift#InsydeBVDTTests.testATagAfterTheEndIsNotRead
  it("does not read a tag after the end", () => {
    const table = read(
      bvdtTable({ records: [], afterEnd: [...ascii("$RDATE"), 0x24, 0x01, 0x08] })
    );
    expect(table?.releaseDate).toBeUndefined();
  });
});
