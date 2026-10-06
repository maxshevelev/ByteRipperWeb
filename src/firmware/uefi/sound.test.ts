import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { wav } from "@/firmware/testing/testSound";
import { itemType } from "@/firmware/uefi/itemClassification";
import { readSound, soundDuration, soundEncodingName } from "@/firmware/uefi/sound";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { ItemType } from "@/firmware/uefi/uefiTypes";

const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

describe("a sound", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testAWAVWhereSectionsWouldBeIsARowOfItsOwn
  it("is a row of its own where sections would be", () => {
    const sound = wav();
    const image = parseUefiImage(
      sourceOver(Test.volume({ files: [Test.file({ type: 0x02, body: sound })] }))
    );
    const file = image.roots[0]?.children[0];
    const data = file?.children[0];

    expect(file?.children.map((node) => node.name)).toEqual(["Non-UEFI data"]);
    expect(data?.children.map((node) => node.kind)).toEqual(["sound"]);
    const row = data?.children[0];
    expect(row?.name).toBe("WAV, 8000 Hz, stereo");
    expect(row && row.body.end - row.body.start).toBe(sound.length);
    // Padding to UEFITool.
    expect(row && itemType(row)).toBe(ItemType.padding);
    expect(image.diagnostics.map((one) => one.detail.kind)).toEqual(["nonUEFIDataInSections"]);

    const read = readSound(0, sound.length, reader(sound));
    expect(read && soundEncodingName(read)).toBe("PCM");
    expect(read?.bitsPerSample).toBe(16);
    expect(read && soundDuration(read)).toBeCloseTo(40 / 8000, 9);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testARIFFThatDoesNotReadThroughIsNoSound
  it("is none when the RIFF does not read through", () => {
    const cut = wav().slice(0, -8);
    expect(readSound(0, cut.length, reader(cut))).toBeUndefined();
    const noData = wav();
    noData.set([0x6a, 0x75, 0x6e, 0x6b], 36);
    expect(readSound(0, noData.length, reader(noData))).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/SectionParseTests.swift#SectionParseTests.testARIFFSizeClaimingMoreThanItsWholeChunksIsASound
  it("is a sound when the RIFF size claims more than its whole chunks", () => {
    const sound = wav();
    new DataView(sound.buffer).setUint32(4, sound.length - 8 + 4, true);

    const read = readSound(0, sound.length, reader(sound));
    expect(read?.range).toEqual({ start: 0, end: sound.length });
  });
});
