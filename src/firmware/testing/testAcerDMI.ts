import {
  ACER_DMI_SIGNATURE,
  ACER_DMI_SIGNATURE_OFFSET,
  ACER_DMI_SIZE,
} from "@/firmware/uefi/acerDmiStore";

/**
 * A synthetic Acer DMI block that holds the factory patterns, for the tests of the reader
 * and of what the details say of it.
 *
 * @web-only the block and its constants are shared by the two test files here; upstream
 * repeats them in each (AcerDMIStoreTests, UEFIAcerDMIDetailTests)
 */

/** 22 alphanumerics: "N" first, "00" at 7, "3400" at the end. */
export const ACER_SERIAL = "N51TEST000000000003400";
/** 22 alphanumerics: "NB" first, "1100" at 5, "3400" at the end. */
export const ACER_MOTHERBOARD_SERIAL = "NB2TE11000000000003400";
/** Version 1, variant 1; the last six bytes are the tail the block copies. */
export const ACER_UUID: readonly number[] = [
  0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0x17, 0x88, 0x89, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05,
];

export function putText(bytes: Uint8Array, text: string, at: number): void {
  for (let index = 0; index < text.length; index++) {
    bytes[at + index] = text.charCodeAt(index);
  }
}

/**
 * The factory-shaped block: every field of the layout written, the rest FF.
 */
export function acerBlock(): Uint8Array {
  const bytes = new Uint8Array(ACER_DMI_SIZE).fill(0xff);
  putText(bytes, ACER_SERIAL, 0x00);
  bytes[0x30] = 0x01;
  bytes.set(ACER_DMI_SIGNATURE, ACER_DMI_SIGNATURE_OFFSET);
  putText(bytes, ACER_MOTHERBOARD_SERIAL, 0x50);
  bytes.set(ACER_UUID, 0x70);
  putText(bytes, "TEST-1050", 0x80);
  putText(bytes, "Test Model", 0xc0);
  bytes[0xf3] = 0x02;
  bytes.set(ACER_UUID.slice(10), 0x130);
  return bytes;
}
