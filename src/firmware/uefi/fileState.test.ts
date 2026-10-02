import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { repairsForFile } from "@/firmware/uefi/checksumRepair";
import { marksHeaderInvalid } from "@/firmware/uefi/fileParser";
import { makeNode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `FileStateTests.swift`: what a file's state byte says about its
 * header (§5.5), read under the volume's erase polarity and under the file's own
 * polarity bit.
 */

describe("a file's state byte", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FileStateTests.swift#FileStateTests.testAnOrdinaryFileIsNotMarked
  it("does not mark an ordinary file", () => {
    // Header and data valid, stored inverted under polarity 1.
    expect(marksHeaderInvalid(0xf8, true)).toBe(false);
    // Marked for update, then deleted: still a header, not an invalid one.
    expect(marksHeaderInvalid(0xf0, true)).toBe(false);
    expect(marksHeaderInvalid(0xe0, true)).toBe(false);
    // Under polarity 0 the same states are written straight.
    expect(marksHeaderInvalid(0x07, false)).toBe(false);
  });

  // Every bit written under polarity 1 is header invalid; under its own polarity
  // bit, 0 — nothing is marked valid. Invalid both ways.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FileStateTests.swift#FileStateTests.testEveryBitWrittenMarksTheHeaderInvalid
  it("marks the header invalid when every bit is written", () => {
    expect(marksHeaderInvalid(0x00, true)).toBe(true);
    expect(marksHeaderInvalid(0x00, undefined)).toBe(true);
    // HEADER_INVALID set on top of a valid header, polarity 1.
    expect(marksHeaderInvalid(0xd8, true)).toBe(true);
  });

  // Invalid under the volume's polarity and valid under the file's own: a file
  // written the other way round, which is checked as a file.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FileStateTests.swift#FileStateTests.testValidUnderEitherReadingIsNotMarked
  it("does not mark a file valid under either reading", () => {
    expect(marksHeaderInvalid(0x07, true)).toBe(false);
    expect(marksHeaderInvalid(0x07, undefined)).toBe(false);
  });

  // A file that owes no checksum has nothing to repair.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/FileStateTests.swift#FileStateTests.testAFileMarkedInvalidHasNoRepairs
  it("has no repairs for a file marked invalid", () => {
    const body = Uint8Array.of(1, 2);
    const bytes = Test.file({ state: 0x00, body, headerChecksum: 0x11, bodyChecksum: 0x22 });
    const file = makeNode({
      kind: "file",
      name: "",
      header: { start: 0, end: 0x18 },
      body: { start: 0x18, end: 0x1a },
    });
    expect(repairsForFile(file, 2, new ImageReader(sourceOver(bytes)), true)).toEqual([]);

    const ordinary = Test.file({ state: 0xf8, body, headerChecksum: 0x11, bodyChecksum: 0x22 });
    // An ordinary file with both sums stale.
    expect(repairsForFile(file, 2, new ImageReader(sourceOver(ordinary)), true)).toHaveLength(2);
  });
});
