import { describe, expect, it } from "vitest";
import { ascii } from "@/firmware/testing/testInsyde";
import { readAppleROMInformation } from "@/firmware/uefi/appleRomInformation";
import { readBIOSIdentifier } from "@/firmware/uefi/biosIdentifier";

/** Ported from `FirmwareTextBlockTests.swift`: the two text blocks of an Apple image. */

/** UTF-16, little-endian, NUL-terminated — the way the blocks sit in the file. */
const utf16 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const character of text) {
    const unit = character.charCodeAt(0);
    bytes.push(unit & 0xff, unit >> 8);
  }
  bytes.push(0, 0);
  return Uint8Array.from(bytes);
};

describe("the BIOS ID", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FirmwareTextBlockTests.swift#FirmwareTextBlockTests.testABIOSIDIsTakenApartIntoItsFiveParts
  it("is taken apart into its five parts", () => {
    const id = readBIOSIdentifier(
      new Uint8Array([
        ...ascii("$IBIOSI$"),
        ...utf16("   MBA71.88Z.F000.B00.1906140921"),
        ...ascii("Copyright"),
      ])
    );

    expect(id?.text).toBe("MBA71.88Z.F000.B00.1906140921");
    expect([id?.board, id?.oem, id?.majorVersion, id?.minorVersion]).toEqual([
      "MBA71",
      "88Z",
      "F000",
      "B00",
    ]);
    expect(id?.buildDate).toBe("2019-06-14 09:21");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FirmwareTextBlockTests.swift#FirmwareTextBlockTests.testAStringOfAnotherShapeKeepsOnlyItsText
  it("keeps only the text of a string of another shape", () => {
    const id = readBIOSIdentifier(
      new Uint8Array([...ascii("$IBIOSI$"), ...utf16("SOMETHING ELSE")])
    );

    expect(id?.text).toBe("SOMETHING ELSE");
    expect(id?.board).toBeUndefined();
    expect(readBIOSIdentifier(utf16("MBA71.88Z.F000.B00.1906140921"))).toBeUndefined();
  });
});

describe("the Apple ROM information", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FirmwareTextBlockTests.swift#FirmwareTextBlockTests.testTheROMInformationIsAListOfKeysAndValues
  it("is a list of keys and values", () => {
    const text =
      "Apple ROM Version\n  BIOS ID:      MBP141.88Z.0167.B00.1708080034\n  Date:         Tue Aug  8 00:34:33 2017\n  UUID:         A\n  UUID:         B\n\n";
    const info = readAppleROMInformation(new Uint8Array([0xff, 0xff, ...ascii(text), 0, 0xff]));

    expect(info?.entries.map((one) => one.key)).toEqual(["BIOS ID", "Date", "UUID", "UUID"]);
    expect(info?.entries[1]?.value).toBe("Tue Aug  8 00:34:33 2017");
    expect(readAppleROMInformation(Uint8Array.from(ascii("nothing here")))).toBeUndefined();
  });
});
