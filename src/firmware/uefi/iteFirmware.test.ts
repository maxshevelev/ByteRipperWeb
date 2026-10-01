import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { volume, volumeTopFile } from "@/firmware/testing/testImage";
import { iteImage } from "@/firmware/testing/testInsyde";
import { allITEFirmware, readITEFirmware } from "@/firmware/uefi/iteFirmware";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `ITEFirmwareTests.swift`: the identification an ITE EC image carries
 * after its signature block (`UEFI_IMAGE_FORMAT.md` §9), and the names it gives
 * the rows it opens.
 */

const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const read = (bytes: Uint8Array) => readITEFirmware(0, bytes.length, reader(bytes));
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

describe("an ITE image's identification", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testTheIdentificationAfterTheBlockIsRead
  it("is read after the block", () => {
    expect(read(iteImage())).toEqual({
      identification: "ITE8380-EC-V1.43",
      start: 0,
      signatureOffset: 0x80,
    });
  });

  // The 8051 parts keep the block at `0x40`, and pad the string with spaces.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testTheBlockAt0x40IsReadAndTheSpacesDropped
  it("is read from a block at 0x40, the spaces dropped", () => {
    const firmware = read(iteImage({ identification: "ITE EC-V13.6  ", at: 0x40 }));
    expect(firmware?.identification).toBe("ITE EC-V13.6");
    expect(firmware?.signatureOffset).toBe(0x40);
  });

  // Text after the sixteen bytes is not part of the identification.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testOnlySixteenBytesAreRead
  it("is sixteen bytes and no more", () => {
    const bytes = iteImage({ identification: "ITE5507-SB-V0.67" });
    bytes.set(new TextEncoder().encode("20230426"), 0xa0);
    expect(read(bytes)?.identification).toBe("ITE5507-SB-V0.67");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testWithoutTheBlockThereIsNoIdentification
  it("is absent without the block", () => {
    const bytes = iteImage();
    bytes[0x80 + 9] = 0x13;
    expect(read(bytes)).toBeUndefined();
    expect(read(new Uint8Array(0x1000).fill(0xa5))).toBeUndefined();
  });

  // A region can hold more than one image; each starts on a 4 KiB boundary.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testEveryImageInARangeIsFound
  it("is found for every image in a range", () => {
    const bytes = join(
      iteImage({ identification: "ITE5507-SB-V0.67" }),
      new Uint8Array(0x1000),
      iteImage()
    );
    const found = allITEFirmware({ start: 0, end: bytes.length }, reader(bytes));
    expect(found.map((one) => one.identification)).toEqual([
      "ITE5507-SB-V0.67",
      "ITE8380-EC-V1.43",
    ]);
    expect(found.map((one) => one.start)).toEqual([0, 0x2000]);
  });
});

describe("padding that opens on an ITE image", () => {
  const withVolume = (first: Uint8Array) => {
    const bytes = new Uint8Array(0x10000).fill(0xff);
    bytes.set(first, 0);
    bytes.set(volume({ length: 0x1000, lastFile: volumeTopFile() }), 0xf000);
    return (parseUefiImage(sourceOver(bytes)).roots[0] as UEFINode).children[0] as UEFINode;
  };

  // Padding that opens on an ITE image is named by its identification; the bytes
  // stay padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testPaddingOpeningOnAnImageIsNamedByIt
  it("is named by it", () => {
    const first = withVolume(iteImage({ identification: "ITE8226-EC-V0.00" }));
    expect(first.kind).toBe("padding");
    expect(nodeRange(first)).toEqual({ start: 0, end: 0xf000 });
    expect(first.name).toBe("EC firmware (ITE8226-EC-V0.00)");
  });

  // Padding with nothing at `0x40` or `0x80` keeps its name.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ITEFirmwareTests.swift#ITEFirmwareTests.testOtherPaddingKeepsItsName
  it("keeps its name with nothing at 0x40 or 0x80", () => {
    expect(withVolume(iteImage({ at: 0x200 })).name).toBe("Padding");
  });
});
