import { describe, expect, it } from "vitest";
import {
  GUID_ZERO,
  guidBytes,
  guidEquals,
  guidFromBytes,
  guidFromText,
  guidKey,
  guidText,
} from "@/firmware/uefi/efiGuid";

/**
 * The sixteen bytes, and the mixed-endian text everyone writes them as
 * (`Design/UEFI/UEFI_IMAGE_FORMAT.md` §0).
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests
 */
describe("EFI GUID", () => {
  // EFI_FIRMWARE_FILE_SYSTEM2_GUID, as it appears in a specification and as it
  // lies in a volume header. The first three fields are byte-swapped and the
  // last eight are not — get that backwards and every GUID lookup in the parser
  // misses.
  const ffsV2 = "8C8CE578-8A3D-4F1C-9935-896185C32DD3";
  const ffsV2Bytes = new Uint8Array([
    0x78, 0xe5, 0x8c, 0x8c, 0x3d, 0x8a, 0x1c, 0x4f, 0x99, 0x35, 0x89, 0x61, 0x85, 0xc3, 0x2d, 0xd3,
  ]);

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testTheTextFormLaysTheBytesOutMixedEndian
  it("lays the text form's bytes out mixed-endian", () => {
    const parsed = guidFromText(ffsV2);
    expect(parsed).toBeDefined();
    if (parsed === undefined) return;
    expect([...guidBytes(parsed)]).toEqual([...ffsV2Bytes]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testTheBytesPrintBackAsTheSameText
  it("prints the bytes back as the same text", () => {
    expect(guidText(guidFromBytes(ffsV2Bytes))).toBe(ffsV2);
  });

  // Vendors and specifications disagree about case and braces, and a lookup
  // table that has to match theirs exactly is a table with a bug waiting.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testCaseAndBracesAreAccepted
  it("accepts any case and braces", () => {
    expect(guidFromText("{8c8ce578-8a3d-4f1c-9935-896185c32dd3}")).toEqual(guidFromText(ffsV2));
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testMalformedTextIsRejected
  it("rejects malformed text", () => {
    expect(guidFromText("8C8CE578-8A3D-4F1C-9935-896185C32DD")).toBeUndefined(); // short field
    expect(guidFromText("8C8CE578-8A3D-4F1C-9935-896185C32DD3-0")).toBeUndefined(); // extra field
    expect(guidFromText("8C8CE578_8A3D_4F1C_9935_896185C32DD3")).toBeUndefined(); // no dashes
    expect(guidFromText("8C8CE57Z-8A3D-4F1C-9935-896185C32DD3")).toBeUndefined(); // not hex
    expect(guidFromText("")).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testAZeroGuidIsSixteenZeroBytes
  it("makes the zero GUID sixteen zero bytes", () => {
    expect([...guidBytes(GUID_ZERO)]).toEqual(new Array(16).fill(0));
    expect(guidText(GUID_ZERO)).toBe("00000000-0000-0000-0000-000000000000");
  });

  // Every volume, file and GUID-defined section is identified by comparing
  // against a table, so two spellings of one GUID must be one value.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/EFIGUIDTests.swift#EFIGUIDTests.testTwoSpellingsOfOneGuidAreOneValue
  // @upstream-differs a GUID is a plain object here: one value means equal and one table key
  it("makes two spellings of one GUID one value", () => {
    const fromText = guidFromText(ffsV2);
    const fromBytes = guidFromBytes(ffsV2Bytes);
    expect(fromText).toBeDefined();
    if (fromText === undefined) return;
    expect(guidEquals(fromText, fromBytes)).toBe(true);
    expect(new Set([guidKey(fromText), guidKey(fromBytes)]).size).toBe(1);
  });
});
