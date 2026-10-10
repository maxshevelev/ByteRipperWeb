import { encodeUtf8 } from "@/core/text/utf";
import { compress } from "@/firmware/compression/firmwareCompression";
import { checksum16 } from "@/firmware/uefi/checksums";
import { guidBytes } from "@/firmware/uefi/efiGuid";
import { FFS_V2 } from "@/firmware/uefi/knownGuids";

/**
 * Firmware images small enough to write out byte by byte, for the agent's tests that run the real
 * parser (`firmwareAgent.ts`): upstream's own test images, laid out the same, so an address a
 * test names is the address upstream's names.
 */

const u16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
export const u24 = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
];
export const u32 = (value: number): number[] =>
  [0, 1, 2, 3].map((at) => (value >>> (8 * at)) & 0xff);
const u64 = (value: number): number[] => [...u32(value), ...u32(Math.floor(value / 2 ** 32))];

/** UCS-2 little-endian, with the terminating zero a name section carries. */
const ucs2 = (text: string): number[] => [
  ...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, 0]),
  0,
  0,
];

/**
 * An FFSv2 volume header of `length` bytes with one block, its checksum filled in.
 */
function volumeHeader(length: number): number[] {
  const header = [
    ...new Array<number>(0x10).fill(0),
    ...guidBytes(FFS_V2),
    ...u64(length),
    ...u32(0x4856_465f), // _FVH
    ...u32(0x0000_0800), // erase polarity
    ...u16(0x48), // header length, over the block map
    ...u16(0), // checksum, filled in below
    ...u16(0), // no extended header
    0,
    2, // reserved, revision 2
    ...u32(1), // block map: one block…
    ...u32(length), // …of this size
    ...u32(0), // …terminated by the {0, 0} pair
    ...u32(0),
  ];
  const checksum = checksum16(Uint8Array.from(header)) ?? 0;
  header[0x32] = checksum & 0xff;
  header[0x33] = (checksum >> 8) & 0xff;
  return header;
}

/**
 * One FFSv2 volume of 4 KiB holding one driver, `MyDriver`, at `0x48`: a name section and a raw
 * section of sixteen `0x5A`. Upstream's `UEFITestImage.make` (`UEFIToolFlowTests.swift`), which
 * the map counts as test scaffolding.
 */
export function uefiTestImage(): Uint8Array {
  const image = new Uint8Array(0x1000).fill(0xff);
  image.set(volumeHeader(0x1000), 0);
  const file = [
    ...[1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0], // the file's GUID
    0,
    0xaa,
    0x07,
    0x00, // header/body checksum, type, attributes
    ...u24(0x44),
    0xf8, // state, erase polarity
    // Name section: the UCS-2 string a person gave the file.
    ...u24(0x16),
    0x15,
    ...ucs2("MyDriver"),
    // Two erased bytes to the next four-byte boundary.
    0xff,
    0xff,
    // Raw section: sixteen bytes of payload.
    ...u24(0x14),
    0x19,
    ...new Array<number>(16).fill(0x5a),
  ];
  image.set(file, 0x48);
  return image;
}

/**
 * A volume holding one file whose only section is LZMA-compressed, and in it a raw section with
 * `text`: bytes the file holds only compressed.
 *
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#CompressedTestImage
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#CompressedTestImage.make
 */
export function compressedTestImage(text: string): Uint8Array {
  const payload = [...encodeUtf8(text), ...new Array<number>(12).fill(0)];
  const raw = [...u24(4 + payload.length), 0x19, ...payload];
  const stream = compress(Uint8Array.from(raw), { variant: "LZMA" });
  const section = [...u24(4 + 5 + stream.length), 0x01, ...u32(raw.length), 0x02, ...stream];
  while (section.length % 4 !== 0) section.push(0xff);
  const fileSize = 0x18 + section.length;
  const guid = [3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
  const file = [...guid, 0, 0xaa, 0x07, 0x00, ...u24(fileSize), 0xf8, ...section];

  const image = new Uint8Array(0x1000).fill(0xff);
  image.set(volumeHeader(0x1000), 0);
  image.set(file, 0x48);
  return image;
}

/**
 * A Lenovo DMI store: padding, the log at `0x1000`, two blocks at `0x3000` and `0x4000` whose
 * serial number is `PF0TEST1`, and padding.
 *
 * @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage
 */
export const LENOVO = {
  /** @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.key */
  key: 0x77,
  /** @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.namespace */
  namespace: [0x55, 0x57, 0x0e, 0xc2, 0x69, 0x11, 0x56, 0x4c, 0xa4, 0x8a, 0x98, 0x24, 0xab, 0x43],
  /** @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.area */
  area: 0x1000,
  /**
   * Block 2's serial number value, in the file.
   *
   * @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.serialInBlock2
   */
  serialInBlock2: 0x4000 + 0x10 + 0x18,

  /** @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.block */
  block(generation: number): number[] {
    let body = [...this.namespace, 0x00, 0x04, ...u32(8), 0, 0, 0, 0, ...encodeUtf8("PF0TEST1")];
    body = [...body, ...new Array<number>(0x1000 - 16 - body.length).fill(0)];
    body = body.map((byte) => byte ^ this.key);
    const sum = body.reduce((total, byte) => (total + byte) & 0xffff, 0);
    return [
      ...encodeUtf8("LENV"),
      ...u32(generation),
      ...u32(1),
      0,
      this.key,
      sum & 0xff,
      sum >> 8,
      ...body,
    ];
  },

  /** @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage.make */
  make(): Uint8Array {
    const log = [
      ...encodeUtf8("LDBG"),
      ...u32(0x20),
      ...new Array<number>(24).fill(0),
      ...new Array<number>(0x2000 - 0x20).fill(this.key),
    ];
    return Uint8Array.from([
      ...new Array<number>(this.area).fill(0xff),
      ...log,
      ...this.block(4),
      ...this.block(5),
      ...new Array<number>(0x1000).fill(0xff),
    ]);
  },
};

/** One row of a FIT: the address, the size in 16-byte units, the version and the type. */
function fitEntry(address: number, size: number, type: number, checksumValid = false): number[] {
  return [...u64(address), ...u24(size), 0, 0x00, 0x01, type | (checksumValid ? 0x80 : 0), 0];
}

/** A microcode update of 0x100 bytes whose dword checksum is right. */
function fitMicrocode(): number[] {
  const bytes = [
    ...u32(1), // HeaderType
    ...u32(0xf0), // UpdateRevision
    0x19,
    0x20,
    0x15,
    0x07, // Year, Day, Month — BCD
    ...u32(0x0008_06ea), // ProcessorSignature
    ...u32(0), // Checksum, filled in below
    ...u32(1), // LoaderRevision
    ...u32(1), // PlatformIds
    ...u32(0x40), // DataSize
    ...u32(0x100), // TotalSize
    ...u32(0),
    ...u32(0),
    ...u32(0), // MetadataSize, UpdateRevisionMin, Reserved
  ];
  while (bytes.length < 0x100) bytes.push(0x5a);
  let sum = 0;
  for (let at = 0; at < bytes.length; at += 4) {
    sum =
      (sum +
        ((bytes[at] ?? 0) |
          ((bytes[at + 1] ?? 0) << 8) |
          ((bytes[at + 2] ?? 0) << 16) |
          ((bytes[at + 3] ?? 0) << 24))) >>>
      0;
  }
  bytes.splice(0x10, 4, ...u32((0x1_0000_0000 - sum) >>> 0));
  return bytes;
}

/**
 * A 64 KiB image with a FIT at `0x1000` — the header and one microcode row, the microcode at
 * `0x2000` — and the FIT pointer at `0xFFC0`. `checksum`, when given, is stored in place of the
 * right one. Upstream's `FITTestImage.make` (`FITToolFlowTests.swift`) with only the argument the
 * agent's test passes, which the map counts as test scaffolding.
 */
export function fitTestImage(checksum?: number): Uint8Array {
  const image = new Uint8Array(0x1_0000).fill(0xff);
  const diff = 0x1_0000_0000 - 0x1_0000;
  image.set(fitMicrocode(), 0x2000);
  const table = [...fitEntry(0, 2, 0x00, true), ...fitEntry(0x2000 + diff, 0, 0x01)];
  // The header's address is the `_FIT_   ` signature.
  table.splice(0, 8, ...encodeUtf8("_FIT_   "));
  table[0x0f] = checksum ?? (0x100 - (table.reduce((sum, byte) => sum + byte, 0) & 0xff)) & 0xff;
  image.set(table, 0x1000);
  image.set(u32(0x1000 + diff), 0xffc0);
  return image;
}
