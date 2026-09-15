import { describe, expect, it } from "vitest";
import { decodeOromImages } from "@/firmware/me/iup/orom";
import { oromImageSizeBytes } from "@/firmware/me/models/independentFacts";

/** The GSC option ROM scan. Ported from upstream's `GSCOROMDecodeTests`. */

/** @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMFixture.Params */
interface Params {
  efiImageOffset: number;
  oromPayloadOffset: number;
  deviceID: number;
  pciDataHeaderLength: number;
  lastImage: boolean;
  payload: Uint8Array;
}

const ascii = (text: string) => Uint8Array.from(text, (one) => one.charCodeAt(0));

const DEFAULTS: Params = {
  efiImageOffset: 0,
  oromPayloadOffset: 0x38,
  deviceID: 0x1918,
  pciDataHeaderLength: 0x18,
  lastImage: false,
  payload: ascii("$CPD"),
};

/**
 * A header, its PCIR and the payload at the split the decoder works out.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMFixture
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMFixture.image
 */
function oromImage(overrides: Partial<Params> = {}): Uint8Array {
  const p = { ...DEFAULTS, ...overrides };
  const payloadOffset = Math.max(
    0x1c + p.pciDataHeaderLength,
    p.efiImageOffset,
    p.oromPayloadOffset
  );
  const bytes = new Uint8Array(payloadOffset + p.payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0x00, 0xaa55, true);
  view.setUint16(0x02, 8, true);
  view.setUint32(0x04, 0x0000c000, true);
  view.setUint16(0x16, p.efiImageOffset, true);
  view.setUint16(0x18, 0x1c, true);
  view.setUint16(0x1a, p.oromPayloadOffset, true);
  bytes.set(ascii("PCIR"), 0x1c);
  view.setUint16(0x20, 0x8086, true);
  view.setUint16(0x22, p.deviceID, true);
  view.setUint16(0x24, 0x38, true);
  view.setUint16(0x26, p.pciDataHeaderLength, true);
  bytes[0x28] = 0;
  view.setUint32(0x29, 0x000002, true);
  view.setUint16(0x2c, 8, true);
  view.setUint16(0x2e, 1, true);
  bytes[0x30] = 0;
  bytes[0x31] = p.lastImage ? 0x80 : 0x00;
  view.setUint16(0x32, 0x20, true);
  bytes.set(p.payload, payloadOffset);
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

describe("decodeOromImages", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testDecodesHeaderAndPCIR
  it("decodes the header and the PCIR", () => {
    const images = decodeOromImages(oromImage());
    expect(images).toHaveLength(1);
    const image = images?.[0];
    expect(image?.offset).toBe(0);
    expect(image?.header).toMatchObject({
      signature: 0xaa55,
      imageSize: 8,
      initFuncEntryPoint: 0x0000c000,
      pciDataHeaderOffset: 0x1c,
      oromPayloadOffset: 0x38,
    });
    expect(image === undefined ? undefined : oromImageSizeBytes(image.header)).toBe(4096);
    expect(image?.pciData).toMatchObject({
      signature: "PCIR",
      vendorID: 0x8086,
      deviceID: 0x1918,
      pciDataHeaderLength: 0x18,
      classCode: 0x000002,
      revisionLevel: 1,
      lastImage: false,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testPayloadOffsetIsMaxOfSplitFields
  it("takes the payload offset as the largest of the split fields", () => {
    const images = decodeOromImages(oromImage({ efiImageOffset: 0x40, oromPayloadOffset: 0x38 }));
    expect(images?.[0]?.payloadOffset).toBe(0x40);
    expect(images?.[0]?.payloadIsCPD).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testPayloadOffsetDefaultsPastPCIR
  it("puts the default payload past the PCIR", () => {
    expect(decodeOromImages(oromImage())?.[0]?.payloadOffset).toBe(0x38);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testPayloadIsCPDFlag
  it("says whether the payload is a $CPD", () => {
    expect(decodeOromImages(oromImage({ payload: ascii("$CPD") }))?.[0]?.payloadIsCPD).toBe(true);
    expect(decodeOromImages(oromImage({ payload: ascii("$ABC") }))?.[0]?.payloadIsCPD).toBe(false);
    expect(decodeOromImages(oromImage({ payload: new Uint8Array(0) }))?.[0]?.payloadIsCPD).toBe(
      false
    );
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testLastImageReadsBit7
  it("reads the last-image bit", () => {
    expect(decodeOromImages(oromImage({ lastImage: true }))?.[0]?.pciData.lastImage).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testScanFindsImageBuriedInLargerRegion
  it("finds an image inside a larger region", () => {
    const images = decodeOromImages(concat(new Uint8Array(0x80).fill(0xaa), oromImage()));
    expect(images).toHaveLength(1);
    expect(images?.[0]?.offset).toBe(0x80);
    expect(images?.[0]?.pciData.deviceID).toBe(0x1918);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testBaseOffsetShiftsReportedAnchor
  it("reports offsets at the caller's base", () => {
    expect(decodeOromImages(oromImage(), 0x1000)?.[0]?.offset).toBe(0x1000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testScansMultipleBackToBackImages
  it("scans images back to back", () => {
    const first = oromImage();
    const region = concat(first, oromImage({ deviceID: 0x02a0 }), new Uint8Array(0x10).fill(0xff));
    const images = decodeOromImages(region);
    expect(images?.map((one) => one.offset)).toEqual([0, first.length]);
    expect(images?.map((one) => one.pciData.deviceID)).toEqual([0x1918, 0x02a0]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testTruncatedPCIRSkipped
  it("skips a match whose PCIR does not fit", () => {
    expect(decodeOromImages(oromImage().subarray(0, 0x30))).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testReturnsNilWhenNoOROMSignature
  it("finds nothing without the signature", () => {
    expect(decodeOromImages(new Uint8Array(0x100).fill(0x55))).toBeUndefined();
    expect(decodeOromImages(new Uint8Array(0x100))).toBeUndefined();
    const wrong = oromImage();
    wrong[25] = 0x01;
    expect(decodeOromImages(wrong)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/GSCOROMTests.swift#GSCOROMDecodeTests.testReturnsNilForTinyRegion
  it("finds nothing in a tiny region", () => {
    expect(decodeOromImages(new Uint8Array(0x20))).toBeUndefined();
  });
});
