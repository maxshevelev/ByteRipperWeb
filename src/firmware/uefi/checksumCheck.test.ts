import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import {
  type ChecksumRepair,
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
  volumeAlongPath,
} from "@/firmware/uefi/checksumRepair";
import { sum32Of } from "@/firmware/uefi/checksums";
import { FFS } from "@/firmware/uefi/fileParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

const parse = (image: Uint8Array) => parseUefiImage(sourceOver(image));
const reader = (image: Uint8Array) => new ImageReader(sourceOver(image));

/** The image with the repairs written back: what Fix Checksum leaves. */
const applying = (repairs: readonly ChecksumRepair[], image: Uint8Array) => {
  const edited = Uint8Array.from(image);
  for (const repair of repairs) edited.set(repair.bytes, repair.offset);
  return edited;
};

/** The image's only volume. */
const volumeIn = (image: Uint8Array) => parse(image).roots[0] as UEFINode;
/** The first file of its only volume. */
const fileIn = (image: Uint8Array) => volumeIn(image).children[0] as UEFINode;

/** Where in its header a file's checksum write lands: 0x10 is the header's, 0x11 the body's. */
const fieldsOf = (file: UEFINode, repairs: readonly ChecksumRepair[]) =>
  repairs.map((repair) => repair.offset - file.header.start);

const HEADER = 0x10;
const BODY = 0x11;

/**
 * Which checksum fields of a node are wrong, found the same way a fix would be:
 * the repairs return only the writes that differ, so empty means valid and
 * non-empty is both the flag and the fix.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests
 * @upstream-differs a field is told by where its repair lands, not by a field set: the port's row says what is wrong in a sentence (`UEFIChecksumField` is n/a)
 */
describe("which checksum is wrong", () => {
  describe("a volume", () => {
    // A volume whose stored checksum disagrees with its header is flagged, and
    // the fix repairs exactly the checksum bytes.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testACorruptVolumeHeaderFlagsVolume
    it("flags a corrupt header", () => {
      const image = Test.volume({ length: 0x400 });
      image[0x05] = (image[0x05] ?? 0) + 1; // a GUID byte

      const repairs = repairsForVolume(volumeIn(image), reader(image));
      expect(repairs.map((one) => one.offset)).toEqual([0x32]);

      // Writing back the repair clears the flag.
      const fixed = applying(repairs, image);
      expect(repairsForVolume(volumeIn(fixed), reader(fixed))).toEqual([]);
    });

    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testAValidVolumeIsNotFlagged
    it("does not flag a valid one", () => {
      const image = Test.volume({ length: 0x400 });
      expect(repairsForVolume(volumeIn(image), reader(image))).toEqual([]);
    });
  });

  describe("a file inside a volume", () => {
    // With the checksum attribute bit set a file checks its body by sum; a
    // flipped body byte is the body's field and a flipped header byte is the
    // header's. Both start from a fully valid file so the other cannot leak in.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testFileHeaderAndBodyAreDistinctFields
    it("tells the header's field from the body's", () => {
      const valid = Test.volume({
        files: [Test.file({ attributes: 0x44, body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })],
      });
      const file = fileIn(valid);
      expect(repairsForFile(file, 2, reader(valid))).toEqual([]);

      const bodyCorrupt = Uint8Array.from(valid);
      bodyCorrupt[file.header.start + 0x18] = 0xee; // the body's first byte
      expect(fieldsOf(file, repairsForFile(fileIn(bodyCorrupt), 2, reader(bodyCorrupt)))).toEqual([
        BODY,
      ]);

      const headerCorrupt = Uint8Array.from(valid);
      headerCorrupt[file.header.start] = (headerCorrupt[file.header.start] ?? 0) ^ 0xff; // a GUID byte
      expect(
        fieldsOf(file, repairsForFile(fileIn(headerCorrupt), 2, reader(headerCorrupt)))
      ).toEqual([HEADER]);
    });

    // With the checksum attribute bit unset a file's body must hold the fixed
    // value of the volume's revision — 0x5A for revision 1, 0xAA for revision 2
    // — and the body is flagged when it holds the other one.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testUncheckedFileBodyHonoursTheVolumeRevision
    it.each([
      { revision: 1, own: FFS.fixedChecksum, other: FFS.fixedChecksum2 },
      { revision: 2, own: FFS.fixedChecksum2, other: FFS.fixedChecksum },
    ])("wants revision $revision's fixed body value", ({ revision, own, other }) => {
      const valid = Test.volume({
        files: [Test.file({ attributes: 0x04, body: new Uint8Array([1, 2]), bodyChecksum: own })],
      });
      const file = fileIn(valid);
      expect(repairsForFile(file, revision, reader(valid))).toEqual([]);

      const wrongBody = Uint8Array.from(valid);
      wrongBody[file.header.start + BODY] = other;
      // The other revision's value is the wrong one, and it is the body's field.
      expect(
        fieldsOf(file, repairsForFile(fileIn(wrongBody), revision, reader(wrongBody)))
      ).toEqual([BODY]);
    });

    // The revision a file is checked against is its volume's, read from the
    // volume's subtype; a file with no volume above it has no revision of its own.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testVolumeRevisionComesFromTheContainingVolume
    // @upstream-differs revision 1 rather than 3: the fixture goes through the parser, which reads only a volume of revision 1 or 2 as a volume, where upstream builds the node by hand
    it("checks a file against its own volume's revision", () => {
      // Revision 1, so the answer cannot be the default the path falls back on.
      const held = parse(
        Test.volume({ revision: 1, files: [Test.file({ body: new Uint8Array([1, 2, 3, 4]) })] })
      );
      const found = volumeAlongPath(held.roots, [0, 0]);
      expect(found.volume?.kind).toBe("volume");
      expect(found.revision).toBe(1);

      // Nothing above the node: no volume to read a revision from.
      expect(volumeAlongPath([], [0]).volume).toBeUndefined();
    });
  });

  describe("microcode", () => {
    // A microcode image is flagged when a dword anywhere in its range is off,
    // and the fix lands on the single checksum dword.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testACorruptMicrocodeFlagsMicrocode
    it("flags a corrupt image, and fixes the one dword", () => {
      const corrupt = Test.microcode();
      corrupt[0x60] = (corrupt[0x60] ?? 0) + 1; // a body byte
      const node = parse(corrupt).roots[0] as UEFINode;

      const repairs = repairsForMicrocode(node, reader(corrupt));
      expect(repairs.length).toBe(1);
      expect(repairs[0]?.offset).toBe(0x10);

      const fixed = applying(repairs, corrupt);
      expect(repairsForMicrocode(parse(fixed).roots[0] as UEFINode, reader(fixed))).toEqual([]);
    });

    // Writing back what the repair says makes the whole image sum to zero — the
    // round trip every valid case above rests on.
    // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIChecksumCheckTests.swift#UEFIChecksumCheckTests.testWritingTheRepairMakesASumZeroImage
    it("makes the image sum to zero once written back", () => {
      const image = Test.microcode({ checksum: 0x1234 });
      const node = parse(image).roots[0] as UEFINode;
      const fixed = applying(repairsForMicrocode(node, reader(image)), image);
      // The fixture is the microcode and nothing else, so the image is its range.
      expect(sum32Of({ start: 0, end: fixed.length }, reader(fixed))).toBe(0);
    });
  });
});
