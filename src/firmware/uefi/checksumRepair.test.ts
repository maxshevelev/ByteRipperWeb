import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import {
  type ChecksumRepair,
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
} from "@/firmware/uefi/checksumRepair";
import { FFS } from "@/firmware/uefi/fileParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";

/** Ported from `ChecksumRepairTests.swift`: putting back what an edit invalidates. */

const bytes = (...values: number[]) => new Uint8Array(values);
const parse = (image: Uint8Array) => parseUefiImage(sourceOver(image));
const reader = (image: Uint8Array) => new ImageReader(sourceOver(image));

const applying = (repairs: readonly ChecksumRepair[], image: Uint8Array) => {
  const edited = Uint8Array.from(image);
  for (const repair of repairs) edited.set(repair.bytes, repair.offset);
  return edited;
};

describe("repairing a file", () => {
  // The test that matters: repair, write, parse again, and the image no longer
  // complains.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testRepairingAFileBodyLeavesNothingToComplainAbout
  it("leaves nothing to complain about after a body edit", () => {
    const image = Test.volume({
      files: [Test.file({ attributes: FFS.checksumBit, body: bytes(1, 2, 3, 4, 5, 6, 7, 8) })],
    });
    image[0x64] = 0x99; // an edit inside the body
    const parsed = parse(image);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const repairs = repairsForFile(parsed.roots[0]?.children[0] as never, 2, reader(image));

    expect(repairs.map((one) => one.offset)).toEqual([0x59]);
    expect(parse(applying(repairs, image)).diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testRepairingAFileHeaderLeavesNothingToComplainAbout
  it("leaves nothing to complain about after a header edit", () => {
    const image = Test.volume({ files: [Test.file({ body: bytes(1, 2, 3, 4) })] });
    image[0x52] = 0x0a; // the file's type byte
    const parsed = parse(image);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const repairs = repairsForFile(parsed.roots[0]?.children[0] as never, 2, reader(image));

    expect(repairs.map((one) => one.offset)).toEqual([0x58]);
    expect(parse(applying(repairs, image)).diagnostics).toEqual([]);
  });

  // A file with nothing wrong with it needs no writes, and an empty list is how
  // that gets said.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testAFileThatIsAlreadyRightNeedsNoRepair
  it("needs no repair when it is already right", () => {
    const image = Test.volume({ files: [Test.file({ body: bytes(1, 2, 3, 4) })] });
    const parsed = parse(image);

    expect(repairsForFile(parsed.roots[0]?.children[0] as never, 2, reader(image))).toEqual([]);
  });

  // Without the checksum attribute the field holds a fixed value, and which one
  // depends on the volume's revision.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testTheFixedBodyChecksumFollowsTheVolumeRevision
  it("follows the volume revision for the fixed body checksum", () => {
    const image = Test.volume({ files: [Test.file({ body: bytes(1, 2), bodyChecksum: 0x00 })] });
    const file = parse(image).roots[0]?.children[0] as never;

    expect([...(repairsForFile(file, 2, reader(image))[0]?.bytes ?? [])]).toEqual([
      FFS.fixedChecksum2,
    ]);
    expect([...(repairsForFile(file, 1, reader(image))[0]?.bytes ?? [])]).toEqual([
      FFS.fixedChecksum,
    ]);
  });
});

describe("repairing a volume header", () => {
  // A volume's checksum covers its own header and nothing below it, which is
  // the one mercy in this format: editing a file does not cascade upwards.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testRepairingAVolumeHeaderLeavesNothingToComplainAbout
  it("leaves nothing to complain about", () => {
    const image = Test.volume({ length: 0x400 });
    image[0x37] = 0x02; // Revision, inside the header
    image[0x2c] = 0x0b; // Attributes, likewise
    const parsed = parse(image);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const repairs = repairsForVolume(parsed.roots[0] as never, reader(image));

    expect(repairs.map((one) => one.offset)).toEqual([0x32]);
    expect(parse(applying(repairs, image)).diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testAVolumeThatIsAlreadyRightNeedsNoRepair
  it("needs no repair when it is already right", () => {
    const image = Test.volume({ length: 0x400 });
    expect(repairsForVolume(parse(image).roots[0] as never, reader(image))).toEqual([]);
  });
});

describe("repairing microcode", () => {
  // Microcode checks out when every dword of it sums to zero, so a body edit
  // moves the field by exactly the amount the sum moved.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testRepairingMicrocodeLeavesNothingToComplainAbout
  it("leaves nothing to complain about", () => {
    const image = Test.microcode();
    image[0x40] = 0x77;
    const parsed = parse(image);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const repairs = repairsForMicrocode(parsed.roots[0] as never, reader(image));

    expect(repairs.map((one) => one.offset)).toEqual([0x10]);
    expect(parse(applying(repairs, image)).diagnostics).toEqual([]);
  });
});

/**
 * The helpers answer for the structure they are named for and not for whatever
 * node is handed to them — checked against nodes that would each yield a repair
 * if the kind were not looked at.
 */
describe("which node a repair will answer for", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ChecksumRepairTests.swift#ChecksumRepairTests.testARepairAsksForTheRightKindOfNode
  it("asks for the right kind", () => {
    const image = Test.volume({ length: 0x400, files: [Test.file({ body: bytes(1, 2, 3, 4) })] });
    image[0x00] = 0x11; // a volume header worth repairing
    image[0x52] = 0x0a; // a file header worth repairing
    const parsed = parse(image);
    const source = reader(image);
    const volume = parsed.roots[0] as never;
    const file = (parsed.roots[0]?.children[0] ?? {}) as never;

    expect(repairsForVolume(volume, source).length).toBeGreaterThan(0);
    expect(repairsForFile(file, 2, source).length).toBeGreaterThan(0);

    const asFile = { ...(volume as object), kind: "file" } as never;
    const asMicrocode = { ...(file as object), kind: "microcode" } as never;
    expect(repairsForVolume(asFile, source)).toEqual([]);
    expect(repairsForFile(asMicrocode, 2, source)).toEqual([]);
    expect(repairsForMicrocode(volume, source)).toEqual([]);
  });
});
