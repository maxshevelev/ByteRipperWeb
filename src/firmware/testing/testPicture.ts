import { BinaryWriter } from "@/firmware/testing/testImage";

/**
 * Pictures, built byte for byte. Ported from `PictureTests.swift`, whose static
 * builders live there next to the tests; two test files read them here.
 */

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/**
 * A small but well-formed JPEG: the opening segment, a frame of `width`×`height`, a
 * scan whose data holds a stuffed `FF 00` and a restart marker, and the end marker.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.jpeg
 */
export function jpegPicture(
  options: {
    readonly exif?: boolean;
    readonly width?: number;
    readonly height?: number;
    readonly end?: boolean;
  } = {}
): Uint8Array {
  const width = options.width ?? 800;
  const height = options.height ?? 480;
  const bytes: number[] = [0xff, 0xd8];
  if (options.exif === true) {
    bytes.push(0xff, 0xe1, 0x00, 0x08, ...ascii("Exif"), 0, 0);
  } else {
    bytes.push(0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  }
  bytes.push(0xff, 0xff); // fill
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  bytes.push(height >> 8, height & 0xff, width >> 8, width & 0xff);
  bytes.push(0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0);
  bytes.push(0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78);
  if (options.end !== false) bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

const be32 = (value: number): number[] => [
  Math.floor(value / 0x100_0000) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

/**
 * `IHDR` for `width`×`height`, one `IDAT`, `IEND`; the CRCs are not checked, and
 * are zero.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.png
 */
export function pngPicture(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly frames?: number;
    readonly end?: boolean;
  } = {}
): Uint8Array {
  const chunk = (type: string, data: readonly number[]): number[] => [
    ...be32(data.length),
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(
    ...chunk("IHDR", [...be32(options.width ?? 16), ...be32(options.height ?? 8), 8, 0, 0, 0, 0])
  );
  bytes.push(...chunk("IDAT", [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]));
  if (options.end !== false) bytes.push(...chunk("IEND", []));
  return Uint8Array.from(bytes);
}

/**
 * A GIF89a with a two-colour table, a graphic control extension, one image of one
 * sub-block, and the trailer.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.gif
 */
export function gifPicture(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly frames?: number;
    readonly end?: boolean;
  } = {}
): Uint8Array {
  const width = options.width ?? 10;
  const height = options.height ?? 4;
  const bytes: number[] = ascii("GIF89a");
  bytes.push(width & 0xff, width >> 8, height & 0xff, height >> 8);
  bytes.push(0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff);
  for (let frame = 0; frame < (options.frames ?? 1); frame++) {
    bytes.push(0x21, 0xf9, 0x04, 0, 0x04, 0, 0, 0x00);
    bytes.push(0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0);
    bytes.push(0x02, 0x02, 0x44, 0x01, 0x00);
  }
  if (options.end !== false) bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

/**
 * An uncompressed 24-bit BMP, `width`×`height`, its rows padded to four bytes;
 * `declared` overrides the size its header gives.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/PictureTests.swift#PictureTests.bmp
 */
export function bmpPicture(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly declared?: number;
    readonly dib?: number;
  } = {}
): Uint8Array {
  const width = options.width ?? 3;
  const height = options.height ?? 2;
  const row = Math.floor((width * 24 + 31) / 32) * 4;
  const pixels = row * Math.abs(height);
  return new BinaryWriter()
    .u16(0x4d42)
    .u32(options.declared ?? 54 + pixels)
    .u32(0)
    .u32(54)
    .u32(options.dib ?? 40)
    .u32(width >>> 0)
    .u32(height >>> 0)
    .u16(1)
    .u16(24)
    .u32(0)
    .u32(pixels)
    .u32(2835)
    .u32(2835)
    .u32(0)
    .u32(0)
    .fill(pixels, 0x7f).bytes;
}
