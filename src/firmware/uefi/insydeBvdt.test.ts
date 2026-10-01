import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { ascii, bvdtTable } from "@/firmware/testing/testInsyde";
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
    });
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
