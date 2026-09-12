import { putU32 } from "@/firmware/me/testing/testMe";

/**
 * Synthetic CSE extension blocks.
 *
 * Each is a self-contained chain element: its tag at 0, its whole size at 4, and
 * its header from 8 on. Field positions below are block-relative, exactly as the
 * decoder reads them — the envelope is *inside* the header span rather than in
 * front of it, which is the thing easiest to be off by eight about.
 */

export function extBlock(tag: number, headerLength: number, tail = 0): Uint8Array {
  const bytes = new Uint8Array(headerLength + tail);
  putU32(bytes, 0, tag);
  putU32(bytes, 4, bytes.length);
  return bytes;
}

const put16 = (bytes: Uint8Array, at: number, value: number) => {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
};

const putAscii = (bytes: Uint8Array, at: number, text: string) => {
  for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index);
};

/** A deterministic byte ramp, which is what a stored hash stands in as. */
const ramp = (bytes: Uint8Array, at: number, length: number, from = 0) => {
  for (let index = 0; index < length; index++) bytes[at + index] = (from + index) & 0xff;
};

export function extConcat(blocks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(blocks.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const block of blocks) {
    bytes.set(block, at);
    at += block.length;
  }
  return bytes;
}

export function extSystemInfo(revised: boolean): Uint8Array {
  const bytes = extBlock(0x00, revised ? 0x50 : 0x40);
  putU32(bytes, 0x08, 0x1122_3344); // MinUMASize
  putU32(bytes, 0x0c, 0x0c0d_0e0f); // ChipsetVersion
  ramp(bytes, 0x10, revised ? 48 : 32);
  putU32(bytes, revised ? 0x40 : 0x30, 0x5566_7788); // PageableUMASize
  return bytes;
}

export function extFeaturePermissions(moduleCount: number, rowCount = 0): Uint8Array {
  const bytes = extBlock(0x02, 0x0c, rowCount * 4);
  putU32(bytes, 0x08, moduleCount);
  return bytes;
}

export function extClientSystemInfo(): Uint8Array {
  const bytes = extBlock(0x0c, 0x30);
  putU32(bytes, 0x08, 0x0001_00fe); // the capability bitmask
  // One packed word: size 7, type 3, workstation 1, M3 0, M0 1, platform 2,
  // class 5 — which comes to 0x5AB7, and is where the workstation bit lives.
  putU32(bytes, 0x28, 0x5ab7);
  return bytes;
}

export function extSignedPackage(
  revised: boolean,
  options: { readonly vcn?: number; readonly arbSvn?: number } = {}
): Uint8Array {
  const bytes = extBlock(0x0f, 0x34);
  putAscii(bytes, 0x08, "NVM0");
  putU32(bytes, 0x0c, options.vcn ?? 3);
  ramp(bytes, 0x10, 16, 0x80); // the usage bitmap
  putU32(bytes, 0x20, options.arbSvn ?? 5);
  if (revised) {
    bytes[0x24] = 3; // FWType
    bytes[0x25] = 5; // FWSKU
    putU32(bytes, 0x26, 1); // NVMCompatibility
  }
  return bytes;
}

export function extPartitionInfo(
  tag: 0x03 | 0x16,
  revised: boolean,
  options: { readonly vcn?: number } = {}
): Uint8Array {
  const bytes = extBlock(tag, revised ? 0x68 : 0x58);
  putAscii(bytes, 0x08, "FTPR");
  putU32(bytes, 0x0c, 0x0002_0000); // PartitionSize
  const hashLength = revised ? 48 : 32;
  const isFirst = tag === 0x03;
  const versionBase = isFirst ? (revised ? 0x44 : 0x34) : 0x10;
  ramp(bytes, isFirst ? 0x10 : 0x24, hashLength, 0x40);
  put16(bytes, versionBase, 40); // minor
  put16(bytes, versionBase + 2, 15); // major
  put16(bytes, versionBase + 4, 2); // data format minor
  put16(bytes, versionBase + 6, 1); // data format major
  putU32(bytes, isFirst ? (revised ? 0x4c : 0x3c) : 0x18, 0xabcd);
  putU32(bytes, isFirst ? (revised ? 0x50 : 0x40) : 0x1c, 0x1);
  if (isFirst) putU32(bytes, revised ? 0x40 : 0x30, options.vcn ?? 7);
  return bytes;
}

export function extModuleAttributes(revised: boolean): Uint8Array {
  const hashLength = revised ? 48 : 32;
  const bytes = extBlock(0x0a, 0x18 + hashLength);
  bytes[0x08] = 1; // compression: Huffman
  bytes[0x09] = 0; // no encryption
  putU32(bytes, 0x0c, 0x4000); // uncompressed
  putU32(bytes, 0x10, 0x1800); // compressed
  put16(bytes, 0x14, 0x1234); // device
  put16(bytes, 0x16, 0x8086); // vendor
  ramp(bytes, 0x18, hashLength, 0x10);
  return bytes;
}

/** A block with rows behind its header, for the row-bearing tags. */
export function extRows(
  tag: number,
  headerLength: number,
  stride: number,
  rowCount: number,
  fill: (bytes: Uint8Array, row: number, index: number) => void
): Uint8Array {
  const bytes = extBlock(tag, headerLength, stride * rowCount);
  for (let index = 0; index < rowCount; index++) {
    fill(bytes, headerLength + index * stride, index);
  }
  return bytes;
}
