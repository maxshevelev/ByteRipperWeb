import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { amdMicrocodeDate, readAMDMicrocode } from "@/firmware/uefi/amdMicrocode";
import { itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * AMD microcode read out of padding (`UEFI_IMAGE_FORMAT.md` §7.2): a header with no
 * signature, checked field by field as the reference checks it.
 */

/**
 * A Cezanne patch's header, as `SPI_EF6018_128Mbit.*` carries it: 2023-07-07, revision
 * `0A50000F`, loader `8005`, CPUID `00A50F00`.
 */
function header(
  options: {
    year?: number;
    month?: number;
    day?: number;
    revision?: number;
    loader?: number;
    signature?: number;
    dataSize?: number;
  } = {}
): Uint8Array {
  const bytes = new Uint8Array(0x20);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, options.year ?? 0x2023, true);
  view.setUint8(2, options.day ?? 0x07);
  view.setUint8(3, options.month ?? 0x07);
  view.setUint32(4, options.revision ?? 0x0a50000f, true);
  view.setUint16(8, options.loader ?? 0x8005, true);
  view.setUint8(10, options.dataSize ?? 0);
  view.setUint16(0x18, options.signature ?? 0xa500, true);
  return bytes;
}

/** `patch` at `offset` in bytes no scan reads anything else in. */
function image(patch: Uint8Array, offset = 0x1000, size = 0x4000): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x11);
  bytes.set(patch, offset);
  return bytes;
}

const read = (bytes: Uint8Array, limit = 0x4000) =>
  readAMDMicrocode(0x1000, limit, new ImageReader(sourceOver(bytes)));

describe("AMD microcode", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDMicrocodeTests.swift#AMDMicrocodeTests.testAPatchInPaddingIsARowOfItsOwn
  it("makes a patch in padding a row of its own", () => {
    const parsed = parseUefiImage(sourceOver(image(header())));
    const padding = parsed.roots[0];

    expect(padding?.kind).toBe("padding");
    expect(padding?.body).toEqual({ start: 0, end: 0x4000 });
    expect(padding?.children.map((node) => node.kind)).toEqual([
      "padding",
      "amdMicrocode",
      "padding",
    ]);
    const patch = padding?.children[1];
    expect(patch?.name).toBe("AMD microcode A50F00, revision A50000F");
    // Family A5 is 0x15C0 long.
    expect(patch && { start: patch.header.start, end: patch.body.end }).toEqual({
      start: 0x1000,
      end: 0x1000 + 0x15c0,
    });
    expect(patch?.header).toEqual({ start: 0x1000, end: 0x1020 });
    expect(patch && itemType(patch)).toBe(ItemType.amdMicrocode);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDMicrocodeTests.swift#AMDMicrocodeTests.testTheHeaderReadsAsTheReferenceReadsIt
  it("reads the header as the reference reads it", () => {
    const patch = read(image(header({ revision: 0x08600106, loader: 0x8004, signature: 0x8600 })));
    expect(patch?.processorSignature).toBe(0x8600);
    // Families 80–8A are 0xC80 long.
    expect(patch?.length).toBe(0xc80);
    expect(patch && amdMicrocodeDate(patch)).toBe("2023-07-07");
  });

  /**
   * A patch AMD shipped dated the thirteenth month is read with the date the
   * reference gives it. An old family's header says its own length: `0x20` of data is a
   * patch of `0x3C0`.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDMicrocodeTests.swift#AMDMicrocodeTests.testAKnownMisdatedPatchIsPutRight
   */
  it("puts a known misdated patch right", () => {
    const patch = read(
      image(
        header({
          year: 0x2013,
          month: 0x13,
          day: 0x10,
          revision: 0x03000027,
          loader: 0x8004,
          signature: 0x3010,
          dataSize: 0x20,
        })
      )
    );
    expect(patch && amdMicrocodeDate(patch)).toBe("2013-12-10");
    expect(patch?.length).toBe(0x3c0);
  });

  /**
   * A field AMD never writes, a date that is no date, or nothing after the header:
   * data, not a patch, and nothing said about it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDMicrocodeTests.swift#AMDMicrocodeTests.testAHeaderThatDoesNotCheckOutIsNoPatch
   */
  it("takes a header that does not check out for no patch", () => {
    const rejected = [
      header({ loader: 0x7005 }),
      header({ month: 0x1a }),
      header({ day: 0x00 }),
      header({ year: 0x2030 }),
      // A family the size table does not know.
      header({ signature: 0xc000 }),
    ];
    for (const bytes of rejected) expect(read(image(bytes))).toBeUndefined();
    const silent = image(header());
    silent.fill(0, 0x1040, 0x1044);
    expect(read(silent)).toBeUndefined();
    // A patch the space ends inside is not one.
    expect(read(image(header()), 0x1000 + 0x1000)).toBeUndefined();
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDMicrocodeTests.swift#AMDMicrocodeTests.testPatchesOneAfterAnotherAreEachARow
  it("makes patches one after another a row each", () => {
    const first = header({ loader: 0x8004, signature: 0x8181 });
    const second = header({ loader: 0x8004, signature: 0x8180 });
    const bytes = image(first);
    bytes.set(second, 0x1d00);
    const rows = parseUefiImage(sourceOver(bytes)).roots[0]?.children ?? [];

    expect(
      rows.filter((node) => node.kind === "amdMicrocode").map((node) => node.header.start)
    ).toEqual([0x1000, 0x1d00]);
  });
});
