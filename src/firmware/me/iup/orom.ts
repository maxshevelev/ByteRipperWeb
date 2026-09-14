import { u16, u32 } from "@/firmware/me/bytes";
import type { GSCOROMImage } from "@/firmware/me/models/independentFacts";

/**
 * The option ROM images of a GSC OROM firmware — upstream's OROM/PCIR pass. The
 * region is scanned for `orom_pat`, and each match decodes as a
 * `GSC_OROM_Header` and, at its PCI data offset, a `GSC_OROM_PCI_Data`.
 *
 * The pattern is `55 AA {22} 1C 00 {2} PCIR 86 80 {4} (18|1C) 00`: the AA55
 * signature, a PCI data offset of 0x1C, the PCIR struct opening there with
 * Intel's vendor id, and its own header length of 0x18 or 0x1C. Each match also
 * works out where its payload starts — the largest of the PCI data's end, the EFI
 * image offset and the OROM payload offset — and whether that payload is a `$CPD`.
 *
 * Ported from `Packages/MEFirmware/IUP/OROM.swift`.
 */

export function decodeOromImages(bytes: Uint8Array, baseOffset = 0): GSCOROMImage[] | undefined {
  const images: GSCOROMImage[] = [];
  for (let at = 0; at + 0x28 <= bytes.length; at++) {
    if (!isOromSignature(bytes, at)) continue;
    const image = decodeImage(bytes, at, baseOffset);
    if (image !== undefined) images.push(image);
  }
  return images.length === 0 ? undefined : images;
}

function isOromSignature(bytes: Uint8Array, at: number): boolean {
  const is = (offset: number, value: number) => bytes[at + offset] === value;
  return (
    is(0, 0x55) &&
    is(1, 0xaa) &&
    is(24, 0x1c) &&
    is(25, 0x00) &&
    is(28, 0x50) &&
    is(29, 0x43) &&
    is(30, 0x49) &&
    is(31, 0x52) &&
    is(32, 0x86) &&
    is(33, 0x80) &&
    (is(38, 0x18) || is(38, 0x1c)) &&
    is(39, 0x00)
  );
}

function decodeImage(bytes: Uint8Array, at: number, baseOffset: number): GSCOROMImage | undefined {
  if (at + 0x1c + 0x1c > bytes.length) return undefined;
  let reserved = 0n;
  for (let index = 7; index >= 0; index--) {
    reserved = (reserved << 8n) | BigInt(bytes[at + 0x0e + index] ?? 0);
  }
  const header = {
    signature: u16(bytes, at),
    imageSize: u16(bytes, at + 0x02),
    initFuncEntryPoint: u32(bytes, at + 0x04),
    subSystem: u16(bytes, at + 0x08),
    machineType: u16(bytes, at + 0x0a),
    compressionType: u16(bytes, at + 0x0c),
    reserved,
    efiImageOffset: u16(bytes, at + 0x16),
    pciDataHeaderOffset: u16(bytes, at + 0x18),
    oromPayloadOffset: u16(bytes, at + 0x1a),
  };

  const p = at + header.pciDataHeaderOffset;
  if (p + 0x1c > bytes.length) return undefined;
  let signature = "";
  for (let index = 0; index < 4; index++) {
    const byte = bytes[p + index] ?? 0;
    if (byte !== 0) signature += String.fromCharCode(byte);
  }
  const pciData = {
    signature,
    vendorID: u16(bytes, p + 0x04),
    deviceID: u16(bytes, p + 0x06),
    deviceListPointer: u16(bytes, p + 0x08),
    pciDataHeaderLength: u16(bytes, p + 0x0a),
    pciDataHeaderRevision: bytes[p + 0x0c] ?? 0,
    classCode:
      ((bytes[p + 0x0d] ?? 0) | ((bytes[p + 0x0e] ?? 0) << 8) | ((bytes[p + 0x0f] ?? 0) << 16)) >>>
      0,
    imageSize: u16(bytes, p + 0x10),
    revisionLevel: u16(bytes, p + 0x12),
    codeType: bytes[p + 0x14] ?? 0,
    lastImage: ((bytes[p + 0x15] ?? 0) & 0x80) !== 0,
    maxRuntimeImageLength: u16(bytes, p + 0x16),
    configUtilityCodeHeaderPointer: u16(bytes, p + 0x18),
    dmtfCLPEntryPointPointer: u16(bytes, p + 0x1a),
  };

  const payloadOffset = Math.max(
    header.pciDataHeaderOffset + pciData.pciDataHeaderLength,
    Math.max(header.efiImageOffset, header.oromPayloadOffset)
  );
  const payload = at + payloadOffset;
  const payloadIsCPD =
    bytes.length >= payload + 4 &&
    bytes[payload] === 0x24 &&
    bytes[payload + 1] === 0x43 &&
    bytes[payload + 2] === 0x50 &&
    bytes[payload + 3] === 0x44;

  return { offset: baseOffset + at, header, pciData, payloadOffset, payloadIsCPD };
}
